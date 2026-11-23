// Isolated end-to-end test; all database traffic goes to a fresh loopback emulator.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {setTimeout: delay} = require('node:timers/promises');
const {chromium} = require('playwright-core');
const {startServer} = require('./fixture-server.cjs');

(async()=>{
    assert.ok(process.env.RTDB_EMULATOR_JAR,'Set RTDB_EMULATOR_JAR to a Firebase Database emulator jar');
    const reserve=net.createServer().listen(0,'127.0.0.1');
    await once(reserve,'listening');
    const port=reserve.address().port;
    await new Promise(resolve=>reserve.close(resolve));
    const origin='http://127.0.0.1:'+port;
    const database=origin+'/sparkVote.json?ns=demo-gallery-capacity';
    const java=spawn(process.env.JAVA_BIN||'java',['-Xmx768m','-jar',process.env.RTDB_EMULATOR_JAR,'--host','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:'ignore'});
    const exited=once(java,'exit');
    let browser,server;
    try {
        let ready=false;
        for(let i=0;i<100&&!ready;i++) {
            if(java.exitCode!==null) throw Error('Emulator exited: '+java.exitCode);
            try { ready=(await fetch(database)).ok; } catch {}
            if(!ready) await delay(150);
        }
        assert.ok(ready,'Local test database must be available');
        assert.ok((await fetch(database,{method:'PUT',body:JSON.stringify({round:1,maxVotes:1,voteMode:'image'})})).ok);
        server=await startServer();
        const site='http://127.0.0.1:'+server.address().port;
        const html=readFileSync(path.join(__dirname,'../index.html'),'utf8');
        const password=html.match(/prompt\("验证:"\) === "([^"]+)"/)[1];
        browser=await chromium.launch({headless:true,channel:'msedge'});
        const page=await browser.newPage();
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        page.on('dialog',d=>d.accept(d.type()==='prompt'?password:undefined));
        let puts=0;
        await page.route('**/*',async route=>{
            const req=route.request(),url=new URL(req.url());
            if(url.origin!==site) return route.abort(); // No production calls.
            if(url.pathname==='/fixture.js') return route.fulfill({contentType:'text/javascript',body:
                "window.firebase={initializeApp(c){c.databaseURL=location.origin},database:()=>({ref:k=>({on:async(_,fn)=>{const v=k==='.info/connected'?true:await (await fetch('/sparkVote.json')).json();fn({val:()=>v});},transaction:()=>{throw Error('Unexpected SDK write')}})})}"});
            if(url.pathname!=='/sparkVote.json') return route.continue();
            if(req.method()==='PUT' && ++puts===1)
                assert.ok((await fetch(origin+'/sparkVote/headcount.json?ns=demo-gallery-capacity',{method:'PUT',body:'1'})).ok);
            const proxy=await fetch(database+(url.searchParams.has('print')?'&print=silent':''),{method:req.method(),headers:Object.fromEntries(Object.entries(req.headers()).filter(([k])=>['x-firebase-etag','if-match','content-type'].includes(k))),body:req.postDataBuffer()||undefined});
            const headers={'content-type':'application/json'};
            if(proxy.headers.has('etag')) headers.etag=proxy.headers.get('etag');
            const body=Buffer.from(await proxy.arrayBuffer());
            if (!proxy.ok && proxy.status!==412) console.error('Emulator',proxy.status,body.toString('utf8',0,240));
            await route.fulfill({status:proxy.status,headers,body});
        });
        await page.goto(site);
        await page.waitForFunction(()=>dataLoaded);
        await page.locator('.footer').click();
        // Real, high-entropy PNG so WebP conversion still exceeds the previous gallery limit.
        const encoded=await page.evaluate(()=>{
            const canvas=document.createElement('canvas');canvas.width=canvas.height=1536;
            const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1536,1536);
            let r=25;
            for(let i=0;i<pixels.data.length;i+=4) {
                r=(Math.imul(r,1664525)+1013904223)>>>0;
                pixels.data[i]=r>>>24;pixels.data[i+1]=r>>>16;pixels.data[i+2]=r>>>8;pixels.data[i+3]=255;
            }
            ctx.putImageData(pixels,0,0);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        const buffer=Buffer.from(encoded,'base64');
        // Import in the renderer to avoid Playwright's aggregate file-transfer limit.
        const files=await page.evaluateHandle(async encoded=>{
            const blob=await (await fetch('data:image/png;base64,'+encoded)).blob();
            return Array.from({length:12},(_,i)=>new File([blob],'capacity-'+i+'.png',{type:'image/png'}));
        },buffer.toString('base64'));
        await page.evaluate(files=>importImageFiles(files),files);
        assert.match(await page.locator('#save-status').textContent(),/保存成功/);
        assert.equal(puts,2,'the real emulator should cause and resolve a conditional-write conflict');
        const used=await page.locator('#gallery-capacity').textContent();
        assert.ok(Number(used.match(/([\d.]+) \/ 64/)[1])>16,used);
        await page.reload();await page.waitForFunction(()=>dataLoaded && document.querySelectorAll('.card').length===12);
        const result=await page.evaluate(async()=>{
            const imgs=Array.from(document.querySelectorAll('.card img'));
            await Promise.all(imgs.map(img=>img.decode()));
            return {count:imgs.filter(img=>img.naturalWidth===1536).length,headcount:currentData.headcount};
        });
        assert.deepEqual(result,{count:12,headcount:1});
        assert.deepEqual(errors,[]);
        console.log('PASS: '+used+'; 12 images decoded after reload; concurrent update preserved.');
    } finally {
        try {await browser?.close();if(server) await new Promise(resolve=>server.close(resolve));}
        finally {if(java.exitCode===null)java.kill();await exited;}
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
