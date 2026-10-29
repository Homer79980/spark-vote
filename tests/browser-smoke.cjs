const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./fixture-server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const password = html.match(/prompt\("验证:"\) === "([^"]+)"/)[1];
const image = {name:'透明示例.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')};
async function main(){
    const server=await startServer();
    let browser;
    try{
        browser=await chromium.launch({headless:true,channel:'msedge'});
        const page=await browser.newPage({viewport:{width:1280,height:900}});
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept(password):dialog.dismiss());
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('.footer').click();
        await page.getByRole('button',{name:'+ 新增',exact:true}).click();
        await page.locator('.drop-zone input[type=file]').setInputFiles(image);
        await page.waitForFunction(()=>document.querySelector('.edit-name').value==='透明示例');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存成功'));
        await page.reload();
        assert.equal(await page.locator('.card').count(),1,'saved image must survive refresh');
        await page.locator('.footer').click();
        await page.locator('.edit-name').fill('未完成编辑');
        await page.getByRole('button',{name:'模拟实时票数更新'}).click();
        assert.equal(await page.locator('.edit-name').inputValue(),'未完成编辑');
        await page.getByRole('button',{name:'模拟下次保存失败'}).click();
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存失败'));
        assert.equal(await page.locator('.edit-name').inputValue(),'未完成编辑');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存成功'));
        assert.match(await page.locator('.card .stats').innerText(),/1 票/);
        const screenshot=process.env.SPARK_SCREENSHOT_DIR;
        if(screenshot){fs.mkdirSync(screenshot,{recursive:true});await page.screenshot({path:path.join(screenshot,'desktop.png'),fullPage:true});}
        await page.setViewportSize({width:390,height:844});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile view must not overflow');
        if(screenshot)await page.screenshot({path:path.join(screenshot,'mobile.png'),fullPage:true});
        assert.deepEqual(errors,[]);
        console.log('PASS: image selection, filename, confirmed save, reload, realtime preservation, server rejection/retry, votes preserved, mobile layout.');
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
