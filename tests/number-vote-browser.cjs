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
const initial = {round:0,maxVotes:1,headcount:4,numberBallots:{r0:{[voter]:{n2358:true}}},numberBallotsV2:{r0:{[voter]:{_format:2,n2358:4}}},items:[
    {name:'01_1-600',group:'A',url:image,votes:2},
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
        assert.match(await quota(),/1 \/ 500/,'old repeated votes count as one');
        assert.equal((await ballot()).n2358,4,'original count remains stored');
        await page.locator('#number-vote-input').fill('2358');
        await page.getByRole('button',{name:'查看所在图',exact:true}).click();
        assert.equal(await page.locator('#modalItemName').innerText(),'24_2301-2400');
        await page.locator('#modalZoomIn').click();
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        assert.match(await page.locator('#modal-number-status').innerText(),/已经投过/);
        assert.equal((await ballot()).n2358,4);
        await page.locator('#modal-number-input').fill('1,2，2358、1');
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('modal-number-status').textContent.includes('已保存 2 票'));
        assert.match(await quota(),/3 \/ 500/);
        assert.deepEqual(await ballot(),{_format:2,n2358:4,n1:1,n2:1});
        assert.deepEqual(dialogs,[],'voting must not open dialogs');
        await page.keyboard.press('Escape');
        await page.reload({waitUntil:'domcontentloaded'});
        assert.match(await quota(),/3 \/ 500/);
        await page.locator('#number-vote-input').fill('1,1、2358');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/已经投过/);
        assert.equal((await ballot()).n2358,4);
        assert.equal(await page.locator('[data-number-cancel="2358"]').innerText(),'撤销');
        await page.locator('[data-number-cancel="2358"]').click();
        await page.waitForFunction(()=>!numberSubmitting&&document.getElementById('number-vote-status').textContent.includes('已撤销'));
        assert.equal((await ballot()).n2358,undefined,'cancel removes the one effective vote');
        assert.match(await quota(),/2 \/ 500/);
        await page.reload({waitUntil:'domcontentloaded'});
        assert.equal(await page.locator('[data-number-chip="2358"]').count(),0,'old boolean vote does not resurrect');
        await vote('2358');
        assert.equal((await ballot()).n2358,1);
        await page.getByRole('button',{name:'模拟下次保存失败'}).click();
        await page.locator('#number-vote-input').fill('3');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        await page.waitForFunction(()=>document.getElementById('number-vote-status').textContent.includes('操作未成功'));
        assert.match(await quota(),/3 \/ 500/);
        const second=await setupPage('?voteDelay=150');
        await page.locator('#number-vote-input').fill('3');
        await second.locator('#number-vote-input').fill('3');
        await Promise.all([page.locator('#number-vote-panel [data-number-submit]').click(),second.locator('#number-vote-panel [data-number-submit]').click()]);
        await Promise.all([page.waitForFunction(()=>!numberSubmitting),second.waitForFunction(()=>!numberSubmitting)]);
        assert.equal((await ballot()).n3,1,'simultaneous votes for one number count once');
        await vote(Array.from({length:495},(_,i)=>i+4).join('、'));
        assert.match(await quota(),/499 \/ 500/);
        await page.locator('#number-vote-input').fill('499');
        await second.locator('#number-vote-input').fill('500');
        await Promise.all([page.locator('#number-vote-panel [data-number-submit]').click(),second.locator('#number-vote-panel [data-number-submit]').click()]);
        await Promise.all([page.waitForFunction(()=>!numberSubmitting),second.waitForFunction(()=>!numberSubmitting)]);
        assert.equal(numbers.totalVotes(await ballot()),500,'two tabs cannot spend the last vote twice');
        await page.reload({waitUntil:'domcontentloaded'});
        assert.match(await quota(),/500 \/ 500/);
        await page.locator('#number-vote-input').fill('1');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/已经投过/);
        await page.locator('#number-vote-input').fill('501');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/还剩 0 票/);
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('spark-vote-browser-test')));
        assert.deepEqual(saved.items.map(item=>item.votes),[2,3]);
        assert.equal(saved.numberBallots.r0[voter].n2358,true);
        const csv=await page.evaluate(()=>buildExportCsv());
        assert.match(csv,/"2","1","01_1-600"/);
        assert.match(csv,/"每人最多票数","500"/);
        assert.match(csv,/原整图投票记录/);
        await page.locator('.footer').click();
        assert.equal(await page.locator('#stat-totalvotes').innerText(),'500');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('保存成功'));
        assert.equal(numbers.totalVotes(await ballot()),500,'admin save preserves ballots');
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
        console.log('PASS: unique voting, legacy counts, batch deduplication, cancellation, reload, concurrent tabs, CSV, admin saves, zoom, mobile, offline and per-browser isolation. Local fixture only.');
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
