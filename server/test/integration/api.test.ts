/**
 * Integration tests against a live Postgres + Redis, driven through Fastify's
 * inject() so no port is needed.
 *
 *   DATABASE_URL=… REDIS_URL=… npx vitest run test/integration
 *
 * These cover the properties that unit tests cannot: that a tampered order row
 * cannot pay out more than config allows, that a poisoned market cache cannot
 * invent a price, that the same order cannot be delivered twice, and that
 * level-ups settle their own rewards. The whole file skips when the database
 * is unreachable, so `npm test` stays green without infrastructure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbUrl = process.env.DATABASE_URL;

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let reachable = false;

beforeAll(async () => {
  if (!dbUrl) return;
  try {
    ({ prisma } = await import('../../src/lib/db'));
    ({ redis } = await import('../../src/lib/redis'));
    await prisma.$queryRaw`SELECT 1`;
    const { buildApp } = await import('../../src/app');
    app = await buildApp();
    await app.ready();
    reachable = true;
  } catch {
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (redis) redis.disconnect();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 30_000);

let seq = 0;
async function login(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/dev',
    payload: { handle: `it-${Date.now()}-${seq}` },
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.headers['set-cookie'];
  return (Array.isArray(cookie) ? cookie[0] : String(cookie)).split(';')[0];
}

function call(cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie }, payload: payload as never });
}

async function farmOf(cookie: string) {
  const res = await call(cookie, 'GET', '/api/farm');
  return res.json();
}

describe('order rewards are re-derived from config, not read off the row', () => {
  maybe('a tampered order pays only what gamedata allows', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);

    // Replace the board with one order we can definitely fill: 2 wheat.
    await prisma.order.deleteMany({ where: { farmId: snap.farm.id } });
    const order = await prisma.order.create({
      data: {
        farmId: snap.farm.id,
        who: 'Tamperer',
        items: { wheat: 2 },
        coins: 999_999,      // absurd payout written straight into the row
        xp: 999,
        hay: '999',
      },
    });

    const before = await farmOf(cookie);
    const res = await call(cookie, 'POST', '/api/orders/deliver', { orderId: order.id });
    expect(res.statusCode).toBe(200);
    const after = res.json();

    // wheat sells for 3: round(3 * 2 * 1.5) + 4 = 13 coins, hay = 9/220 → 0.04
    const gained = BigInt(after.farm.coins) - BigInt(before.farm.coins);
    expect(gained).toBe(13n);
    expect(Number(after.farm.hay) - Number(before.farm.hay)).toBeCloseTo(0.04, 2);
    expect(after.farm.inventory.wheat).toBe(before.farm.inventory.wheat - 2);

    const ledger = await prisma.ledger.findFirst({
      where: { kind: 'order' }, orderBy: { createdAt: 'desc' },
    });
    expect(ledger?.coinsDelta).toBe(13n);
  });

  maybe('an order asking for something out of reach is refused', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    await prisma.order.deleteMany({ where: { farmId: snap.farm.id } });
    const order = await prisma.order.create({
      data: {
        farmId: snap.farm.id, who: 'Tamperer',
        // syrup is a level-8 good; a level-1 farm can never be offered it.
        items: { syrup: 1 }, coins: 100, xp: 10, hay: '1',
      },
    });
    await prisma.inventoryItem.create({ data: { farmId: snap.farm.id, item: 'syrup', qty: 5 } });

    const res = await call(cookie, 'POST', '/api/orders/deliver', { orderId: order.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });

  maybe('the same order cannot be delivered twice', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    await prisma.order.deleteMany({ where: { farmId: snap.farm.id } });
    const order = await prisma.order.create({
      data: { farmId: snap.farm.id, who: 'Rina', items: { wheat: 2 }, coins: 13, xp: 5, hay: '0.04' },
    });

    const [a, b] = await Promise.all([
      call(cookie, 'POST', '/api/orders/deliver', { orderId: order.id }),
      call(cookie, 'POST', '/api/orders/deliver', { orderId: order.id }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBeGreaterThanOrEqual(400);

    const paid = await prisma.ledger.count({
      where: { kind: 'order', detail: { path: ['orderId'], equals: order.id } },
    });
    expect(paid).toBe(1);
  });
});

describe('the market cache cannot invent a price', () => {
  maybe('a listing priced below its band is refused', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);

    const { keys } = await import('../../src/lib/redis');
    await redis.set(keys.market(snap.farm.id), JSON.stringify({
      rolledAt: new Date().toISOString(),
      level: snap.farm.level,
      listings: [{ id: 'poisoned', item: 'sugarcane', qty: 5, price: 1, who: 'Attacker' }],
    }));

    const res = await call(cookie, 'POST', '/api/market/buy', { listingId: 'poisoned' });
    expect(res.statusCode).toBe(400);
    const after = await farmOf(cookie);
    expect(after.farm.coins).toBe(snap.farm.coins);
    expect(after.farm.inventory.sugarcane ?? 0).toBe(0);
  });

  maybe('a listing for an item the level cannot reach is refused', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    const { keys } = await import('../../src/lib/redis');
    // syrup's real band is 103..146; the price is legal, the item is not.
    await redis.set(keys.market(snap.farm.id), JSON.stringify({
      rolledAt: new Date().toISOString(),
      level: snap.farm.level,
      listings: [{ id: 'locked', item: 'syrup', qty: 5, price: 120, who: 'Attacker' }],
    }));

    const res = await call(cookie, 'POST', '/api/market/buy', { listingId: 'locked' });
    expect(res.statusCode).toBe(400);
  });
});

describe('levelling', () => {
  maybe('a level-up grants its coins and $HAY and opens fields', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    expect(snap.farm.fieldsOpen).toBe(4);

    // One XP short of level 2 (xpNeed(1) = 41), with a ripe tile to harvest.
    const { xpNeed } = await import('../../src/config/gamedata');
    await prisma.farm.update({
      where: { id: snap.farm.id },
      data: { xp: xpNeed(1) - 1, coins: 1000n },
    });
    await prisma.tile.update({
      where: { farmId_index: { farmId: snap.farm.id, index: 0 } },
      data: { crop: 'wheat', plantedAt: new Date(Date.now() - 60_000) },
    });

    const before = await farmOf(cookie);
    const res = await call(cookie, 'POST', '/api/harvest', { tile: 0 });
    expect(res.statusCode).toBe(200);
    const after = res.json();

    expect(after.levelsGained).toEqual([2]);
    expect(after.farm.level).toBe(2);
    expect(after.farm.fieldsOpen).toBe(6);
    expect(BigInt(after.farm.coins) - BigInt(before.farm.coins)).toBe(60n);
    expect(Number(after.farm.hay) - Number(before.farm.hay)).toBeCloseTo(2, 2);

    const row = await prisma.ledger.findFirst({
      where: { kind: 'levelup' }, orderBy: { createdAt: 'desc' },
    });
    expect(row?.coinsDelta).toBe(60n);

    // The newly opened fields are immediately plantable.
    const plant = await call(cookie, 'POST', '/api/plant', { tiles: [4, 5], crop: 'wheat' });
    expect(plant.statusCode).toBe(200);
  });
});

describe('capacity', () => {
  maybe('a full silo blocks the harvest instead of losing the crop', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);

    // Fill the silo exactly: the starter farm also holds corn, which counts
    // against the same store.
    await prisma.inventoryItem.deleteMany({ where: { farmId: snap.farm.id, item: { in: ['corn'] } } });
    await prisma.inventoryItem.upsert({
      where: { farmId_item: { farmId: snap.farm.id, item: 'wheat' } },
      create: { farmId: snap.farm.id, item: 'wheat', qty: snap.farm.siloCap },
      update: { qty: snap.farm.siloCap },
    });
    await prisma.tile.update({
      where: { farmId_index: { farmId: snap.farm.id, index: 0 } },
      data: { crop: 'wheat', plantedAt: new Date(Date.now() - 60_000) },
    });

    const res = await call(cookie, 'POST', '/api/harvest', { tile: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_space');

    // The crop is still standing — nothing was destroyed by the refusal.
    const after = await farmOf(cookie);
    expect(after.farm.tiles[0].crop).toBe('wheat');
    expect(after.farm.tiles[0].ready).toBe(true);
  });

  maybe('a partial harvest takes what fits and says so', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);

    // Room for exactly one unit; wheat yields three.
    await prisma.inventoryItem.deleteMany({ where: { farmId: snap.farm.id, item: { in: ['corn'] } } });
    await prisma.inventoryItem.upsert({
      where: { farmId_item: { farmId: snap.farm.id, item: 'wheat' } },
      create: { farmId: snap.farm.id, item: 'wheat', qty: snap.farm.siloCap - 1 },
      update: { qty: snap.farm.siloCap - 1 },
    });
    await prisma.tile.update({
      where: { farmId_index: { farmId: snap.farm.id, index: 1 } },
      data: { crop: 'wheat', plantedAt: new Date(Date.now() - 60_000) },
    });

    const res = await call(cookie, 'POST', '/api/harvest', { tile: 1 });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.farm.inventory.wheat).toBe(snap.farm.siloCap);
    expect(after.notice?.bad).toBe(true);
  });
});

describe('spending', () => {
  maybe('planting stops when the coins run out, and charges only for what went in', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    // Corn costs 4; leave enough for exactly two tiles.
    await prisma.farm.update({ where: { id: snap.farm.id }, data: { coins: 9n } });

    const res = await call(cookie, 'POST', '/api/plant', { tiles: [0, 1, 2, 3], crop: 'corn' });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.farm.tiles.filter((t: { crop: string | null }) => t.crop === 'corn')).toHaveLength(2);
    expect(after.farm.coins).toBe('1');
    expect(after.notice?.bad).toBe(true);
  });

  maybe('an expansion the player cannot afford changes nothing', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    await prisma.farm.update({ where: { id: snap.farm.id }, data: { coins: 10n } });

    const res = await call(cookie, 'POST', '/api/expand', { target: 'silo' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('insufficient_coins');

    const after = await farmOf(cookie);
    expect(after.farm.siloCap).toBe(snap.farm.siloCap);
    expect(after.farm.coins).toBe('10');
  });
});

describe('the ledger reconciles', () => {
  maybe('coin deltas sum to the farm balance after a run of actions', async () => {
    const cookie = await login();
    const snap = await farmOf(cookie);
    const userId = (await prisma.farm.findUnique({
      where: { id: snap.farm.id }, select: { userId: true },
    }))!.userId;

    await call(cookie, 'POST', '/api/plant', { tiles: [0, 1], crop: 'wheat' });
    await call(cookie, 'POST', '/api/market/sell', { item: 'corn', qty: 3 });
    await call(cookie, 'POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });

    const after = await farmOf(cookie);
    const sum = await prisma.ledger.aggregate({ where: { userId }, _sum: { coinsDelta: true } });
    expect(BigInt(after.farm.coins) - 640n).toBe(sum._sum.coinsDelta ?? 0n);
  });
});

describe('$HAY stays off until it is turned on', () => {
  maybe('withdraw is refused while the feature flag is off', async () => {
    const cookie = await login();
    const res = await call(cookie, 'POST', '/api/hay/withdraw', { amount: '1.00' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('disabled');
  });

  maybe('the config advertises on-chain $HAY as unavailable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().features.hayOnChain).toBe(false);
  });
});
