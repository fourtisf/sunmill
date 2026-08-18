#!/usr/bin/env node
/**
 * Browser smoke test — drives the real UI in Chromium against a running
 * sunmill-web + sunmill-api.
 *
 *   npm i -D playwright            # once, if it is not already installed
 *   node frontend/scripts/browser-smoke.mjs [webUrl]
 *
 * Signs in with the dev login, sweeps a plant across every open field, waits
 * for the server to ripen the crop, harvests, queues a craft, and reloads to
 * prove the farm persisted. Exits non-zero on the first failure.
 *
 * Needs the API running with the dev login available (i.e. not
 * NODE_ENV=production) and CORS_ORIGINS including the web origin.
 * Set CHROMIUM_PATH to use a Chromium that Playwright did not install.
 */
import { chromium } from 'playwright';

const WEB = process.argv[2] || process.env.WEB_URL || 'http://localhost:3000/';

let pass = 0;
const ok = (l, c, x='') => { if (!c) { console.error('FAIL', l, x); process.exit(1); } pass++; console.log('  ok  ', l, x); };

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
);
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(WEB, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await (await page.$('#btnGuest')).dispatchEvent('pointerdown');
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('introGo')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1400);
// The onboarding guide starts for a new farm; step out of it so this test can
// drive the UI directly. Its own walkthrough is covered separately.
await page.evaluate(() => document.querySelector('#guide .g-stop')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(600);

const coins0 = await page.$eval('#coinTxt', e => Number(e.textContent));
ok('logged in with a fresh farm', coins0 === 640, 'coins=' + coins0);

// tend the pen first: its timer then runs down during the crop and craft
// phases below, so the whole loop is covered without extra waiting
// Hens wander in front of the coop and are drawn on top of it, so pick a
// point where the coop itself is the frontmost thing — tapping a hen is a
// different (also valid) interaction.
const pen = await page.evaluate(() => {
  const hits = window.__HITS || [];
  const box = hits.find(h => h.kind === 'pen');
  if (!box) return null;
  const topmost = (x, y) => {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (x >= h.x - h.w/2 && x <= h.x + h.w/2 && y >= h.y - h.h/2 && y <= h.y + h.h/2) return h.kind;
    }
    return null;
  };
  for (const dy of [-0.35, -0.25, -0.15, 0]) {
    const y = box.y + box.h * dy;
    if (topmost(box.x, y) === 'pen') return { x: box.x, y };
  }
  return null;
});
ok('the coop can be tapped without hitting a hen', Boolean(pen));
await page.mouse.move(pen.x, pen.y); await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(900);
ok('the pen panel opened', (await page.$eval('#modal h2', e=>e.textContent)).includes('Chicken Coop'));
await page.evaluate(() => [...document.querySelectorAll('#mBody button')]
  .find(b => b.textContent.includes('Feed all'))?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1600);
const fedCount = await page.evaluate(() =>
  (window.__HITS||[]).filter(h => h.kind === 'animal' && h.ref.state === 'full').length);
