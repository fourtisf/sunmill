/**
 * The path from "a player did something" to "we owe them a notification".
 *
 * The point of Farm.notifyAt is that the notifier never has to resolve a farm
 * to know whether it is due — the action that already resolved it wrote the
 * answer down. So these check the two halves that have to agree: that every
 * action records the soonest timer, and that the sweep finds exactly the farms
 * it should and leaves everyone else alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbTest } from './harness';
import type { FastifyInstance } from 'fastify';
import webpush from 'web-push';

// Push has to look configured or the sweep short-circuits, and web-push checks
// the key really is a P-256 point — so generate a throwaway pair rather than
// keeping one in the repo. Nothing is ever delivered: the endpoints below are
// not a push service, and what is under test is who the sweep picks, not the
// sending.
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@sunmil.fun';

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let sweepNotifications: typeof import('../../src/engine/notifier')['sweepNotifications'];
let NOTIFY_QUIET_SEC: number;
let reachable = false;
let seq = 0;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    ({ prisma } = await import('../../src/lib/db'));
    ({ redis } = await import('../../src/lib/redis'));
    await prisma.$queryRaw`SELECT 1`;
    ({ sweepNotifications } = await import('../../src/engine/notifier'));
    ({ NOTIFY_QUIET_SEC } = await import('../../src/engine/notify'));
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

const maybe = dbTest(() => reachable);

interface Player { cookie: string; farmId: string; userId: string }

async function player(): Promise<Player> {
  seq += 1;
  const handle = `notify-${Date.now()}-${seq}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { handle } });
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
  const farm = await prisma.farm.findFirstOrThrow({
    where: { user: { email: `${handle.toLowerCase()}@dev.local` } },
  });
  return { cookie, farmId: farm.id, userId: farm.userId };
}

const call = (p: Player, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: p.cookie } });

/** Make the farm look like nobody has been there for a while. */
async function wentAway(p: Player) {
  await prisma.farm.update({
    where: { id: p.farmId },
    data: { lastSeenAt: new Date(Date.now() - (NOTIFY_QUIET_SEC + 60) * 1000) },
  });
}

async function subscribe(p: Player) {
  await prisma.pushSubscription.create({
    data: {
      userId: p.userId,
      endpoint: `https://push.invalid/${p.farmId}`,
      p256dh: 'x'.repeat(80), auth: 'y'.repeat(20),
    },
  });
}

describe('recording when a farm comes due', () => {
  maybe('planting writes the soonest timer onto the farm', async () => {
    const p = await player();
    const before = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(before.notifyAt).toBeNull();

    const res = await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    expect(res.statusCode).toBe(200);

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(after.notifyAt).not.toBeNull();
    const tile = res.json().farm.tiles.find((t: { index: number }) => t.index === 0);
    expect(after.notifyAt!.toISOString()).toBe(tile.readyAt);
  });

  maybe('clears it again when nothing is running', async () => {
    const p = await player();
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    expect((await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } })).notifyAt).not.toBeNull();

    // Far enough forward that the crop is up, then take it.
    await prisma.tile.updateMany({
      where: { farmId: p.farmId, index: 0 },
      data: { plantedAt: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    const harvested = await call(p, 'POST', '/api/harvest', { tile: 0 });
    expect(harvested.statusCode).toBe(200);

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(after.notifyAt).toBeNull();
  });
});

describe('the sweep', () => {
  maybe('picks up a farm whose timer is up and the player is gone', async () => {
    const p = await player();
    await subscribe(p);
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    // The crop finished a minute ago and nobody was watching.
    await prisma.tile.updateMany({
      where: { farmId: p.farmId, index: 0 },
      data: { plantedAt: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    await prisma.farm.update({
      where: { id: p.farmId },
      data: { notifyAt: new Date(Date.now() - 60_000) },
    });
    await wentAway(p);

    await sweepNotifications();

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(after.notifiedAt).not.toBeNull();
  });

  maybe('leaves a player who is still there alone', async () => {
    const p = await player();
    await subscribe(p);
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    await prisma.farm.update({
      where: { id: p.farmId },
      data: { notifyAt: new Date(Date.now() - 60_000), lastSeenAt: new Date() },
    });

    await sweepNotifications();

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(after.notifiedAt).toBeNull();
  });

  maybe('does not send twice for the same timer', async () => {
    const p = await player();
    await subscribe(p);
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    const due = new Date(Date.now() - 60_000);
    await prisma.farm.update({ where: { id: p.farmId }, data: { notifyAt: due } });
    await wentAway(p);

    await sweepNotifications();
    const first = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(first.notifiedAt).not.toBeNull();

    await wentAway(p);
    await sweepNotifications();
    const second = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(second.notifiedAt!.toISOString()).toBe(first.notifiedAt!.toISOString());
  });

  maybe('ignores a farm nobody subscribed from', async () => {
    const p = await player();   // no subscribe()
    await call(p, 'POST', '/api/plant', { tiles: [0], crop: 'wheat' });
    await prisma.farm.update({
      where: { id: p.farmId }, data: { notifyAt: new Date(Date.now() - 60_000) },
    });
    await wentAway(p);

    await sweepNotifications();

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: p.farmId } });
    expect(after.notifiedAt).toBeNull();
  });
});
