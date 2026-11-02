const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./fixture-server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const numbers = require('../number-voting.js');
const voter = '11111111-1111-4111-8111-111111111111';
const image = process.env.SPARK_NUMBER_IMAGE
    ? 'data:image/png;base64,'+fs.readFileSync(process.env.SPARK_NUMBER_IMAGE).toString('base64')
    : 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400"><rect width="900" height="1400" fill="#faf9f5"/><text x="100" y="100" font-size="48">2301–2400</text><rect x="100" y="200" width="700" height="1100" fill="#27775a"/></svg>').toString('base64');
const initial = {round:0,maxVotes:1,headcount:4,numberBallots:{r0:{[voter]:{n2358:true}}},items:[
    {name:'01_1-100',group:'A',url:image,votes:2},
    {name:'24_2301-2400',group:'B',url:image,votes:3}
]};

async function main() {
    const server = await startServer();
    const browser = await chromium.launch({headless:true,channel:'msedge'});
    const errors=[], dialogs=[];
    try {
        const context=await browser.newContext({viewport:{width:1440,height:1000}});
        await context.addInitScript(({initial,voter})=>{
            if(!localStorage.getItem('spark-vote-browser-test')) localStorage.setItem('spark-vote-browser-test',JSON.stringify(initial));
            if(!localStorage.getItem('spark_number_voter_v1')) localStorage.setItem('spark_number_voter_v1',voter);
        },{initial,voter});
        const url=`http://127.0.0.1:${server.address().port}`;
        const setupPage=async(search='')=>{
            const page=await context.newPage();
            page.on('pageerror',e=>errors.push(e.message));
            page.on('dialog',dialog=>{dialogs.push(dialog.type());return dialog.type()==='prompt'?dialog.accept('123456'):dialog.accept();});
            await page.goto(url+search,{waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>typeof dataLoaded !== 'undefined' && dataLoaded);
            await page.addStyleTag({content:'#test-controls { position: static; z-index: auto; }'});
            return page;
        };
        const page=await setupPage('?voteDelay=150');
        const quota=()=>page.locator('#number-vote-quota').innerText();
        const ballot=()=>page.evaluate(voter=>{
            const data=JSON.parse(localStorage.getItem('spark-vote-browser-test'));
            return data.numberBallotsV2?.r0?.[voter]||data.numberBallots?.r0?.[voter]||{};
        },voter);
        const vote=async(value)=>{
            await page.locator('#number-vote-input').fill(String(value));
            await page.locator('#number-vote-panel [data-number-submit]').click();
            await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('number-vote-status').classList.contains('success'));
        };
        assert.match(await quota(),/1 \/ 50/,'existing boolean votes already consume quota');
        assert.match(await page.locator('#number-legacy-summary').innerText(),/5 票/);
        await page.locator('#number-vote-input').fill('2358');
        await page.getByRole('button',{name:'查看所在图',exact:true}).click();
        assert.equal(await page.locator('#modalItemName').innerText(),'24_2301-2400');
        assert.equal(await page.locator('#modal-number-input').inputValue(),'2358');
        assert.ok(!await page.locator('#modalVoteBtn').isVisible());
        await page.locator('#modalZoomIn').click();
        await page.locator('#modal-number-input').press('ArrowLeft');
        assert.equal(await page.locator('#modalItemName').innerText(),'24_2301-2400','editing input must not change image');
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        assert.match(await page.locator('#modal-number-status').innerText(),/等待服务器确认/);
        assert.match(await quota(),/1 \/ 50/,'unconfirmed vote does not appear as saved');
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('modal-number-status').textContent.includes('投票成功'));
        assert.equal(await page.locator('#modalZoomValue').innerText(),'125%');
        assert.match(await quota(),/2 \/ 50/);
        assert.equal((await ballot()).n2358,2);
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('modal-number-status').textContent.includes('投票成功'));
        assert.equal(await page.locator('[data-number-chip="2358"]').count(),1,'repeat votes share one numbered row');
        await page.locator('#modal-number-input').fill('1,2，2358、1');
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('modal-number-status').textContent.includes('已保存 4 票'));
        assert.match(await quota(),/7 \/ 50/);
        assert.deepEqual(await ballot(),{n2358:4,_format:2,n1:2,n2:1});
        assert.deepEqual(dialogs,[],'single and batch voting must never open dialogs');
        await page.keyboard.press('Escape');
        for(const invalid of ['', '1,2401','1e2','0']) {
            await page.locator('#number-vote-input').fill(invalid);
            await page.locator('#number-vote-panel [data-number-submit]').click();
            assert.match(await page.locator('#number-vote-status').getAttribute('class'),/error/);
        }
        assert.equal(numbers.totalVotes(await ballot()),7,'invalid batch writes no partial votes');
        await page.reload({waitUntil:'domcontentloaded'});
        assert.match(await quota(),/7 \/ 50/,'confirmed repeated votes survive reload');
        assert.equal(await page.locator('[data-number-cancel="2358"]').count(),1);

        await page.getByRole('button',{name:'模拟下次保存失败'}).click();
        await page.locator('#number-vote-input').fill('1,2');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        await page.waitForFunction(()=>document.getElementById('number-vote-status').textContent.includes('操作未成功'));
        assert.match(await quota(),/7 \/ 50/,'failed batch does not consume quota');
        await vote('1,2');
        assert.match(await quota(),/9 \/ 50/);
        assert.deepEqual(dialogs,[],'submitting numbered votes must never open a dialog');
        assert.equal(await page.locator('[data-number-cancel="2358"]').innerText(),'撤销');
        await page.locator('[data-number-cancel="2358"]').click();
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('number-vote-status').textContent.includes('已撤销'));
        assert.match(await quota(),/8 \/ 50/);
        assert.equal((await ballot()).n2358,3,'cancel decrements one vote');
        assert.deepEqual(dialogs,[],'cancel must not open a dialog');
        await page.locator('#number-vote-input').fill(Array(43).fill('1').join(','));
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/本次需 43 票，还剩 42 票/);
        assert.equal(numbers.totalVotes(await ballot()),8,'over-budget batch is rejected atomically');
        await vote(Array(41).fill('1').join('、'));
        assert.match(await quota(),/49 \/ 50/);
        console.log('PASS legacy compatibility, repeat counts, mixed separators, atomic batches, quota, reload and failure retry.');

        const second=await setupPage('?voteDelay=150');
        await page.locator('#number-vote-input').fill('1');
        await second.locator('#number-vote-input').fill('2358');
        await Promise.all([page.locator('#number-vote-panel [data-number-submit]').click(),second.locator('#number-vote-panel [data-number-submit]').click()]);
        await Promise.all([page.waitForFunction(()=>!numberSubmitting),second.waitForFunction(()=>!numberSubmitting)]);
        assert.equal(numbers.totalVotes(await ballot()),50,'two tabs cannot spend the last vote twice');
        console.log('PASS cross-tab contention at 49/50 votes.');
        await page.reload({waitUntil:'domcontentloaded'});
        assert.match(await quota(),/50 \/ 50/);
        assert.equal(await page.locator('[data-number-cancel]').count(),3);
        await page.locator('#number-vote-input').fill('1');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/还剩 0 票/);
        for(let count=0;count<2;count++) {
            await page.locator('[data-number-cancel="2"]').click();
            await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('number-vote-status').textContent.includes('已撤销'));
        }
        assert.equal(await page.locator('[data-number-chip="2"]').count(),0);
        await vote('2,2');
        assert.equal(await page.locator('[data-number-chip="2"]').count(),1);
        assert.match(await page.locator('[data-number-chip="2"]').innerText(),/× 2/);
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('spark-vote-browser-test')));
        assert.deepEqual(saved.items.map(item=>item.votes),[2,3],'old whole-image votes remain unchanged');
        assert.equal(saved.numberBallots.r0[voter].n2358,true,'legacy numbered votes remain intact in their original branch');
        const csv=await page.evaluate(()=>buildExportCsv());
        assert.match(csv,/"每人最多票数","50"/);
        assert.match(csv,/"2","2","01_1-100"/);
        assert.match(csv,/原整图投票记录/);
        assert.match(csv,/"2400","0","24_2301-2400"/);

        await page.locator('.footer').click();
        assert.equal(await page.locator('#stat-totalvotes').innerText(),'50');
        assert.equal(await page.locator('#stat-headcount').innerText(),'1');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('保存成功'));
        assert.equal(numbers.totalVotes(await ballot()),50,'saving image metadata preserves all repeated votes');
        await page.locator('.edit-name').first().fill('重复_2350-2450');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('重叠'));
        assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('spark-vote-browser-test')))).items[0].name,'01_1-100');
        await page.locator('.edit-name').first().fill('01_1-100');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('保存成功'));
        await page.locator('.footer').click();

        const screenshots=process.env.SPARK_SCREENSHOT_DIR;
        if(screenshots) {fs.mkdirSync(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'number-home.png'),fullPage:true});}
        await page.locator('.card-img-wrapper').nth(1).click();
        await page.locator('#modal-number-input').fill('2358');
        if(screenshots) await page.screenshot({path:path.join(screenshots,'number-modal.png')});
        for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
            await page.setViewportSize(viewport);
            const footer=await page.locator('.modal-footer').boundingBox();
            const stage=await page.locator('#modalImageStage').boundingBox();
            assert.ok(footer.x>=0&&footer.x+footer.width<=viewport.width+1);
            assert.ok(footer.y+footer.height<=viewport.height+1,'number input and zoom buttons remain visible');
            assert.ok(stage.height>70,'image has usable space');
            if(screenshots) await page.screenshot({path:path.join(screenshots,`number-${viewport.width}.png`)});
        }
        await page.keyboard.press('Escape');
        const otherVoter = '22222222-2222-4222-8222-222222222222';
        await page.evaluate(other => {
            const key='spark-vote-browser-test', data=JSON.parse(localStorage.getItem(key));
            data.numberBallotsV2.r0[other]={_format:2,n2400:3};
            localStorage.setItem(key,JSON.stringify(data));
        },otherVoter);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>dataLoaded);
        assert.equal(await page.locator('[data-number-cancel="2400"]').count(),0,'other voters do not get a cancel control');
        await page.evaluate(()=>cancelNumberVote(2400));
        assert.equal(await page.evaluate(other=>JSON.parse(localStorage.getItem('spark-vote-browser-test')).numberBallotsV2.r0[other].n2400,otherVoter),3,'cannot cancel another browser ballot through normal UI');
        await page.getByRole('button',{name:'切换网络状态'}).click();
        assert.ok(await page.locator('#number-vote-panel [data-number-submit]').isDisabled());
        assert.deepEqual(errors,[]);
        console.log('PASS: no vote dialogs; old votes count as one; repeat +1; mixed comma/Chinese comma/enumeration separators; cross-sheet batches; atomic validation/quota/failure; reload; 50 total votes; decrement/revote; concurrent tabs; CSV/ranking; admin saves; zoom; mobile/landscape; offline disabled. Local fixture only.');
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
