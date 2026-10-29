// Confirms a real server acknowledgement without adding/removing/changing items.
// Stops before writing if the form would change any existing metadata.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const password = html.match(/prompt\("验证:"\) === "([^"]+)"/)[1];
const endpoint = html.match(/databaseURL: "([^"]+)"/)[1] + 'sparkVote.json';
const metadata = data => ({round:data.round||0,maxVotes:data.maxVotes||1,items:(data.items||[]).map(item=>({name:item.name||'',group:item.group||'',url:item.url||''}))});
async function main(){
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const context=await browser.newContext();
        const page=await context.newPage();
        page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept(password):dialog.dismiss());
        await page.goto(process.env.SPARK_LIVE_URL || 'https://homer79980.github.io/spark-vote/?check=confirmed-save',{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>typeof dataLoaded!=='undefined'&&dataLoaded&&databaseConnected,null,{timeout:60000});
        const beforeResponse=await context.request.get(endpoint,{timeout:60000});
        assert.ok(beforeResponse.ok());
        const before=await beforeResponse.json();
        if(process.env.SPARK_BACKUP_PATH)fs.writeFileSync(process.env.SPARK_BACKUP_PATH,JSON.stringify(before),{flag:'wx'});
        await page.locator('.footer').click();
        const form=await page.evaluate(()=>({round:currentData.round||0,maxVotes:Number(document.querySelector('#maxVoteInput').value),items:Array.from(document.querySelectorAll('.admin-item')).map(row=>({name:row.querySelector('.edit-name').value.trim(),group:row.querySelector('.edit-group').value.trim()||'默认分组',url:row.querySelector('.edit-url').value}))}));
        assert.deepEqual(form,metadata(before),'Live test stopped: saving would change existing metadata');
        await page.locator('#save-button').click();
        await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('保存成功'),null,{timeout:60000});
        const acknowledgement=await page.locator('#save-status').innerText();
        const afterResponse=await context.request.get(endpoint,{timeout:60000});
        assert.ok(afterResponse.ok());
        const after=await afterResponse.json();
        assert.deepEqual(metadata(after),metadata(before),'Unexpected metadata change');
        await page.reload({waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>dataLoaded&&databaseConnected,null,{timeout:60000});
        assert.equal(await page.locator('.card').count(),after.items.length);
        console.log(JSON.stringify({result:'PASS',existingItems:after.items.length,acknowledgement,confirmedBy:'separate database GET and page refresh',metadataChanged:false}));
    } finally {await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
