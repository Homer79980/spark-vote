// Read-only check against the deployed page and its real database. Never writes.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
async function main() {
    const browser = await chromium.launch({headless:true,channel:'msedge'});
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (let attempt = 0; attempt < 3; attempt++) {
            const start = Date.now();
            if (attempt === 0) await page.goto('https://homer79980.github.io/spark-vote/?check=refresh', {waitUntil:'domcontentloaded',timeout:45000});
            else await page.reload({waitUntil:'domcontentloaded',timeout:45000});
            const initial = await page.evaluate(() => ({cards:document.querySelectorAll('.card').length,visibleText:document.querySelector('#voteContainer')?.innerText,loaded:typeof dataLoaded !== 'undefined' && dataLoaded}));
            await page.waitForFunction(() => typeof dataLoaded !== 'undefined' && dataLoaded, {timeout:45000});
            const result = await page.evaluate(() => ({cards:document.querySelectorAll('.card').length,items:currentData.items?.length || 0,connected:databaseConnected,status:document.querySelector('#save-status').textContent}));
            assert.equal(result.cards,result.items);
            console.log(JSON.stringify({attempt:attempt+1,milliseconds:Date.now()-start,initial,...result}));
        }
        assert.deepEqual(errors,[]);
        console.log('PASS: production data reloads in a fresh browser and two refreshes; no writes performed.');
    } finally { await browser.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
