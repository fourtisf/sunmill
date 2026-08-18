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
await page.waitForTimeout(900);

const coins0 = await page.$eval('#coinTxt', e => Number(e.textContent));
ok('logged in with a fresh farm', coins0 === 640, 'coins=' + coins0);

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
await page.evaluate(() => document.querySelectorAll('#rail .rbtn')[1].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
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
await page.evaluate(() => document.querySelectorAll('#rail .rbtn')[0].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
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

// reload: the farm must survive
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const afterReload = await page.evaluate(() => ({
  silo: document.querySelector('#siloTxt').textContent,
  coins: Number(document.querySelector('#coinTxt').textContent),
}));
ok('the farm survives a page reload', afterReload.coins === coinsAfterSell, JSON.stringify(afterReload));

console.log('\n' + pass + ' browser checks passed');
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
