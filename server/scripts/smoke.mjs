#!/usr/bin/env node
/**
 * End-to-end smoke test of the whole game loop against a running API.
 *
 *   node server/scripts/smoke.mjs [baseUrl]
 *
 * Logs in with the dev route, then plants, harvests, crafts, tends a pen,
 * works the order board and the market, expands, and finally re-reads the farm
 * to prove the state survived. Exits non-zero on the first failure.
 *
 * Real timers: it waits out crop, craft and animal durations, so it takes
 * about (60 x TIME_SCALE) seconds.
 */
const BASE = process.argv[2] || process.env.API_URL || 'http://127.0.0.1:4000';

let cookie = '';
let passed = 0;

function ok(label, condition, extra = '') {
  if (!condition) {
    console.error(`\n  FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok    ${label}${extra ? ` — ${extra}` : ''}`);
}

function step(title) {
  console.log(`\n${title}`);
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(label, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) {
      console.error(`\n  FAIL  timed out waiting for ${label}`);
      process.exit(1);
    }
    await sleep(500);
  }
}

async function main() {
  step('config + auth');
  const config = await get('/api/config');
  ok('GET /api/config', config.status === 200 && config.body.items.wheat, `timeScale=${config.body.timeScale}`);
  const SCALE = config.body.timeScale;
  const growWheat = config.body.items.wheat.growSeconds;

  const anon = await get('/api/farm');
  ok('GET /api/farm rejects an anonymous caller', anon.status === 401);

  const login = await post('/api/auth/dev', { handle: `smoke-${Date.now()}` });
  ok('POST /api/auth/dev', login.status === 200 && login.body.ok);

  step('a fresh farm');
  let snap = (await get('/api/farm')).body;
  ok('starting coins', snap.farm.coins === '640', snap.farm.coins);
  ok('starting $HAY', snap.farm.hay === '8.00', snap.farm.hay);
  ok('12 tile slots, 4 open at level 1', snap.farm.tiles.length === 12 && snap.farm.fieldsOpen === 4);
  ok('four machines, three pens', snap.farm.machines.length === 4 && snap.farm.pens.length === 3);
  ok('locked buildings are flagged closed',
    snap.farm.machines.find((m) => m.machine === 'sugar').open === false);
  ok('server time offset is present', typeof snap.serverTime === 'string');

  step('plant (the sweep)');
  const plant = await post('/api/plant', { tiles: [0, 1, 2, 3], crop: 'wheat' });
  ok('POST /api/plant', plant.status === 200);
  ok('seed cost deducted server-side', plant.body.farm.coins === '636', plant.body.farm.coins);
  ok('all four tiles are growing', plant.body.farm.tiles.filter((t) => t.crop === 'wheat').length === 4);
  ok('nothing is ready yet', plant.body.farm.tiles.every((t) => !t.ready));

  const lockedField = await post('/api/plant', { tiles: [8], crop: 'wheat' });
  ok('a locked field is refused', lockedField.status === 400 && lockedField.body.error === 'level_locked');
  const lockedSeed = await post('/api/plant', { tiles: [0], crop: 'sugarcane' });
  ok('a locked seed is refused', lockedSeed.status === 400 && lockedSeed.body.error === 'level_locked');
  const early = await post('/api/harvest', { tile: 0 });
  ok('harvesting early is refused', early.status === 400 && early.body.error === 'not_ready');

  step(`grow (${growWheat}s)`);
  await waitUntil('wheat to ripen', async () => {
    const s = (await get('/api/farm')).body;
    return s.farm.tiles[0].ready ? s : null;
  }, (growWheat + 10) * 1000);
  ok('the server marked the crop ready', true);

  const stillThere = (await get('/api/farm')).body;
  ok('ready crops are NOT auto-harvested',
    stillThere.farm.tiles[0].crop === 'wheat' && (stillThere.farm.inventory.wheat ?? 0) === 12);

  step('harvest');
  let harvested;
  for (const tile of [0, 1, 2, 3]) harvested = (await post('/api/harvest', { tile })).body;
  ok('yield landed in the silo', harvested.farm.inventory.wheat === 24, `wheat=${harvested.farm.inventory.wheat}`);
  ok('XP was granted', harvested.farm.xp >= 4, `xp=${harvested.farm.xp}`);
  ok('tiles are empty again', harvested.farm.tiles.slice(0, 4).every((t) => t.crop === null));

  step('craft — Feed Mill');
  const queued = await post('/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
  ok('POST /api/machine/queue', queued.status === 200);
  const mill = queued.body.farm.machines.find((m) => m.machine === 'mill');
  ok('ingredients consumed atomically',
    queued.body.farm.inventory.wheat === 22 && queued.body.farm.inventory.corn === 5);
  ok('one job on the line, with an end time', mill.jobs.length === 1 && mill.jobs[0].endsAt);

  await post('/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
  const third = await post('/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
  const fourth = await post('/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
  ok('the queue holds exactly three slots',
    third.status === 200 && fourth.status === 400 && fourth.body.error === 'queue_full');

  const lockedRecipe = await post('/api/machine/queue', { machine: 'bakery', recipeOut: 'bread' });
  ok('a locked machine is refused', lockedRecipe.status === 400 && lockedRecipe.body.error === 'level_locked');

  const craftSec = config.body.machines.find((m) => m.id === 'mill').recipes[0].seconds;
  step(`wait out the queue (3 x ${craftSec}s, chained)`);
  const collected = await waitUntil('all three crafts', async () => {
    const s = (await get('/api/farm')).body;
    const m = s.farm.machines.find((x) => x.machine === 'mill');
    return m.jobs.length === 0 && (m.done.cfeed ?? 0) === 3 ? s : null;
  }, (craftSec * 3 + 20) * 1000);
  ok('jobs chained and all three finished', collected.farm.machines[0].done.cfeed === 3);
  ok('finished goods are NOT auto-collected', (collected.farm.inventory.cfeed ?? 0) === 2);

  const collect = await post('/api/machine/collect', { machine: 'mill' });
  ok('POST /api/machine/collect', collect.status === 200 && collect.body.farm.inventory.cfeed === 5);
  const nothing = await post('/api/machine/collect', { machine: 'mill' });
  ok('collecting an empty machine is refused', nothing.status === 400);

  step('animals — Chicken Coop');
  const fed = await post('/api/pen/feed', { pen: 'chicken' });
  ok('POST /api/pen/feed', fed.status === 200);
  const coop = fed.body.farm.pens.find((p) => p.pen === 'chicken');
  ok('four hens fed, feed consumed',
    coop.animals.filter((a) => a.state === 'full').length === 4 && (fed.body.farm.inventory.cfeed ?? 0) === 1);
  const lockedPen = await post('/api/pen/feed', { pen: 'sheep' });
  ok('a locked pen is refused', lockedPen.status === 400 && lockedPen.body.error === 'level_locked');

  const penSec = config.body.pens.find((p) => p.id === 'chicken').seconds;
  step(`wait for eggs (${penSec}s)`);
  await waitUntil('hens to produce', async () => {
    const s = (await get('/api/farm')).body;
    const p = s.farm.pens.find((x) => x.pen === 'chicken');
    return p.animals.every((a) => a.state === 'ready') ? s : null;
  }, (penSec + 20) * 1000);
  const eggs = await post('/api/pen/collect', { pen: 'chicken' });
  ok('POST /api/pen/collect', eggs.status === 200 && eggs.body.farm.inventory.egg === 4);
  ok('the hens are hungry again',
    eggs.body.farm.pens.find((p) => p.pen === 'chicken').animals.every((a) => a.state === 'hungry'));

  step('orders');
  const board = await get('/api/orders');
  ok('GET /api/orders returns a full board', board.status === 200 && board.body.orders.length === 4);
  const cached = await get('/api/orders');
  ok('the board is served from the Redis cache', cached.body.cached === true);

  const fillable = board.body.orders.find((o) => o.canFill);
  let afterOrders;
  if (fillable) {
    const before = (await get('/api/farm')).body;
    const delivered = await post('/api/orders/deliver', { orderId: fillable.id });
    ok('POST /api/orders/deliver', delivered.status === 200);
    ok('coins credited from the server-side reward formula',
      BigInt(delivered.body.farm.coins) > BigInt(before.farm.coins),
      `${before.farm.coins} → ${delivered.body.farm.coins}`);
    ok('$HAY credited', Number(delivered.body.farm.hay) >= Number(before.farm.hay));
    ok('the board refilled', delivered.body.orders.length === 4);
    const replay = await post('/api/orders/deliver', { orderId: fillable.id });
    ok('the same order cannot be delivered twice', replay.status === 404);
    afterOrders = delivered.body;
  } else {
    console.log('  note  nothing fillable on the board — exercising skip instead');
    const skipped = await post('/api/orders/skip', { orderId: board.body.orders[0].id });
    ok('POST /api/orders/skip', skipped.status === 200);
    afterOrders = skipped.body;
  }

  step('market');
  const market = await get('/api/market');
  ok('GET /api/market', market.status === 200 && market.body.listings.length === 6);
  const listing = market.body.listings.find((l) => l.qty > 0 && l.price <= Number(afterOrders.farm.coins));
  if (listing) {
    const bought = await post('/api/market/buy', { listingId: listing.id });
    ok('POST /api/market/buy', bought.status === 200);
    ok('the listed price was charged',
      BigInt(bought.body.farm.coins) === BigInt(afterOrders.farm.coins) - BigInt(listing.price),
      `-${listing.price}`);
  }
  const forged = await post('/api/market/buy', { listingId: 'made-up-listing' });
  ok('a made-up listing is refused', forged.status === 400);

  const beforeSell = (await get('/api/farm')).body;
  const sold = await post('/api/market/sell', { item: 'wheat', qty: 5 });
  ok('POST /api/market/sell', sold.status === 200);
  ok('paid at the config price, not a client price',
    BigInt(sold.body.farm.coins) === BigInt(beforeSell.farm.coins) + BigInt(3 * 5),
    `+${3 * 5}`);
  const oversell = await post('/api/market/sell', { item: 'syrup', qty: 1 });
  ok('selling what you do not have is refused', oversell.status === 400);

  step('expand');
  const beforeExpand = (await get('/api/farm')).body;
  const expand = await post('/api/expand', { target: 'silo' });
  if (expand.status === 200) {
    ok('POST /api/expand', expand.body.farm.siloCap === beforeExpand.farm.siloCap + 20);
    ok('coins and $HAY both spent',
      BigInt(expand.body.farm.coins) < BigInt(beforeExpand.farm.coins)
      && Number(expand.body.farm.hay) < Number(beforeExpand.farm.hay));
  } else {
    ok('expand refused for a clear reason',
      ['insufficient_coins', 'insufficient_hay'].includes(expand.body.error), expand.body.error);
  }

  step('persistence + audit');
  const final = (await get('/api/farm')).body;
  ok('the farm survives a fresh read',
    final.farm.inventory.egg === 4 && final.farm.siloUsed > 0,
    `silo ${final.farm.siloUsed}/${final.farm.siloCap}, barn ${final.farm.barnUsed}/${final.farm.barnCap}`);

  const badBody = await post('/api/plant', { tiles: [0], crop: 'wheat', extra: 'nope' });
  ok('unknown fields are rejected at the boundary', badBody.status === 400);

  console.log(`\n${passed} checks passed against ${BASE} (TIME_SCALE=${SCALE})\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
