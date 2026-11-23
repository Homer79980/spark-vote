const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer}=require('./fixture-server.cjs');
(async()=>{
 const server=await startServer();let browser;
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const p=await browser.newPage({viewport:{width:390,height:844}});
  const url='http://127.0.0.1:'+server.address().port;
  await p.route('**/*',r=>r.request().url().startsWith(url)||r.request().url().startsWith('data:')?r.continue():r.abort());
  const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  const initial={round:1,voteMode:'image',maxVotes:2,items:['A','B','C'].map((name,i)=>({name,group:'G',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',votes:i===2?5:0}))};
  await p.addInitScript(d=>{if(!localStorage.getItem('spark-vote-browser-test'))localStorage.setItem('spark-vote-browser-test',JSON.stringify(d));},initial);
  await p.goto(url);const b=p.locator('.card').filter({has:p.locator('.card-name',{hasText:/^B$/})});
  await p.getByRole('button',{name:'模拟下次保存失败'}).click();await b.locator('button').click();
  await p.waitForFunction(()=>!imageSubmitting && document.querySelector('.toast-text').innerText.includes('未确认'));
  assert.match(await b.innerText(),/0 票/);assert.doesNotMatch(await b.innerText(),/已选/);
  await b.locator('button').click();await p.waitForFunction(()=>!imageSubmitting && document.querySelector('.vote-action-btn.selected'));
  await p.evaluate(()=>{const k='spark-vote-browser-test',d=JSON.parse(localStorage.getItem(k));d.items.shift();localStorage.setItem(k,JSON.stringify(d));});await p.reload();
  assert.match(await b.innerText(),/已选/);await b.locator('button').click();await p.waitForFunction(()=>!imageSubmitting && !document.querySelector('.vote-action-btn.selected'));
  assert.match(await b.innerText(),/0 票/);assert.match(await p.locator('.card').last().innerText(),/5 票/);
  await p.evaluate(()=>{const votes=Object.fromEntries(Array.from({length:500},(_,i)=>['n'+(i+1),1])),id=localStorage.getItem('spark_number_voter_v1');localStorage.setItem('spark-vote-browser-test',JSON.stringify({round:2,voteMode:'number',items:[{name:'sheet_1-500',group:'G',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'}],numberBallotsV2:{r2:{[id]:votes}}}));});await p.reload();
  await p.waitForFunction(()=>document.querySelector('#number-vote-quota').textContent.includes('500 / 500'));
  const firstTop=await p.locator('.card').first().evaluate(e=>e.getBoundingClientRect().top);assert.ok(firstTop<844,'first card at '+firstTop);
  await p.locator('#my-number-details summary').click();await p.locator('#my-number-search').fill('500');assert.equal(await p.locator('.number-chip:visible').count(),1);
  await p.locator('[data-number-cancel="500"]').click();await p.waitForFunction(()=>document.querySelector('#number-vote-quota').textContent.includes('499 / 500'));
  assert.deepEqual(errors,[]);console.log('PASS: rejected like, stable undo, refresh, mobile search/cancel; first card top:',firstTop);
 } finally {await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
