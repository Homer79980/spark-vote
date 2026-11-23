const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {startServer}=require('./fixture-server.cjs');

(async()=>{
    const server=await startServer();
    let browser;
    try {
        browser=await chromium.launch({headless:true,channel:'msedge'});
        const page=await browser.newPage();
        const site='http://127.0.0.1:'+server.address().port;
        const app=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
        const password=app.match(/prompt\("验证:"\) === "([^"]+)"/)[1];
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        page.on('dialog',d=>d.accept(d.type()==='prompt'?password:undefined));
        // Scale the budget only in the fixture: exercise exact-fit and overflow with real images.
        await page.route('**/*',async r=>{
            if(new URL(r.request().url()).origin!==site)return r.abort();
            if(r.request().resourceType()!=='document')return r.continue();
            const reply=await r.fetch(), html=await reply.text();
            assert.ok(html.includes('GALLERY_LIMIT = 64 * MIB'));
            return r.fulfill({response:reply,body:html.replace('GALLERY_LIMIT = 64 * MIB',"GALLERY_LIMIT = Number(new URLSearchParams(location.search).get('budget')) || 64 * MIB")});
        });
        await page.goto(site);
        const assets=await page.evaluate(async()=>{
            const results=[];
            for (const side of [8,48,160]) {
                const canvas=document.createElement('canvas');canvas.width=canvas.height=side;
                const ctx=canvas.getContext('2d'),im=ctx.createImageData(side,side);
                for(let n=0;n<im.data.length;n++) im.data[n]=n%4===3?255:(n*33+(n>>4)*13)%256;
                ctx.putImageData(im,0,0);
                const blob=await new Promise(resolve=>canvas.toBlob(resolve));
                const encoded=await prepareImage(new File([blob],'test.png',{type:'image/png'}));
                results.push({url:encoded,png:canvas.toDataURL().split(',')[1]});
            }
            return results;
        });
        const [small,original,large]=assets, budget=original.url.length+small.url.length*2;
        assert.ok(large.url.length>budget);
        const file=(asset,name)=>({name:name+'.png',mimeType:'image/png',buffer:Buffer.from(asset.png,'base64')});
        const upload=async(selector,files)=>{
            await page.locator(selector).first().setInputFiles(files);
            await page.waitForFunction(()=>!saving&&!preparingSave&&!processingImages&&!batchImporting);
        };
        await page.goto(site+'/?budget='+budget);
        await page.locator('.footer').click();
        await upload('#batch-file-input',file(original,'original'));
        await upload('#batch-file-input',[file(small,'first'),file(large,'too-large'),file(small,'last')]);
        assert.match(await page.locator('#save-status').textContent(),/保存成功/);
        assert.match(await page.locator('#batch-status').textContent(),/too-large.png.*容量/);
        await page.reload();
        assert.deepEqual(await page.locator('.card-name').allTextContents(),['original','first','last']);
        await page.locator('.footer').click();
        await upload('.drop-zone input[type=file]',file(large,'too-large-replacement'));
        assert.equal(await page.locator('.edit-url').first().inputValue(),original.url);
        assert.equal(await page.evaluate(()=>adminDirty),false);
        assert.match(await page.locator('#batch-status').textContent(),/too-large-replacement.png/);
        await upload('.drop-zone input[type=file]',[file(small,'replacement'),file(large,'rejected-tail')]);
        assert.match(await page.locator('#save-status').textContent(),/保存成功/);
        await page.reload();await page.locator('.footer').click();
        assert.equal(await page.locator('.edit-url').first().inputValue(),small.url);
        assert.deepEqual(await page.locator('.card-name').allTextContents(),['original','first','last']);
        assert.deepEqual(errors,[]);
        console.log('PASS: partial batch, exact fit, later small file, rejected replacement, successful replacement with rejected tail, refresh.');
    } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
