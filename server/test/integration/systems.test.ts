/**
 * The systems added on top of the v1 loop: the $HAY sink, late-game capacity
 * upgrades, daily tasks, the login streak, the away summary, player identity
 * and the operator tools.
 *
 * The rules these prove are the same ones the rest of the API follows — a
 * reward is read from config rather than from the row, nothing can be claimed
 * twice, and a client cannot advance its own progress.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWallet } from './_wallet';
import type { FastifyInstance } from 'fastify';
import {
  DAILY, SPEEDUP, TASK_TEMPLATES, UPGRADES, dayKey, machineDef, penDef, scaled,
} from '../../src/config/gamedata';

process.env.ADMIN_TOKEN = 'integration-admin-token-0123456789';

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
  delete process.env.ADMIN_TOKEN;
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 60_000);

let seq = 0;
interface Player { cookie: string; farmId: string; userId: string }

async function player(over: {
  level?: number; hay?: string; coins?: bigint; stock?: Record<string, number>;
} = {}): Promise<Player> {
  seq += 1;
  const handle = `sys-${Date.now()}-${seq}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { handle } });
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: `${handle.toLowerCase()}@dev.local` }, include: { farm: true },
  });
  const farmId = user.farm!.id;
  await prisma.farm.update({
    where: { id: farmId },
    data: {
      level: over.level ?? 1,
      hay: over.hay ?? '50',
      coins: over.coins ?? 100_000n,
      siloCap: 400,
      barnCap: 400,
    },
  });
  if (over.stock) {
    await prisma.inventoryItem.deleteMany({ where: { farmId } });
    await prisma.inventoryItem.createMany({
      data: Object.entries(over.stock).map(([item, qty]) => ({ farmId, item, qty })),
    });
  }
  return { cookie, farmId, userId: user.id };
}

function call(p: Player, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie: p.cookie }, payload: payload as never });
}

async function farmOf(p: Player) {
  const res = await call(p, 'GET', '/api/farm');
  expect(res.statusCode).toBe(200);
  return res.json();
}

/* ================= SPEED-UP: THE $HAY SINK ================= */

