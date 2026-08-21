/**
 * The v1 definition of done, exercised in full (HANDOFF §10).
 *
 * A level-1 farm can only reach the Feed Mill and the Chicken Coop, so the
 * rest of the production chain — the Bakery, the Dairy, the Sugar Mill, the
 * Cow Pasture and the Sheep Fold, and the recipes gated behind levels 4 to 8 —
 * is unreachable without a very long grind. These tests set the farm's level
 * directly and then drive every system through the real API.
 *
 * Timers are settled by backdating the stored start timestamp rather than by
 * sleeping: the whole point of the lazy resolver is that a job's completion is
 * a function of its start time and the clock, so moving the start time back is
 * exactly equivalent to waiting, and it keeps the suite fast.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbTest } from './harness';
import type { FastifyInstance } from 'fastify';
import { MACHINES, PENS, scaled } from '../../src/config/gamedata';

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let reachable = false;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
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

const maybe = dbTest(() => reachable, 60_000);

let seq = 0;

interface Player {
  cookie: string;
  farmId: string;
}

/** A signed-in player at `level`, with a large silo/barn and the given stock. */
async function player(level: number, stock: Record<string, number> = {}): Promise<Player> {
  seq += 1;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/dev',
    payload: { handle: `chain-${Date.now()}-${seq}` },
  });
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];

  const farm = await prisma.farm.findFirstOrThrow({ where: { user: { email: { contains: 'chain-' } } }, orderBy: { createdAt: 'desc' } });
  await prisma.farm.update({
    where: { id: farm.id },
    data: { level, coins: 100_000n, hay: '500', siloCap: 400, barnCap: 400 },
  });
  await prisma.inventoryItem.deleteMany({ where: { farmId: farm.id } });
  const entries = Object.entries(stock).filter(([, qty]) => qty > 0);
  if (entries.length) {
    await prisma.inventoryItem.createMany({
      data: entries.map(([item, qty]) => ({ farmId: farm.id, item, qty })),
    });
  }
  return { cookie, farmId: farm.id };
}

function call(p: Player, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie: p.cookie }, payload: payload as never });
}

