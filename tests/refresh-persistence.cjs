const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./fixture-server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const password = html.match(/prompt\("验证:"\) === "([^"]+)"/)[1];
const image = {name:'自动保存.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')};
async function main(){
    const server=await startServer();let browser;
    try{
        browser=await chromium.launch({headless:true,channel:'msedge'});
        const page=await browser.newPage();
        page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?password:undefined));
        const base=`http://127.0.0.1:${server.address().port}`;
        await page.goto(base);
        await page.locator('.footer').click();
        await page.locator('#batch-file-input').setInputFiles([image,{...image,name:'第二张.png'}]);
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存成功'),null,{timeout:5000});
        await page.reload();
        assert.equal(await page.locator('.card').count(),2,'imported images must persist without an extra Save click');
        await page.locator('.footer').click();
        await page.getByRole('button',{name:'切换网络状态'}).click();
        await page.locator('#batch-file-input').setInputFiles({...image,name:'断网草稿.png'});
        await page.waitForFunction(()=>document.querySelector('#local-draft-status')?.textContent.includes('本机草稿已保存'),null,{timeout:5000});
        assert.equal(await page.locator('.admin-item').count(),3);
        await page.goto(`${base}/?offline=1`);
        await page.waitForFunction(()=>document.querySelectorAll('.card').length===2,null,{timeout:5000});
        assert.match(await page.locator('#sync-status').innerText(),/缓存|连接|同步/);
        await page.locator('.footer').click();
        await page.waitForFunction(()=>document.querySelectorAll('.admin-item').length===3,null,{timeout:5000});
        assert.equal(await page.locator('.edit-name').last().inputValue(),'断网草稿');
        assert.match(await page.locator('#save-status').innerText(),/草稿/);
        await page.getByRole('button',{name:'切换网络状态'}).click();
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存成功'),null,{timeout:5000});
        await page.goto(base);
        await page.waitForFunction(()=>document.querySelectorAll('.card').length===3,null,{timeout:5000});
        await page.locator('.footer').click();
        assert.equal(await page.locator('.admin-item').count(),3,'a confirmed draft must not create duplicates on reopening');
        console.log('PASS: batch auto-save, refresh without manual save, offline import persisted, offline cached gallery, draft restored, reconnect/save, no duplicates.');
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