describe('speed-up', () => {
  maybe('finishes a crop and takes $HAY for it', async () => {
    const p = await player({ hay: '50' });
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'sugarcane' })
      .then(() => prisma.farm.update({ where: { id: p.farmId }, data: { level: 6 } }));
    await call(p, 'POST', '/api/plant', { tiles: [1], crop: 'sugarcane' });

    const before = await farmOf(p);
    const growing = before.farm.tiles.find((t: { crop: string | null }) => t.crop === 'sugarcane');
    expect(growing.ready).toBe(false);

    const quote = await call(p, 'GET', '/api/speedup/quote');
    const priced = quote.json().tiles.find((t: { index: number }) => t.index === growing.index);
    expect(priced.hay).toMatch(/^\d+\.\d{2}$/);

    const res = await call(p, 'POST', '/api/speedup', { target: 'tile', index: growing.index });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.farm.tiles[growing.index].ready).toBe(true);
    expect(Number(before.farm.hay) - Number(after.farm.hay)).toBeCloseTo(Number(priced.hay), 2);

    // And it can then be harvested normally.
    expect((await call(p, 'POST', '/api/harvest', { tile: growing.index })).statusCode).toBe(200);
  });

  maybe('writes a ledger row for every $HAY it burns', async () => {
    const p = await player({ hay: '50' });
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'corn' });
    await call(p, 'POST', '/api/speedup', { target: 'tile', index: 0 });

    const row = await prisma.ledger.findFirstOrThrow({
      where: { userId: p.userId, kind: 'speedup' }, orderBy: { createdAt: 'desc' },
    });
    expect(Number(row.hayDelta)).toBeLessThan(0);
    expect((row.detail as { target: string }).target).toBe('tile');
  });

  maybe('skips a whole machine queue at once', async () => {
    const p = await player({ hay: '50', stock: { wheat: 20, corn: 10 } });
    for (let i = 0; i < 3; i += 1) {
      expect((await call(p, 'POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' })).statusCode).toBe(200);
    }
    const before = await farmOf(p);
    expect(before.farm.machines[0].jobs).toHaveLength(3);

    const res = await call(p, 'POST', '/api/speedup', { target: 'machine', machine: 'mill' });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    const mill = after.farm.machines.find((m: { machine: string }) => m.machine === 'mill');
    expect(mill.jobs).toHaveLength(0);
    expect(mill.done.cfeed).toBe(3);
    // Three jobs' worth of time costs more than one job's would have.
    expect(Number(before.farm.hay) - Number(after.farm.hay)).toBeGreaterThan(
      scaled(14) / 60 * SPEEDUP.hayPerMinute,
    );
  });

  maybe('brings a whole pen forward', async () => {
    const p = await player({ hay: '50', stock: { cfeed: 4 } });
    expect((await call(p, 'POST', '/api/pen/feed', { pen: 'chicken' })).statusCode).toBe(200);

    const res = await call(p, 'POST', '/api/speedup', { target: 'pen', pen: 'chicken' });
    expect(res.statusCode).toBe(200);
    const coop = res.json().farm.pens.find((x: { pen: string }) => x.pen === 'chicken');
    expect(coop.animals.every((a: { state: string }) => a.state === 'ready')).toBe(true);

    expect((await call(p, 'POST', '/api/pen/collect', { pen: 'chicken' })).statusCode).toBe(200);
  });

  maybe('refuses a timer that is already finished, and one that never started', async () => {
    const p = await player({ hay: '50' });
    const empty = await call(p, 'POST', '/api/speedup', { target: 'tile', index: 0 });
    expect(empty.statusCode).toBe(400);

    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    await prisma.tile.update({
      where: { farmId_index: { farmId: p.farmId, index: 0 } },
      data: { plantedAt: new Date(Date.now() - 600_000) },
    });
    const done = await call(p, 'POST', '/api/speedup', { target: 'tile', index: 0 });
    expect(done.statusCode).toBe(400);

    const idle = await call(p, 'POST', '/api/speedup', { target: 'machine', machine: 'mill' });
    expect(idle.statusCode).toBe(400);
  });

  maybe('refuses when the player cannot afford it, and changes nothing', async () => {
    const p = await player({ hay: '0' });
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'corn' });

    const res = await call(p, 'POST', '/api/speedup', { target: 'tile', index: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('insufficient_hay');

    const after = await farmOf(p);
    expect(after.farm.tiles[0].ready).toBe(false);
    expect(after.farm.hay).toBe('0.00');
  });
});

/* ================= CAPACITY UPGRADES ================= */