async function farmOf(p: Player) {
  const res = await call(p, 'GET', '/api/farm');
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** Move a machine's queue back in time so every queued job has finished. */
async function fastForwardMachine(p: Player, machine: string, seconds: number) {
  const row = await prisma.machineState.findFirstOrThrow({
    where: { farmId: p.farmId, machine },
  });
  const jobs = (row.jobs as Array<{ out: string; sec: number; startedAt: string | null }>)
    .map((j, i) => (i === 0 && j.startedAt
      ? { ...j, startedAt: new Date(Date.parse(j.startedAt) - seconds * 1000).toISOString() }
      : j));
  await prisma.machineState.update({ where: { id: row.id }, data: { jobs } });
}

/** Move a pen back in time so every fed animal has produced. */
async function fastForwardPen(p: Player, pen: string, seconds: number) {
  const row = await prisma.penState.findFirstOrThrow({ where: { farmId: p.farmId, pen } });
  const animals = (row.animals as Array<{ state: string; fedAt: string | null }>)
    .map((a) => (a.state === 'full' && a.fedAt
      ? { ...a, fedAt: new Date(Date.parse(a.fedAt) - seconds * 1000).toISOString() }
      : a));
  await prisma.penState.update({ where: { id: row.id }, data: { animals } });
}

/* ================= EVERY MACHINE, EVERY RECIPE ================= */

describe('crafting through every machine', () => {
  for (const machine of MACHINES) {
    for (const recipe of machine.recipes) {
      maybe(`${machine.name}: ${recipe.out} from ${Object.keys(recipe.inp).join(' + ')}`, async () => {
        // At the level this recipe actually asks for, not a number that
        // happened to clear every recipe the day this was written — a level
        // 10 player cannot make jam, and the server is right to say so.
        const p = await player(Math.max(machine.lvl, recipe.lvl), recipe.inp);

        const queued = await call(p, 'POST', '/api/machine/queue', {
          machine: machine.id, recipeOut: recipe.out,
        });
        expect(queued.statusCode).toBe(200);

        const mid = queued.json();
        const view = mid.farm.machines.find((m: { machine: string }) => m.machine === machine.id);
        expect(view.jobs).toHaveLength(1);
        expect(view.jobs[0].out).toBe(recipe.out);
        // Every ingredient was consumed.
        for (const id of Object.keys(recipe.inp)) expect(mid.farm.inventory[id] ?? 0).toBe(0);
        // Nothing to collect before the timer is up.
        const early = await call(p, 'POST', '/api/machine/collect', { machine: machine.id });
        expect(early.statusCode).toBe(400);

        await fastForwardMachine(p, machine.id, scaled(recipe.sec) + 1);

        const collected = await call(p, 'POST', '/api/machine/collect', { machine: machine.id });
        expect(collected.statusCode).toBe(200);
        const after = collected.json();
        expect(after.farm.inventory[recipe.out]).toBe(1);
        expect(after.farm.machines.find((m: { machine: string }) => m.machine === machine.id).jobs).toHaveLength(0);
      });
    }
  }

  maybe('a recipe is refused without every ingredient', async () => {
    const cake = MACHINES.find((m) => m.id === 'bakery')!.recipes.find((r) => r.out === 'cake')!;
    // One short on eggs.
    const p = await player(10, { ...cake.inp, egg: cake.inp.egg - 1 });
    const res = await call(p, 'POST', '/api/machine/queue', { machine: 'bakery', recipeOut: 'cake' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_items');

    // Nothing was consumed by the refusal.
    const after = await farmOf(p);
    expect(after.farm.inventory.carrot).toBe(cake.inp.carrot);
    expect(after.farm.inventory.sugar).toBe(cake.inp.sugar);
  });

  maybe('every recipe is gated by its own level, not just the machine', async () => {
    // Level 6 opens the Sugar Mill, but syrup needs level 8.
    const syrup = MACHINES.find((m) => m.id === 'sugar')!.recipes.find((r) => r.out === 'syrup')!;
    const p = await player(6, syrup.inp);
    const res = await call(p, 'POST', '/api/machine/queue', { machine: 'sugar', recipeOut: 'syrup' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('level_locked');
  });
});

/* ================= EVERY PEN ================= */

describe('tending all three pens', () => {
  for (const pen of PENS) {
    maybe(`${pen.name}: ${pen.feed} → ${pen.out}`, async () => {
      const p = await player(10, { [pen.feed]: pen.count });

      const fed = await call(p, 'POST', '/api/pen/feed', { pen: pen.id });
      expect(fed.statusCode).toBe(200);
      const midView = fed.json().farm.pens.find((x: { pen: string }) => x.pen === pen.id);
      expect(midView.animals.filter((a: { state: string }) => a.state === 'full')).toHaveLength(pen.count);
      expect(fed.json().farm.inventory[pen.feed] ?? 0).toBe(0);

      // Nothing to collect while they are still working.
      const early = await call(p, 'POST', '/api/pen/collect', { pen: pen.id });
      expect(early.statusCode).toBe(400);

      await fastForwardPen(p, pen.id, scaled(pen.sec) + 1);

      const collected = await call(p, 'POST', '/api/pen/collect', { pen: pen.id });
      expect(collected.statusCode).toBe(200);
      const after = collected.json();
      expect(after.farm.inventory[pen.out]).toBe(pen.count);
      const penView = after.farm.pens.find((x: { pen: string }) => x.pen === pen.id);
      expect(penView.animals.every((a: { state: string }) => a.state === 'hungry')).toBe(true);
    });
  }

  maybe('a single animal can be fed and collected on its own', async () => {
    const coop = PENS.find((p) => p.id === 'chicken')!;
    const p = await player(10, { [coop.feed]: 5 });

    const fed = await call(p, 'POST', '/api/pen/feed', { pen: coop.id, index: 2 });
    expect(fed.statusCode).toBe(200);
    const states = fed.json().farm.pens.find((x: { pen: string }) => x.pen === coop.id).animals;
    expect(states[2].state).toBe('full');
    expect(states.filter((a: { state: string }) => a.state === 'full')).toHaveLength(1);
    expect(fed.json().farm.inventory[coop.feed]).toBe(4);

    await fastForwardPen(p, coop.id, scaled(coop.sec) + 1);
    const collected = await call(p, 'POST', '/api/pen/collect', { pen: coop.id, index: 2 });
    expect(collected.statusCode).toBe(200);
    expect(collected.json().farm.inventory[coop.out]).toBe(1);
  });

  maybe('feeding without feed is refused', async () => {
    const p = await player(10, {});
    const res = await call(p, 'POST', '/api/pen/feed', { pen: 'cow' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_items');
  });
});

/* ================= THE WHOLE CHAIN ================= */

describe('the production chain end to end', () => {
  maybe('field → mill → coop → bakery produces a Carrot Cake', async () => {
    // Cake needs carrot 2, egg 2, sugar 1. The eggs have to come from hens,
    // the hens need feed from the mill, and the sugar from the Sugar Mill —
    // so this walks the entire chain rather than shortcutting with inventory.
    const p = await player(10, { wheat: 4, corn: 2, carrot: 2, sugarcane: 2 });

    // 1. Mill: wheat + corn → chicken feed, twice.
    for (let i = 0; i < 2; i += 1) {
      const r = await call(p, 'POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
      expect(r.statusCode).toBe(200);
    }
    await fastForwardMachine(p, 'mill', scaled(14) * 2 + 1);
    expect((await call(p, 'POST', '/api/machine/collect', { machine: 'mill' })).statusCode).toBe(200);
    expect((await farmOf(p)).farm.inventory.cfeed).toBe(2);

    // 2. Sugar Mill: sugarcane → sugar.
    expect((await call(p, 'POST', '/api/machine/queue', { machine: 'sugar', recipeOut: 'sugar' })).statusCode).toBe(200);
    await fastForwardMachine(p, 'sugar', scaled(30) + 1);
    expect((await call(p, 'POST', '/api/machine/collect', { machine: 'sugar' })).statusCode).toBe(200);
    expect((await farmOf(p)).farm.inventory.sugar).toBe(1);

    // 3. Coop: feed two hens, collect two eggs.
    expect((await call(p, 'POST', '/api/pen/feed', { pen: 'chicken' })).statusCode).toBe(200);
    await fastForwardPen(p, 'chicken', scaled(30) + 1);
    expect((await call(p, 'POST', '/api/pen/collect', { pen: 'chicken' })).statusCode).toBe(200);
    expect((await farmOf(p)).farm.inventory.egg).toBe(2);

    // 4. Bakery: carrot + egg + sugar → Carrot Cake.
    const bake = await call(p, 'POST', '/api/machine/queue', { machine: 'bakery', recipeOut: 'cake' });
    expect(bake.statusCode).toBe(200);
    await fastForwardMachine(p, 'bakery', scaled(55) + 1);
    const done = await call(p, 'POST', '/api/machine/collect', { machine: 'bakery' });
    expect(done.statusCode).toBe(200);

    const final = done.json();
    expect(final.farm.inventory.cake).toBe(1);
    // Everything upstream was consumed on the way.
    for (const spent of ['wheat', 'corn', 'carrot', 'sugarcane', 'cfeed', 'sugar', 'egg']) {
      expect(final.farm.inventory[spent] ?? 0).toBe(0);
    }
  });

  maybe('the ledger records every step of that chain', async () => {
    const p = await player(10, { milk: 3, sugar: 1 });
    const userId = (await prisma.farm.findUniqueOrThrow({
      where: { id: p.farmId }, select: { userId: true },
    })).userId;

    await call(p, 'POST', '/api/machine/queue', { machine: 'dairy', recipeOut: 'butter' });
    await fastForwardMachine(p, 'dairy', scaled(45) + 1);
    await call(p, 'POST', '/api/machine/collect', { machine: 'dairy' });
    await call(p, 'POST', '/api/market/sell', { item: 'butter', qty: 1 });

    const kinds = (await prisma.ledger.findMany({
      where: { userId }, orderBy: { createdAt: 'asc' }, select: { kind: true },
    })).map((r) => r.kind);
    expect(kinds).toContain('craft');
    expect(kinds).toContain('collect');
    expect(kinds).toContain('sell');

    const sum = await prisma.ledger.aggregate({ where: { userId }, _sum: { coinsDelta: true } });
    const after = await farmOf(p);
    // The farm started this test at 100,000 coins.
    expect(BigInt(after.farm.coins) - 100_000n).toBe(sum._sum.coinsDelta ?? 0n);
  });
});

/* ================= EXPANSION AND HIGH-LEVEL BOARD ================= */

describe('the rest of the loop at a high level', () => {
  maybe('both silo and barn expand, and the price scales with capacity', async () => {
    const p = await player(10, {});
    const start = await farmOf(p);

    const silo = await call(p, 'POST', '/api/expand', { target: 'silo' });
    expect(silo.statusCode).toBe(200);
    expect(silo.json().farm.siloCap).toBe(start.farm.siloCap + 20);

    const barn = await call(p, 'POST', '/api/expand', { target: 'barn' });
    expect(barn.statusCode).toBe(200);
    expect(barn.json().farm.barnCap).toBe(start.farm.barnCap + 20);

    // The next silo upgrade costs more, because the price is capacity × 8.
    const before = BigInt(barn.json().farm.coins);
    const again = await call(p, 'POST', '/api/expand', { target: 'silo' });
    expect(again.statusCode).toBe(200);
    const spent = before - BigInt(again.json().farm.coins);
    expect(spent).toBe(BigInt((start.farm.siloCap + 20) * 8));
  });

  maybe('the order board offers high-level goods once they are reachable', async () => {
    const p = await player(10, {});
    // Clear whatever the level-1 board held and let it regenerate at level 10.
    await prisma.order.deleteMany({ where: { farmId: p.farmId } });
    await prisma.farm.update({ where: { id: p.farmId }, data: { ordersFilledAt: new Date(0) } });

    const snap = await farmOf(p);
    expect(snap.orders).toHaveLength(4);

    const offered = new Set<string>();
    for (const o of snap.orders) for (const id of Object.keys(o.items)) offered.add(id);
    // Everything offered must be something a level-10 farm can actually make.
    const { sellables } = await import('../../src/config/gamedata');
    const reachable = new Set(sellables(10));
    for (const id of offered) expect(reachable.has(id)).toBe(true);
  });

  maybe('market listings at level 10 stay inside the generated price band', async () => {
    const p = await player(10, {});
    const { keys } = await import('../../src/lib/redis');
    await redis.del(keys.market(p.farmId));

    const res = await call(p, 'GET', '/api/market');
    expect(res.statusCode).toBe(200);
    const { listings } = res.json();
    expect(listings).toHaveLength(6);

    const { priceBand } = await import('../../src/engine/market');
    for (const l of listings) {
      const band = priceBand(l.item);
      expect(l.price).toBeGreaterThanOrEqual(band.min);
      expect(l.price).toBeLessThanOrEqual(band.max);
      expect(l.qty).toBeGreaterThan(0);
    }
  });
});
