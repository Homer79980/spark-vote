const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./fixture-server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const voter = '11111111-1111-4111-8111-111111111111';
const image = process.env.SPARK_NUMBER_IMAGE
    ? 'data:image/png;base64,'+fs.readFileSync(process.env.SPARK_NUMBER_IMAGE).toString('base64')
    : 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400"><rect width="900" height="1400" fill="#faf9f5"/><text x="100" y="100" font-size="48">2301–2400</text><rect x="100" y="200" width="700" height="1100" fill="#27775a"/></svg>').toString('base64');
const initial = {round:0,maxVotes:1,headcount:4,items:[
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
        const ballot=()=>page.evaluate(voter=>JSON.parse(localStorage.getItem('spark-vote-browser-test')).numberBallots?.r0?.[voter]||{},voter);
        const vote=async(number)=>{
            await page.locator('#number-vote-input').fill(String(number));
            await page.locator('#number-vote-panel [data-number-submit]').click();
            await page.waitForFunction(number=>document.getElementById('number-vote-status').textContent.includes(`${number} 号投票成功`),number);
        };
        assert.match(await quota(),/0 \/ 20/);
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
        assert.match(await quota(),/0 \/ 20/,'unconfirmed vote does not appear as saved');
        await page.waitForFunction(()=>document.getElementById('modal-number-status').textContent.includes('2358 号投票成功'));
        assert.equal(await page.locator('#modalZoomValue').innerText(),'125%');
        assert.match(await quota(),/1 \/ 20/);
        assert.equal((await ballot()).n2358,true);
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        assert.match(await page.locator('#modal-number-status').innerText(),/已投过/);
        await page.locator('#modal-number-input').fill('1');
        await page.locator('#modalNumberVoting [data-number-submit]').click();
        assert.match(await page.locator('#modal-number-status').innerText(),/另一张/);
        await page.keyboard.press('Escape');
        for(const invalid of ['2401','1e2','0']) {
            await page.locator('#number-vote-input').fill(invalid);
            await page.locator('#number-vote-panel [data-number-submit]').click();
            assert.match(await page.locator('#number-vote-status').getAttribute('class'),/error/);
        }
        await page.reload();
        assert.match(await quota(),/1 \/ 20/,'confirmed selection survives reload');
        assert.equal(await page.locator('[data-number-cancel="2358"]').count(),1);

        await page.getByRole('button',{name:'模拟下次保存失败'}).click();
        await page.locator('#number-vote-input').fill('1');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        await page.waitForFunction(()=>document.getElementById('number-vote-status').textContent.includes('操作未成功'));
        assert.match(await quota(),/1 \/ 20/,'failed vote does not consume quota');
        await vote(1);
        for(let number=2;number<=19;number++) await vote(number);
        assert.match(await quota(),/20 \/ 20/,'quota is shared across groups and sheets');
        await page.locator('#number-vote-input').fill('20');
        await page.locator('#number-vote-panel [data-number-submit]').click();
        assert.match(await page.locator('#number-vote-status').innerText(),/已选满 20/);
        assert.equal(Object.keys(await ballot()).length,20);
        assert.deepEqual(dialogs,[],'submitting numbered votes must never open a dialog');
        console.log('PASS first 20 choices, reload, validation, and rejected save.');
        await page.locator('[data-number-cancel="2358"]').click();
        await page.waitForFunction(()=>document.getElementById('number-vote-status').textContent.includes('2358 号已撤销'));
        assert.match(await quota(),/19 \/ 20/);
        await vote(20);
        await page.locator('[data-number-cancel="20"]').click();
        await page.waitForFunction(()=>document.getElementById('number-vote-status').textContent.includes('20 号已撤销'));

        const second=await setupPage('?voteDelay=150');
        await page.locator('#number-vote-input').fill('20');
        await second.locator('#number-vote-input').fill('2358');
        await Promise.all([page.locator('#number-vote-panel [data-number-submit]').click(),second.locator('#number-vote-panel [data-number-submit]').click()]);
        await Promise.all([page.waitForFunction(()=>!numberSubmitting),second.waitForFunction(()=>!numberSubmitting)]);
        assert.equal(Object.keys(await ballot()).length,20,'two tabs cannot claim the last place twice');
        console.log('PASS cross-tab last-place contention.');
        await page.reload();
        assert.match(await quota(),/20 \/ 20/);
        assert.equal(await page.locator('[data-number-cancel]').count(),20);
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('spark-vote-browser-test')));
        assert.deepEqual(saved.items.map(item=>item.votes),[2,3],'old whole-image votes remain unchanged');
        const csv=await page.evaluate(()=>buildExportCsv());
        assert.match(csv,/"20"/);
        assert.match(csv,/原整图投票记录/);
        assert.match(csv,/"2400","0","24_2301-2400"/);

        await page.locator('.footer').click();
        assert.equal(await page.locator('#stat-totalvotes').innerText(),'20');
        assert.equal(await page.locator('#stat-headcount').innerText(),'1');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('保存成功'));
        assert.equal(Object.keys(await ballot()).length,20,'saving image metadata preserves numbered ballots');
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
        await page.getByRole('button',{name:'切换网络状态'}).click();
        assert.ok(await page.locator('#number-vote-panel [data-number-submit]').isDisabled());
        assert.deepEqual(errors,[]);
        console.log('PASS: input/range lookup; modal vote; server-confirmed success; reload; duplicate/invalid/wrong-sheet rejection; failure retry; 20 choices across groups; cancel/replace; concurrent tabs at quota; CSV/ranking; admin save preservation/overlap rejection; zoom; mobile/landscape; offline disabled. Local fixture only.');
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
