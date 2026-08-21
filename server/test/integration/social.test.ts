/**
 * Goods moving between two farms.
 *
 * This is the only path in the game where one player's store feeds another's,
 * so it is the only one where a mistake creates or destroys items rather than
 * just misreporting them. The mailbox exists for the same reason: the sender
 * cannot see how full the recipient's store is, so nothing lands until the
 * recipient claims it, and the items belong to neither farm in between.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbTest } from './harness';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let reachable = false;
let seq = 0;

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
  } catch { reachable = false }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (redis) redis.disconnect();
});

const maybe = dbTest(() => reachable);

interface Player { cookie: string; userId: string; farmId: string }

async function player(stock: Record<string, number> = {}, name?: string): Promise<Player> {
  seq += 1;
  const handle = `social-${Date.now()}-${seq}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { handle } });
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
  const farm = await prisma.farm.findFirstOrThrow({
    where: { user: { email: `${handle.toLowerCase()}@dev.local` } },
  });
  await prisma.farm.update({
    where: { id: farm.id }, data: { level: 10, siloCap: 400, barnCap: 400 },
  });
  if (name) await prisma.user.update({ where: { id: farm.userId }, data: { name } });
  for (const [item, qty] of Object.entries(stock)) {
    await prisma.inventoryItem.upsert({
      where: { farmId_item: { farmId: farm.id, item } },
      update: { qty }, create: { farmId: farm.id, item, qty },
    });
  }
  return { cookie, userId: farm.userId, farmId: farm.id };
}

const call = (p: Player, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: p.cookie } });

const stockOf = async (p: Player, item: string) =>
  (await prisma.inventoryItem.findUnique({
    where: { farmId_item: { farmId: p.farmId, item } },
  }))?.qty ?? 0;

describe('visiting', () => {
  maybe('shows the farm and nothing that is not a visitor\'s business', async () => {
    const host = await player({ wheat: 12 }, 'Host');
    const guest = await player();
    await call(host, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });

    const res = await call(guest, 'GET', `/api/visit/${host.userId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host.name).toBe('Host');
    expect(body.farm.level).toBe(10);
    expect(body.farm.tiles.find((t: { index: number }) => t.index === 0).crop).toBe('wheat');

    // Balances, stores and orders are nobody else's business.
    const flat = JSON.stringify(body);
    expect(body.farm).not.toHaveProperty('coins');
    expect(body.farm).not.toHaveProperty('hay');
    expect(body.farm).not.toHaveProperty('inventory');
    expect(flat).not.toContain('"orders"');
    expect(flat).not.toContain('"tasks"');
  });

  maybe('does not settle the host\'s timers behind their back', async () => {
    const host = await player({ wheat: 12 });
    const guest = await player();
    await call(host, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    await prisma.tile.updateMany({
      where: { farmId: host.farmId, index: 0 },
      data: { plantedAt: new Date(Date.now() - 24 * 3600 * 1000) },
    });

    await call(guest, 'GET', `/api/visit/${host.userId}`);

    // The crop is ripe, but the row still says it is planted: only the host's
    // own read may persist that.
    const tile = await prisma.tile.findFirstOrThrow({
      where: { farmId: host.farmId, index: 0 },
    });
    expect(tile.crop).toBe('wheat');
  });

  maybe('404s on a farm that is not there', async () => {
    const guest = await player();
    expect((await call(guest, 'GET', '/api/visit/nobody')).statusCode).toBe(404);
  });

  maybe('is not open to the public', async () => {
    const host = await player();
    const res = await app.inject({ method: 'GET', url: `/api/visit/${host.userId}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('gifting', () => {
  maybe('moves goods out of one farm and into the other, once claimed', async () => {
    const giver = await player({ egg: 10 });
    const taker = await player();

    const sent = await call(giver, 'POST', '/api/gift',
      { toUserId: taker.userId, item: 'egg', qty: 4, note: 'here you go' });
    expect(sent.statusCode).toBe(200);

    // Gone from the sender immediately, and in nobody's store yet.
    expect(await stockOf(giver, 'egg')).toBe(6);
    expect(await stockOf(taker, 'egg')).toBe(0);

    const box = await call(taker, 'GET', '/api/gifts');
    const gifts = box.json().gifts;
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ item: 'egg', qty: 4, note: 'here you go' });

    const claimed = await call(taker, 'POST', '/api/gifts/claim', { giftId: gifts[0].id });
    expect(claimed.statusCode).toBe(200);
    expect(await stockOf(taker, 'egg')).toBe(4);
    // Nothing appeared anywhere else.
    expect(await stockOf(giver, 'egg')).toBe(6);
  });

  maybe('cannot send what you do not have', async () => {
    const giver = await player({ egg: 2 });
    const taker = await player();
    const res = await call(giver, 'POST', '/api/gift', { toUserId: taker.userId, item: 'egg', qty: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_items');
    expect(await stockOf(giver, 'egg')).toBe(2);
  });

  maybe('cannot be claimed twice', async () => {
    const giver = await player({ egg: 10 });
    const taker = await player();
    await call(giver, 'POST', '/api/gift', { toUserId: taker.userId, item: 'egg', qty: 3 });
    const id = (await call(taker, 'GET', '/api/gifts')).json().gifts[0].id;

    const [a, b] = await Promise.all([
      call(taker, 'POST', '/api/gifts/claim', { giftId: id }),
      call(taker, 'POST', '/api/gifts/claim', { giftId: id }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 404]);
    expect(await stockOf(taker, 'egg')).toBe(3);
  });

  maybe('cannot be claimed by somebody else', async () => {
    const giver = await player({ egg: 10 });
    const taker = await player();
    const thief = await player();
    await call(giver, 'POST', '/api/gift', { toUserId: taker.userId, item: 'egg', qty: 3 });
    const id = (await call(taker, 'GET', '/api/gifts')).json().gifts[0].id;

    expect((await call(thief, 'POST', '/api/gifts/claim', { giftId: id })).statusCode).toBe(404);
    expect(await stockOf(thief, 'egg')).toBe(0);
    // And it is still waiting for the person it was sent to.
    expect((await call(taker, 'GET', '/api/gifts')).json().gifts).toHaveLength(1);
  });

  maybe('stays in the mailbox when there is no room for it', async () => {
    const giver = await player({ egg: 10 });
    const taker = await player();
    await prisma.farm.update({ where: { id: taker.farmId }, data: { barnCap: 2 } });
    await call(giver, 'POST', '/api/gift', { toUserId: taker.userId, item: 'egg', qty: 5 });
    const id = (await call(taker, 'GET', '/api/gifts')).json().gifts[0].id;

    const res = await call(taker, 'POST', '/api/gifts/claim', { giftId: id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_space');
    // Not partly taken, not lost — still there to claim after an upgrade.
    expect(await stockOf(taker, 'egg')).toBe(0);
    expect((await call(taker, 'GET', '/api/gifts')).json().gifts).toHaveLength(1);
  });

  maybe('refuses to send to yourself, or to nobody, or an item that is not real', async () => {
    const giver = await player({ egg: 10 });
    expect((await call(giver, 'POST', '/api/gift',
      { toUserId: giver.userId, item: 'egg', qty: 1 })).statusCode).toBe(400);
    expect((await call(giver, 'POST', '/api/gift',
      { toUserId: 'nobody', item: 'egg', qty: 1 })).statusCode).toBe(404);
    expect((await call(giver, 'POST', '/api/gift',
      { toUserId: giver.userId, item: 'unobtanium', qty: 1 })).statusCode).toBe(400);
    expect(await stockOf(giver, 'egg')).toBe(10);
  });

  maybe('writes both sides to the ledger', async () => {
    const giver = await player({ egg: 10 });
    const taker = await player();
    await call(giver, 'POST', '/api/gift', { toUserId: taker.userId, item: 'egg', qty: 2 });
    const id = (await call(taker, 'GET', '/api/gifts')).json().gifts[0].id;
    await call(taker, 'POST', '/api/gifts/claim', { giftId: id });

    expect(await prisma.ledger.count({
      where: { userId: giver.userId, kind: 'gift_send' },
    })).toBe(1);
    expect(await prisma.ledger.count({
      where: { userId: taker.userId, kind: 'gift_claim' },
    })).toBe(1);
  });
});