ok('feeding the pen started the hens working', fedCount === 2, fedCount + ' hens fed');
await page.evaluate(() => document.querySelector('#mClose')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(400);

// sweep-plant across all four open fields
const plots = await page.evaluate(() => (window.__HITS||[]).filter(h => h.kind === 'plot').map(h => ({x:h.x, y:h.y, i:h.ref.index})));
ok('four fields are hit-testable', plots.length === 4);
plots.sort((a,b) => a.i - b.i);
await page.mouse.move(plots[0].x, plots[0].y);
await page.mouse.down();
for (const p of plots) { await page.mouse.move(p.x, p.y, { steps: 6 }); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(1500);

const afterPlant = await page.evaluate(() => ({
  coins: Number(document.querySelector('#coinTxt').textContent),
  growing: (window.__HITS||[]).filter(h => h.kind==='plot' && h.ref.crop).length,
}));
ok('one sweep planted every field', afterPlant.growing === 4, JSON.stringify(afterPlant));
ok('the server charged 4 wheat seeds', afterPlant.coins === coins0 - 4, 'coins=' + afterPlant.coins);

// wait for ripeness (server-driven), then harvest by tapping
await page.waitForFunction(() => (window.__HITS||[]).some(h => h.kind==='plot' && h.ref.ready), null, { timeout: 30000 });
ok('the client saw the crops ripen without a reload', true);

for (let n = 0; n < 4; n++) {
  const t = await page.evaluate(() => (window.__HITS||[]).find(h => h.kind==='plot' && h.ref.ready));
  if (!t) break;
  await page.mouse.move(t.x, t.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(900);
}
const inv = await page.evaluate(() => document.querySelector('#siloTxt').textContent);
ok('harvest landed in the silo', inv.startsWith('30/'), 'silo=' + inv);

// craft at the Feed Mill
const mill = await page.evaluate(() => (window.__HITS||[]).find(h => h.kind === 'machine'));
await page.mouse.move(mill.x, mill.y); await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(900);
ok('the machine panel opened', (await page.$eval('#modal h2', e=>e.textContent)).includes('Feed Mill'));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#mBody button')].filter(b => b.textContent === 'Make' && !b.disabled);
  btns[0]?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
});
await page.waitForTimeout(1500);
const queued = await page.evaluate(() => {
  const m = (window.__HITS||[]);
  return { bar: Boolean(document.querySelector('[data-qbar]')), silo: document.querySelector('#siloTxt').textContent };
});
ok('a job is on the line with a live progress bar', queued.bar, JSON.stringify(queued));
ok('ingredients came out of the silo', !queued.silo.startsWith('30/'), 'silo=' + queued.silo);

// market panel: sell surplus
await page.evaluate(() => document.querySelector('#mClose')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#rb_market').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1200);
ok('the market panel opened', (await page.$eval('#modal h2', e=>e.textContent)).includes('Roadside Market'));
await page.evaluate(() => [...document.querySelectorAll('#mBody [data-tab]')].find(b => b.textContent === 'Sell')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(600);
const coinsBeforeSell = await page.$eval('#coinTxt', e => Number(e.textContent));
await page.evaluate(() => [...document.querySelectorAll('#mBody button')].find(b => b.textContent === 'Sell 1')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1400);
const coinsAfterSell = await page.$eval('#coinTxt', e => Number(e.textContent));
ok('selling paid out and the HUD followed', coinsAfterSell > coinsBeforeSell, coinsBeforeSell + ' -> ' + coinsAfterSell);

// orders panel: skip one, board stays full
await page.evaluate(() => document.querySelector('#mClose')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#rb_orders').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1000);
const tickets = await page.$$eval('#mBody .ticket', n => n.length);
ok('the order board rendered four tickets', tickets === 4, 'tickets=' + tickets);
const skippedId = await page.$eval('#mBody [data-skip]', e => e.getAttribute('data-skip'));
await page.evaluate(() => document.querySelector('#mBody [data-skip]')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1400);
const remaining = await page.$$eval('#mBody [data-skip]', n => n.map(e => e.getAttribute('data-skip')));
ok('the skipped order is gone from the board', !remaining.includes(skippedId),
   remaining.length + ' orders remain');
await page.evaluate(() => document.querySelector('#mClose')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(400);

// New systems: daily tasks, the streak, and the $HAY sink.
await page.evaluate(() => document.querySelector('#rb_tasks').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1200);
ok('the daily tasks panel opened', (await page.$$eval('#mBody .task', n => n.length)) === 3,
   (await page.$$eval('#mBody .task', n => n.length)) + ' tasks');
ok('the streak strip shows seven days', (await page.$$eval('.streak-day', n => n.length)) === 7);
const coinsBeforeStreak = await page.$eval('#coinTxt', e => Number(e.textContent));
await page.evaluate(() => [...document.querySelectorAll('#mBody button')]
  .find(b => /Claim day|Ambil hari/.test(b.textContent))?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(1600);
ok('claiming the daily reward pays out',
   (await page.$eval('#coinTxt', e => Number(e.textContent))) > coinsBeforeStreak);
await page.evaluate(() => document.querySelector('#mClose')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
await page.waitForTimeout(500);

// Speed-up: tapping a growing crop offers to finish it for $HAY.
await page.evaluate(() => document.querySelector('#dockInner .seed').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
const freePlot = await page.evaluate(() => (window.__HITS||[]).find(h => h.kind === 'plot' && !h.ref.crop));
if (freePlot) {
  await page.mouse.move(freePlot.x, freePlot.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(1500);
  const growingPlot = await page.evaluate(() => (window.__HITS||[]).find(h => h.kind === 'plot' && h.ref.crop && !h.ref.ready));
  if (growingPlot) {
    await page.mouse.move(growingPlot.x, growingPlot.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1400);
    ok('tapping a growing crop offers a speed-up', Boolean(await page.$('.speed-btn')));
    const hayBefore = await page.$eval('#hayTxt', e => Number(e.textContent));
    await page.evaluate(() => document.querySelector('.speed-btn')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.waitForTimeout(1800);
    const hayAfter = await page.$eval('#hayTxt', e => Number(e.textContent));
    ok('$HAY was spent and the crop finished', hayAfter < hayBefore, hayBefore + ' -> ' + hayAfter);
    ok('the speed-up sheet closed itself', !(await page.$('#scrim.on')));
  }
}

// The joystick walks the farmer.
const jkBox = await (await page.$('#joystick')).boundingBox();
await page.mouse.move(jkBox.x + jkBox.width / 2, jkBox.y + jkBox.height / 2);
await page.mouse.down();
await page.mouse.move(jkBox.x + jkBox.width / 2 + 40, jkBox.y + jkBox.height / 2 + 12, { steps: 4 });
await page.waitForTimeout(900);
const knob = await page.evaluate(() => document.querySelector('#joystick .jk-knob').style.transform);
await page.mouse.up();
ok('the joystick tracks the thumb', /translate\(4?\d(\.\d+)?px/.test(knob), knob);

// the hens have had their 30s by now — collect by tapping one in the field
await page.waitForFunction(() => (window.__HITS||[]).some(h => h.kind === 'animal' && h.ref.state === 'ready'),
  null, { timeout: 40000 });
ok('the server marked the hens ready', true);
const barnBefore = await page.$eval('#barnTxt', e => e.textContent);
let barnAfter = barnBefore;
// Hens wander every frame, so read the position and tap in the same beat, and
// only aim at one that is actually the frontmost thing under the cursor.
for (let attempt = 0; attempt < 6 && barnAfter === barnBefore; attempt++) {
  const hen = await page.evaluate(() => {
    const hits = window.__HITS || [];
    const topmost = (x, y) => {
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i];
        if (x >= h.x - h.w/2 && x <= h.x + h.w/2 && y >= h.y - h.h/2 && y <= h.y + h.h/2) return h;
      }
      return null;
    };
    for (const h of hits) {
      if (h.kind !== 'animal' || h.ref.state !== 'ready') continue;
      const top = topmost(h.x, h.y);
      if (top && top.kind === 'animal' && top.ref.index === h.ref.index) return { x: h.x, y: h.y };
    }
    return null;
  });
  if (!hen) { await page.waitForTimeout(400); continue; }
  await page.mouse.move(hen.x, hen.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(1200);
  barnAfter = await page.$eval('#barnTxt', e => e.textContent);
}
ok('tapping a ready hen collected its egg into the barn', barnAfter !== barnBefore,
   barnBefore + ' -> ' + barnAfter);

// reload: the farm must survive
const beforeReload = await page.evaluate(() => ({
  silo: document.querySelector('#siloTxt').textContent,
  coins: Number(document.querySelector('#coinTxt').textContent),
  barn: document.querySelector('#barnTxt').textContent,
}));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const afterReload = await page.evaluate(() => ({
  silo: document.querySelector('#siloTxt').textContent,
  coins: Number(document.querySelector('#coinTxt').textContent),
  barn: document.querySelector('#barnTxt').textContent,
}));
ok('the farm survives a page reload',
   afterReload.coins === beforeReload.coins
   && afterReload.silo === beforeReload.silo
   && afterReload.barn === beforeReload.barn,
   JSON.stringify(afterReload));

console.log('\n' + pass + ' browser checks passed');
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
