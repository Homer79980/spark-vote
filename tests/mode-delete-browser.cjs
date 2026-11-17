const assert=require('node:assert/strict');
const {startServer}=require('./fixture-server.cjs');
const {chromium}=require('playwright-core');
(async()=>{
 const server=await startServer(); let browser;
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext();
  const initial={round:3,maxVotes:3,headcount:1,items:[{name:'sheet_1-100',group:'A',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',votes:0}],numberBallotsV2:{r3:{old:{_format:2,n1:1}}}};
  await context.addInitScript(data=>{if(!localStorage.getItem('spark-vote-browser-test'))localStorage.setItem('spark-vote-browser-test',JSON.stringify(data));},initial);
  const p=await context.newPage();let errors=[];p.on('pageerror',e=>errors.push(e.message)); p.on('dialog',d=>d.type()==='prompt'?d.accept('123456'):d.accept());
  await p.goto(`http://127.0.0.1:${server.address().port}`); await p.waitForFunction(()=>dataLoaded&&databaseConnected);
  await p.locator('.footer').click(); await p.locator('#voteMode').selectOption('image'); await p.locator('#save-button').click(); await p.getByText(/保存成功，服务器已确认/).first().waitFor();
  assert.equal(await p.locator('#number-vote-panel').isHidden(),true); assert.match(await p.locator('.vote-action-btn').first().innerText(),/投一票/);
  await p.reload(); await p.waitForFunction(()=>dataLoaded&&databaseConnected); assert.equal(await p.locator('#number-vote-panel').isHidden(),true);
  await p.locator('.footer').click(); await p.locator('#voteMode').selectOption('number'); await p.locator('#save-button').click(); await p.getByText(/保存成功，服务器已确认/).first().waitFor();
  assert.equal(await p.locator('#number-vote-panel').isVisible(),true); assert.match(await p.locator('.vote-action-btn').first().innerText(),/编号/);
  await p.getByRole('button',{name:'🗑️ 删除所有'}).click(); await p.getByText(/删除成功，已开始新一轮投票/).first().waitFor();
  await p.reload(); await p.waitForFunction(()=>dataLoaded&&databaseConnected); assert.equal(await p.locator('.card').count(),0);
  const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('spark-vote-browser-test'))); assert.equal(saved.round,4);assert.equal(saved.numberBallotsV2.r3.old.n1,1); assert.equal(saved.items.length,0); assert.deepEqual(errors,[]);
  console.log('Mode switching, saving, deletion, archived ballots and reload passed in isolated browser fixture.');
 } finally {if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
