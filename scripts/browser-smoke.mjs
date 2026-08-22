/**
 * SUNMIL — end-to-end smoke test in a real browser.
 *
 *   node scripts/browser-smoke.mjs [url] [--shots <dir>]
 *
 * Unit and integration tests prove the server's arithmetic. They cannot prove
 * that the thing a player taps does what it says, and that is where this game
 * has actually broken: a daily-task guide that pointed at the Tasks button the
 * player had just come from, telling them to collect from an animal that did
 * not exist. Nothing on the server was wrong. Every test passed.
 *
 * So this drives the real client against a real API: it plays through the
 * onboarding, seeds one of every task kind, and checks that each one's guide
 * names the right next action and points somewhere that can produce it — then
 * follows a whole task from tap to claim.
 *
 * Requires the local stack (web + api + postgres + redis) and psql on PATH.
 * Exits non-zero on the first failure, so CI can gate on it.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const dbUrl = (fs.readFileSync(path.join(root, '.env'), 'utf8')
  .match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) ?? [])[1];
if (!dbUrl) {
  console.error('no DATABASE_URL in .env — this test seeds tasks directly');
  process.exit(1);
}
// ?schema=public is Prisma's; psql rejects it as an unknown URI parameter.
const psqlUrl = dbUrl.replace(/\?.*$/, '');
const q = (sql) => execFileSync('psql', ['-tA', psqlUrl, '-c', sql]).toString().trim();

let failures = 0;
function fail(msg) { console.error(`  ✗ ${msg}`); failures += 1 }
function pass(msg) { console.log(`  ✓ ${msg}`) }
function check(ok, msg) { (ok ? pass : fail)(msg) }

/**
 * Every task kind, with the words its guide must use when the goal is not yet
 * reachable. A cue that names the goal when the goal is impossible is the bug
 * this test exists to catch, so "points at something" is not enough — the
 * instruction itself has to be the one a stuck player needs.
 */
const KINDS = [
  { kind: 'plant', target: 8, expect: /seed/i },
  { kind: 'harvest', target: 6, expect: /plant first/i },
  { kind: 'craft', target: 3, expect: /machine/i },
  { kind: 'collect_machine', target: 3, expect: /start a job first/i },
  { kind: 'feed', target: 4, expect: /pen/i },
  { kind: 'collect_pen', target: 4, expect: /feed the animals first/i },
  { kind: 'deliver', target: 2, expect: /orders/i },
  { kind: 'sell', target: 10, expect: /market/i },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const tap = (sel) => page.evaluate(
  (s) => document.querySelector(s)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
  sel,
);
/** The coach mark, but only while it is actually up: stopGuide leaves the
 *  layer in the DOM holding its last text, and reading that reports the
 *  previous step's cue as though it were this one. */
const guide = () => page.evaluate(() => {
  const el = document.getElementById('guide');
  if (!el || !el.classList.contains('on')) return { on: false };
  const hole = el.querySelector('.g-hole');
  const r = hole?.getBoundingClientRect();
  return {
    on: true,
    step: el.querySelector('.g-step')?.textContent ?? '',
    text: el.querySelector('.g-text')?.textContent ?? '',
    spotlit: hole?.style.display !== 'none' && Boolean(r?.width),
  };
});
const shot = (name) => (shots ? page.screenshot({ path: path.join(shots, `${name}.png`) }) : Promise.resolve());

try {
  console.log(`\n▸ new farm at ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnPlay', { timeout: 30_000 });
  await tap('#btnPlay');
  await page.waitForTimeout(4000);
  check(await page.evaluate(() => Boolean(document.getElementById('world'))), 'the world rendered');
  await tap('#guide .g-stop');           // the onboarding tutorial
  await page.waitForTimeout(600);

  const farmId = q('SELECT id FROM "Farm" ORDER BY "createdAt" DESC LIMIT 1');
  const day = q("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')");
  check(Boolean(farmId), 'the farm reached the database');

  // One of every kind, so every branch of every cue is exercised rather than
  // the three the day happened to deal.
  q(`DELETE FROM "DailyTask" WHERE "farmId"='${farmId}'`);
  for (const { kind, target } of KINDS) {
    q(`INSERT INTO "DailyTask" (id,"farmId",day,kind,target,progress,claimed,"rewardCoins","rewardHay","rewardXp","createdAt")
       VALUES (gen_random_uuid()::text,'${farmId}','${day}','${kind}',${target},0,false,120,0.5,12,now())`);
  }
  // High enough that the machines and pens the cues point at are unlocked.
  q(`UPDATE "Farm" SET level=12, coins=5000 WHERE id='${farmId}'`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await tap('#introGo');
  await page.waitForTimeout(1500);
  await tap('#guide .g-stop');
  await page.waitForTimeout(600);

  console.log('\n▸ every task kind guides somewhere useful');
  for (const { kind, expect } of KINDS) {
    await tap('#rb_tasks');
    await page.waitForTimeout(900);
    const tappable = await page.evaluate((k) => {
      const row = document.querySelector(`#mBody .task[data-kind="${k}"]`);
      if (!row) return null;
      const go = row.classList.contains('go');
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return go;
    }, kind);
    await page.waitForTimeout(1100);
    const g = await guide();

    if (tappable === null) { fail(`${kind}: no task row`); continue }
    if (!tappable) fail(`${kind}: the row is not tappable, so only the button starts the guide`);
    if (!g.on) { fail(`${kind}: tapping the row did not start a guide`); continue }
    check(expect.test(g.text), `${kind}: "${g.text.trim()}"`);
    if (!g.spotlit) fail(`${kind}: nothing is spotlit, so the arrow points nowhere`);
    await tap('#guide .g-stop');
    await page.waitForTimeout(400);
  }
  await shot('task-cues');

  console.log('\n▸ one task, tap to claim');
  q(`DELETE FROM "DailyTask" WHERE "farmId"='${farmId}' AND kind <> 'plant'`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await tap('#introGo');
  await page.waitForTimeout(1500);
  await tap('#guide .g-stop');
  await page.waitForTimeout(600);

  await tap('#rb_tasks');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('#mBody .task[data-kind="plant"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(1200);
  check((await guide()).step?.includes('1 of 2'), 'tapping the row starts the guide at step 1');

  await tap('#dockInner .seed');
  await page.waitForTimeout(600);
  const plots = await page.evaluate(() => (window.__HITS || [])
    .filter((h) => h.kind === 'plot' && !h.ref.crop && h.ref.open)
    .slice(0, 8).map((h) => ({ x: h.x, y: h.y })));
  check(plots.length === 8, `${plots.length} empty plots to work with`);
  for (const c of plots) {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(1800);

  const progressed = q(`SELECT progress||'/'||target FROM "DailyTask" WHERE "farmId"='${farmId}' AND kind='plant'`);
  check(progressed === '8/8', `the server counted the work: ${progressed}`);
  const done = await guide();
  check(done.on && done.step?.includes('2 of 2'), 'the guide moved itself to the claim step');
  await shot('task-complete');

  await tap('#rb_tasks');
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('#mBody .task[data-kind="plant"] .t-actions button')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(2200);
  check(q(`SELECT claimed FROM "DailyTask" WHERE "farmId"='${farmId}' AND kind='plant'`) === 't',
    'the reward was claimed');
  check(!(await guide()).on, 'the guide ended by itself once the task was done');

  console.log('\n▸ the console stayed quiet');
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