describe('capacity upgrades', () => {
  maybe('an extra machine slot is level-gated, costs both currencies, and is usable', async () => {
    const mill = machineDef('mill')!;
    const p = await player({ level: 10, hay: '50', stock: { wheat: 40, corn: 20 } });

    const early = await call(p, 'POST', '/api/upgrade', { target: 'machineSlot', machine: 'mill' });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe('level_locked');

    await prisma.farm.update({ where: { id: p.farmId }, data: { level: UPGRADES.machineSlot.levels[0] } });
    const before = await farmOf(p);

    const res = await call(p, 'POST', '/api/upgrade', { target: 'machineSlot', machine: 'mill' });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    const view = after.farm.machines.find((m: { machine: string }) => m.machine === 'mill');
    expect(view.slots).toBe(mill.slots + 1);
    expect(view.extraSlots).toBe(1);
    expect(BigInt(before.farm.coins) - BigInt(after.farm.coins)).toBe(BigInt(UPGRADES.machineSlot.coins[0]));
    expect(Number(before.farm.hay) - Number(after.farm.hay)).toBeCloseTo(Number(UPGRADES.machineSlot.hay[0]), 2);

    // The fourth job now fits, where it would have been refused before.
    for (let i = 0; i < mill.slots + 1; i += 1) {
      expect((await call(p, 'POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' })).statusCode).toBe(200);
    }
    const full = await call(p, 'POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' });
    expect(full.statusCode).toBe(400);
    expect(full.json().error).toBe('queue_full');
  });

  maybe('an extra animal joins the pen and can be fed like the rest', async () => {
    const coop = penDef('chicken')!;
    const p = await player({
      level: UPGRADES.penAnimal.levels[0], hay: '50', stock: { cfeed: 10 },
    });

    const res = await call(p, 'POST', '/api/upgrade', { target: 'penAnimal', pen: 'chicken' });
    expect(res.statusCode).toBe(200);
    const pen = res.json().farm.pens.find((x: { pen: string }) => x.pen === 'chicken');
    expect(pen.animals).toHaveLength(coop.count + 1);
    expect(pen.animals[coop.count].state).toBe('hungry');

    const fed = await call(p, 'POST', '/api/pen/feed', { pen: 'chicken' });
    expect(fed.json().farm.pens[0].animals.filter((a: { state: string }) => a.state === 'full'))
      .toHaveLength(coop.count + 1);
  });

  maybe('an upgrade stops at its maximum', async () => {
    const p = await player({ level: 20, hay: '500', coins: 10_000_000n });
    for (let i = 0; i < UPGRADES.machineSlot.maxExtra; i += 1) {
      expect((await call(p, 'POST', '/api/upgrade', { target: 'machineSlot', machine: 'mill' })).statusCode).toBe(200);
    }
    const beyond = await call(p, 'POST', '/api/upgrade', { target: 'machineSlot', machine: 'mill' });
    expect(beyond.statusCode).toBe(400);
    expect(beyond.json().message).toContain('every slot');
  });

  maybe('an unaffordable upgrade changes nothing', async () => {
    const p = await player({ level: 20, hay: '0', coins: 10n });
    const res = await call(p, 'POST', '/api/upgrade', { target: 'machineSlot', machine: 'mill' });
    expect(res.statusCode).toBe(400);
    const after = await farmOf(p);
    expect(after.farm.machines.find((m: { machine: string }) => m.machine === 'mill').extraSlots).toBe(0);
    expect(after.farm.coins).toBe('10');
  });
});

/* ================= LEVEL CURVE TO 20 ================= */

describe('the extended level curve', () => {
  maybe('fields keep opening past the old level-10 ceiling', async () => {
    const p = await player({ level: 10 });
    expect((await farmOf(p)).farm.fieldsOpen).toBe(12);

    await prisma.farm.update({ where: { id: p.farmId }, data: { level: 20 } });
    const late = await farmOf(p);
    expect(late.farm.fieldsOpen).toBe(24);
    expect(late.farm.tiles).toHaveLength(24);

    // And the newly opened ground is actually plantable.
    const plant = await call(p, 'POST', '/api/plant', { tiles: [20, 21, 22, 23], crop: 'wheat' });
    expect(plant.statusCode).toBe(200);
    expect(plant.json().farm.tiles.filter((t: { crop: string | null }) => t.crop === 'wheat')).toHaveLength(4);
  });
});

/* ================= DAILY TASKS ================= */

