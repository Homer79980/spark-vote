const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./fixture-server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

function sampleImage(width, height) {
    const cells = Array.from({length:100}, (_, index) => {
        const x = 20 + index % 10 * (width - 40) / 10;
        const y = 20 + Math.floor(index / 10) * (height - 40) / 10;
        return `<rect x="${x}" y="${y}" width="${(width - 40) / 12}" height="${(height - 40) / 12}" rx="10" fill="#2c765a" stroke="#51392a" stroke-width="3"/>`;
    }).join('');
    return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#faf9f5"/>${cells}</svg>`).toString('base64');
}

async function main() {
    const server = await startServer();
    let browser;
    try {
        browser = await chromium.launch({headless:true,channel:'msedge'});
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const data = {items:[
            {name:'竖版总览',url:sampleImage(900,1400),votes:0},
            {name:'横版总览',url:sampleImage(1600,700),votes:0}
        ],headcount:0,maxVotes:1,round:0};
        await page.addInitScript(data => {
            if (!localStorage.getItem('spark-vote-browser-test')) localStorage.setItem('spark-vote-browser-test',JSON.stringify(data));
        },data);
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.addStyleTag({content:'#test-controls { display: none !important; }'});
        await page.locator('.card-img-wrapper').first().click();
        await page.waitForFunction(() => document.getElementById('modalImg').naturalWidth > 0);
        const zoom = () => page.locator('#modalZoomValue').innerText();
        const imageBox = () => page.locator('#modalImg').boundingBox();
        const before = await imageBox();
        const stage = await page.locator('#modalImageStage').boundingBox();
        assert.equal(await zoom(),'100%');
        assert.ok(before.height <= stage.height + 1 && before.width <= stage.width + 1,'initial image fits the stage');
        await page.locator('#modalZoomIn').click();
        assert.equal(await zoom(),'125%');
        assert.ok(Math.abs((await imageBox()).height / before.height - 1.25) < 0.01,'plus enlarges the actual image');
        await page.locator('#modalZoomOut').click();
        assert.equal(await zoom(),'100%');

        const anchor = {x:stage.x + stage.width / 2,y:stage.y + stage.height * 0.65};
        await page.mouse.move(anchor.x,anchor.y);
        await page.mouse.wheel(0,-150);
        await page.waitForFunction(() => document.getElementById('modalZoomValue').textContent !== '100%');
        const enlarged = await imageBox();
        const beforeFraction = (anchor.y - before.y) / before.height;
        const afterFraction = (anchor.y - enlarged.y) / enlarged.height;
        assert.ok(Math.abs(beforeFraction - afterFraction) < 0.001,'wheel zoom stays anchored to the mouse');
        assert.equal(await page.evaluate(() => scrollY),0,'wheel must not scroll the page');
        await page.mouse.wheel(0,150);
        await page.waitForFunction(() => document.getElementById('modalZoomValue').textContent === '100%');
        await page.locator('#modalZoomIn').click({clickCount:4,delay:20});
        const preDrag = await imageBox();
        await page.mouse.move(anchor.x,anchor.y);
        await page.mouse.down();
        await page.mouse.move(anchor.x,anchor.y + 100,{steps:5});
        await page.mouse.up();
        assert.ok((await imageBox()).y > preDrag.y + 90,'enlarged image can be panned');
        const currentZoom = await zoom();
        await page.locator('#modalVoteBtn').click();
        assert.match(await page.locator('#modalVoteBtn').innerText(),/已选/);
        assert.equal(await zoom(),currentZoom,'realtime vote updates retain zoom');
        assert.ok(Math.abs((await imageBox()).y - preDrag.y - 100) < 1,'vote updates retain pan');

        for (let count=0; count<20 && !await page.locator('#modalZoomIn').isDisabled(); count++) await page.locator('#modalZoomIn').click();
        assert.equal(await zoom(),'800%');
        assert.ok(await page.locator('#modalZoomIn').isDisabled());
        for (let count=0; count<25 && !await page.locator('#modalZoomOut').isDisabled(); count++) await page.locator('#modalZoomOut').click();
        assert.equal(await zoom(),'25%');
        assert.ok(await page.locator('#modalZoomOut').isDisabled());
        await page.locator('#modalZoomReset').click();
        assert.equal(await zoom(),'100%');
        await page.locator('#modalZoomIn').click();
        await page.locator('.modal-nav.next').click();
        assert.equal(await page.locator('#modalItemName').innerText(),'横版总览');
        assert.equal(await zoom(),'100%','switching image resets zoom');
        await page.locator('#modalZoomIn').click();
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('#modalItemName').innerText(),'竖版总览');
        assert.equal(await zoom(),'100%');
        await page.locator('#modalZoomIn').click();
        await page.keyboard.press('Escape');
        assert.ok(!await page.locator('#modal').isVisible());
        await page.locator('.card-img-wrapper').first().click();
        assert.equal(await zoom(),'100%','reopening starts fitted');
        await page.locator('#modalImg').click();
        assert.ok(await page.locator('#modal').isVisible(),'clicking image leaves preview open');
        await page.locator('.modal-close').click();
        assert.ok(!await page.locator('#modal').isVisible());
        await page.locator('.card-img-wrapper').first().click();
        await page.locator('#modal').click({position:{x:2,y:200}});
        assert.ok(!await page.locator('#modal').isVisible(),'background closes preview');

        await page.locator('.card-img-wrapper').first().click();
        const screenshots = process.env.SPARK_SCREENSHOT_DIR;
        if (screenshots) {
            fs.mkdirSync(screenshots,{recursive:true});
            await page.screenshot({path:path.join(screenshots,'zoom-desktop.png')});
        }
        for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
            await page.setViewportSize(viewport);
            await page.waitForFunction(() => document.getElementById('modalZoomValue').textContent === '100%');
            const footer = await page.locator('.modal-footer').boundingBox();
            const frame = await page.locator('#modalImageStage').boundingBox();
            assert.ok(footer.x >= 0 && footer.x + footer.width <= viewport.width + 1,'toolbar fits narrow screen');
            assert.ok(footer.y + footer.height <= viewport.height,'toolbar stays visible on a short screen');
            assert.ok(frame.height > 80,'image retains usable space');
            await page.locator('#modalZoomIn').click();
            assert.equal(await zoom(),'125%');
            if (screenshots) await page.screenshot({path:path.join(screenshots,`zoom-${viewport.width}.png`)});
        }
        assert.deepEqual(errors,[]);
        console.log('PASS: buttons change image size; mouse-anchored wheel in/out; page stays fixed; drag; vote keeps zoom/pan; 25–800% limits; fit reset; next/previous; reopen; image/background/close clicks; desktop, mobile and short-screen controls. No production database writes.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode=1; });