describe('daily tasks', () => {
  maybe('three appear, and only real play advances them', async () => {
    const p = await player({ stock: { wheat: 30 } });
    const snap = await farmOf(p);
    expect(snap.tasks).toHaveLength(DAILY.taskCount);
    expect(snap.tasks.every((t: { progress: number }) => t.progress === 0)).toBe(true);

    // Force a known task so the assertion does not depend on the daily roll.
    await prisma.dailyTask.deleteMany({ where: { farmId: p.farmId } });
    const template = TASK_TEMPLATES.find((t) => t.key === 'plant')!;
    await prisma.dailyTask.create({
      data: {
        farmId: p.farmId, day: dayKey(new Date()), kind: 'plant', target: template.target,
        rewardCoins: template.coins, rewardHay: template.hay, rewardXp: template.xp,
      },
    });

    await call(p, 'POST', '/api/plant', { tiles: [0, 1, 2], crop: 'wheat' });
    const after = await farmOf(p);
    const task = after.tasks.find((t: { kind: string }) => t.kind === 'plant');
    expect(task.progress).toBe(3);
    expect(task.done).toBe(false);
  });

  maybe('a finished task pays what config says, not what the row says', async () => {
    // Level 8 leaves plenty of XP headroom, so the payout under test is not
    // mixed up with a level-up bonus.
    const p = await player({ level: 8 });
    const template = TASK_TEMPLATES.find((t) => t.key === 'plant')!;
    const others = TASK_TEMPLATES.filter((t) => t.key !== 'plant').slice(0, 2);
    await prisma.dailyTask.deleteMany({ where: { farmId: p.farmId } });
    await prisma.dailyTask.create({
      data: {
        farmId: p.farmId, day: dayKey(new Date()), kind: 'plant',
        target: template.target, progress: template.target,
        // Absurd rewards written straight into the row.
        rewardCoins: 999_999, rewardHay: '999', rewardXp: 9_999,
      },
    });
    // Two unfinished tasks alongside, so the all-done bonus stays out of it.
    await prisma.dailyTask.createMany({
      data: others.map((t) => ({
        farmId: p.farmId, day: dayKey(new Date()), kind: t.key, target: t.target,
        rewardCoins: t.coins, rewardHay: t.hay, rewardXp: t.xp,
      })),
    });

    const before = await farmOf(p);
    const res = await call(p, 'POST', '/api/tasks/claim', { kind: 'plant' });
    expect(res.statusCode).toBe(200);
    const after = res.json();

    expect(BigInt(after.farm.coins) - BigInt(before.farm.coins)).toBe(BigInt(template.coins));
    expect(Number(after.farm.hay) - Number(before.farm.hay)).toBeCloseTo(Number(template.hay), 2);
  });

  maybe('an unfinished task cannot be claimed, and a finished one only once', async () => {
    const p = await player();
    const template = TASK_TEMPLATES.find((t) => t.key === 'plant')!;
    await prisma.dailyTask.deleteMany({ where: { farmId: p.farmId } });
    await prisma.dailyTask.create({
      data: {
        farmId: p.farmId, day: dayKey(new Date()), kind: 'plant',
        target: template.target, progress: template.target - 1,
        rewardCoins: template.coins, rewardHay: template.hay, rewardXp: template.xp,
      },
    });

    const tooEarly = await call(p, 'POST', '/api/tasks/claim', { kind: 'plant' });
    expect(tooEarly.statusCode).toBe(400);

    await prisma.dailyTask.updateMany({
      where: { farmId: p.farmId, kind: 'plant' }, data: { progress: template.target },
    });

    const [a, b] = await Promise.all([
      call(p, 'POST', '/api/tasks/claim', { kind: 'plant' }),
      call(p, 'POST', '/api/tasks/claim', { kind: 'plant' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    expect(await prisma.ledger.count({ where: { userId: p.userId, kind: 'task_reward' } })).toBe(1);
  });

  maybe('finishing every task pays the all-done bonus once', async () => {
    // High enough that the tasks' XP cannot trigger a level-up and blur the sum.
    const p = await player({ level: 12 });
    const day = dayKey(new Date());
    await prisma.dailyTask.deleteMany({ where: { farmId: p.farmId } });
    const chosen = TASK_TEMPLATES.slice(0, DAILY.taskCount);
    await prisma.dailyTask.createMany({
      data: chosen.map((t) => ({
        farmId: p.farmId, day, kind: t.key, target: t.target, progress: t.target,
        rewardCoins: t.coins, rewardHay: t.hay, rewardXp: t.xp,
      })),
    });

    const before = await farmOf(p);
    for (const t of chosen) {
      expect((await call(p, 'POST', '/api/tasks/claim', { kind: t.key })).statusCode).toBe(200);
    }
    const after = await farmOf(p);

    const taskCoins = chosen.reduce((sum, t) => sum + t.coins, 0);
    expect(BigInt(after.farm.coins) - BigInt(before.farm.coins))
      .toBe(BigInt(taskCoins + DAILY.allDoneBonus.coins));
    expect(await prisma.ledger.count({ where: { userId: p.userId, kind: 'task_bonus' } })).toBe(1);
  });
});

/* ================= LOGIN STREAK ================= */

describe('login streak', () => {
  maybe('pays once a day and refuses a second claim', async () => {
    const p = await player();
    const before = await farmOf(p);
    expect(before.streak.claimedToday).toBe(false);

    const first = await call(p, 'POST', '/api/daily/claim', {});
    expect(first.statusCode).toBe(200);
    expect(first.json().streak.claimedToday).toBe(true);
    expect(BigInt(first.json().farm.coins) - BigInt(before.farm.coins))
      .toBe(BigInt(DAILY.streakCoins[0]));

    const [a, b] = await Promise.all([
      call(p, 'POST', '/api/daily/claim', {}),
      call(p, 'POST', '/api/daily/claim', {}),
    ]);
    expect(a.statusCode).toBe(400);
    expect(b.statusCode).toBe(400);
    expect(await prisma.ledger.count({ where: { userId: p.userId, kind: 'streak' } })).toBe(1);
  });

  maybe('the next day pays the next step up', async () => {
    const p = await player();
    const yesterday = new Date(Date.now() - 20 * 3600 * 1000);
    await prisma.farm.update({
      where: { id: p.farmId },
      data: {
        streakDays: 2,
        streakClaimedOn: dayKey(yesterday),
        lastSeenAt: yesterday,
      },
    });

    const res = await call(p, 'POST', '/api/daily/claim', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().streak.day).toBe(3);
  });
});

/* ================= AWAY SUMMARY ================= */

describe('while you were away', () => {
  maybe('summarises what finished during a real absence', async () => {
    const p = await player({ stock: { wheat: 10 } });
    await call(p, 'POST', '/api/plant', { tiles: [0, 1], crop: 'wheat' });

    // Two hours ago they left; the wheat ripened right after.
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await prisma.farm.update({ where: { id: p.farmId }, data: { lastSeenAt: twoHoursAgo } });
    await prisma.tile.updateMany({
      where: { farmId: p.farmId, crop: 'wheat' },
      data: { plantedAt: new Date(twoHoursAgo.getTime() + 60_000) },
    });

    const res = await call(p, 'GET', '/api/farm');
    const away = res.json().away;
    expect(away).toBeTruthy();
    expect(away.cropsReady).toBe(2);
    expect(away.awaySec).toBeGreaterThan(7000);
    expect(away.waiting).toEqual([{ item: 'wheat', qty: 2 }]);

    // Only on the first read back: presence is now up to date.
    expect((await call(p, 'GET', '/api/farm')).json().away).toBeUndefined();
  });

  maybe('says nothing when the player was only gone a moment', async () => {
    const p = await player();
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    expect((await call(p, 'GET', '/api/farm')).json().away).toBeUndefined();
  });
});

/* ================= IDENTITY + LEADERBOARD ================= */

describe('identity', () => {
  maybe('names are set, shown, and cannot be duplicated', async () => {
    const a = await player();
    const name = `Ayu${Date.now() % 1_000_000}`;

    const res = await call(a, 'POST', '/api/profile', { name, farmName: 'Bukit Sawah' });
    expect(res.statusCode).toBe(200);
    expect(res.json().player).toEqual({ name, farmName: 'Bukit Sawah' });

    const b = await player();
    const clash = await call(b, 'POST', '/api/profile', { name: name.toLowerCase() });
    expect(clash.statusCode).toBe(409);
  });

  maybe('rejects names that are empty, too long, or full of markup', async () => {
    const p = await player();
    for (const name of ['', 'a', 'x'.repeat(21), '<script>alert(1)</script>', '   ']) {
      const res = await call(p, 'POST', '/api/profile', { name });
      expect(res.statusCode).toBe(400);
    }
  });

  maybe('the leaderboard ranks you among named players only', async () => {
    const p = await player({ level: 19 });
    await call(p, 'POST', '/api/profile', { name: `Top${Date.now() % 1_000_000}` });

    const res = await call(p, 'GET', '/api/leaderboard');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.you.rank).toBeGreaterThanOrEqual(1);
    expect(body.top.every((r: { name: string | null }) => r.name)).toBe(true);
    // The rank is over the same population the list shows.
    expect(body.you.rank).toBeLessThanOrEqual(
      await prisma.farm.count({ where: { user: { name: { not: null } } } }),
    );
  });

  maybe('tutorial progress is remembered and never runs backwards', async () => {
    const p = await player();
    expect((await farmOf(p)).tutorial).toEqual({ step: 0, done: false });

    expect((await call(p, 'POST', '/api/tutorial', { step: 4 })).json().tutorial.step).toBe(4);
    // A stale client replaying an old step must not reopen the guide.
    expect((await call(p, 'POST', '/api/tutorial', { step: 1 })).json().tutorial.step).toBe(4);
    expect((await call(p, 'POST', '/api/tutorial', { done: true })).json().tutorial.done).toBe(true);
  });
});

/* ================= OPERATOR TOOLS ================= */

describe('admin withdrawals', () => {
  const ADMIN = 'integration-admin-token-0123456789';

  async function heldWithdrawal(): Promise<{ p: Player; transferId: string }> {
    const wallet = createWallet();
    const nonce = await app.inject({
      method: 'POST', url: '/api/auth/nonce', payload: { address: wallet.address },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: wallet.address, signature: wallet.sign(nonce.json().message) },
    });
    const raw = login.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
    const user = await prisma.user.findUniqueOrThrow({
      where: { wallet: wallet.address }, include: { farm: true },
    });

    // Held withdrawals are created by the withdraw route, which needs the
    // feature flag; this suite runs with it off, so write the row directly and
    // debit the farm the way that route would have.
    await prisma.farm.update({ where: { id: user.farm!.id }, data: { hay: '10' } });
    const transfer = await prisma.hayTransfer.create({
      data: {
        userId: user.id, direction: 'withdraw', amount: '30',
        wallet: wallet.address, status: 'review',
      },
    });
    return { p: { cookie, farmId: user.farm!.id, userId: user.id }, transferId: transfer.id };
  }

  maybe('the routes are closed without both the flag and the token', async () => {
    const { p } = await heldWithdrawal();

    const noToken = await call(p, 'GET', '/api/admin/withdrawals');
    expect(noToken.statusCode).toBe(403);

    await prisma.user.update({ where: { id: p.userId }, data: { isAdmin: true } });
    const wrongToken = await app.inject({
      method: 'GET', url: '/api/admin/withdrawals',
      headers: { cookie: p.cookie, 'x-admin-token': 'wrong' },
    });
    expect(wrongToken.statusCode).toBe(403);
  });

  maybe('a signed-in non-operator with the token is still refused', async () => {
    const { p } = await heldWithdrawal();
    const res = await app.inject({
      method: 'GET', url: '/api/admin/withdrawals',
      headers: { cookie: p.cookie, 'x-admin-token': ADMIN },
    });
    expect(res.statusCode).toBe(403);
  });

  maybe('an operator sees held withdrawals and can reject one, refunding the player', async () => {
    const { p, transferId } = await heldWithdrawal();
    await prisma.user.update({ where: { id: p.userId }, data: { isAdmin: true } });
    const headers = { cookie: p.cookie, 'x-admin-token': ADMIN };

    const list = await app.inject({ method: 'GET', url: '/api/admin/withdrawals', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().pending.some((r: { id: string }) => r.id === transferId)).toBe(true);

    const before = await farmOf(p);
    const rejected = await app.inject({
      method: 'POST', url: '/api/admin/withdrawals/reject', headers,
      payload: { transferId, reason: 'looks like a bot' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().refunded).toBe('30.00');

    const after = await farmOf(p);
    expect(Number(after.farm.hay) - Number(before.farm.hay)).toBeCloseTo(30, 2);
    expect(await prisma.hayTransfer.findUniqueOrThrow({ where: { id: transferId } }))
      .toMatchObject({ status: 'failed' });

    // And it cannot be rejected twice.
    const again = await app.inject({
      method: 'POST', url: '/api/admin/withdrawals/reject', headers,
      payload: { transferId, reason: 'again' },
    });
    expect(again.statusCode).toBe(409);
  });
});
