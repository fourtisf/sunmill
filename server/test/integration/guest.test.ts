/**
 * Passcode-only play.
 *
 * With wallet login off, the farm key is the whole of a player's identity, so
 * these check the two things that would quietly ruin a beta: that a key really
 * brings back the same farm (otherwise every returning player gets an empty
 * field), and that a wrong or missing key never silently becomes a new one
 * (otherwise a typo looks like theft). The stored-hash test is here because a
 * dump of the users table must not be a pile of working logins.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Must be set before src/env.ts is first evaluated — this is the deployed
// shape: no wallet routes at all, guest login carrying the beta on its own.
process.env.WALLET_LOGIN = 'false';
process.env.GUEST_LOGIN = 'true';

let app: FastifyInstance;
let prisma: import('@prisma/client').PrismaClient;
let redis: import('ioredis').Redis;
let reachable = false;

/** The bucket app.inject() spends when it opens a farm. */
const NEW_FARM_BUCKET = 'sunmil:rl:auth-guest:ip:127.0.0.1';

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    ({ prisma } = await import('../../src/lib/db'));
    ({ redis } = await import('../../src/lib/redis'));
    await prisma.$queryRaw`SELECT 1`;
    const { buildApp } = await import('../../src/app');
    app = await buildApp();
    await app.ready();
    // Opening a farm is IP-limited, and a previous run (or a developer poking
    // at the API) shares this Redis. Start from a clean bucket, and leave one.
    await redis.del(NEW_FARM_BUCKET).catch(() => undefined);
    reachable = true;
  } catch {
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  if (redis) await redis.del(NEW_FARM_BUCKET).catch(() => undefined);
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (redis) redis.disconnect();
});

// Runtime, not it.skipIf: skipIf is evaluated at collection time, before
// beforeAll has had a chance to reach the database. Matches the other files.
const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 30_000);

function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : [raw];
  for (const line of all) {
    if (typeof line === 'string' && line.startsWith('sunmil_session=')) return line.split(';')[0];
  }
  return null;
}

/** Open a brand-new farm; returns its key and its session cookie. */
async function newFarm() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.created).toBe(true);
  expect(typeof body.key).toBe('string');
  return { key: body.key as string, cookie: sessionCookie(res)! };
}

describe('wallet login turned off', () => {
  maybe('does not serve the wallet routes at all', async () => {
    // Not a hidden button: the endpoints are absent, so a client that still
    // posts a signature cannot open a session either.
    for (const url of ['/api/auth/nonce', '/api/auth/wallet']) {
      const res = await app.inject({ method: 'POST', url, payload: { address: 'x', signature: 'y' } });
      expect(res.statusCode).toBe(404);
    }
  });

  maybe('tells the client which logins exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().features).toMatchObject({ walletLogin: false, guestLogin: true });
  });
});

describe('farm key', () => {
  maybe('opens a farm and hands back a key exactly once', async () => {
    const { key, cookie } = await newFarm();
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(cookie.startsWith('sunmil_session=')).toBe(true);

    // The session works immediately — there is no second step.
    const farm = await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie } });
    expect(farm.statusCode).toBe(200);
  });

  maybe('keeps the session cookie out of reach of scripts', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    const raw = res.headers['set-cookie'];
    const line = (Array.isArray(raw) ? raw : [raw])
      .find((l) => typeof l === 'string' && l.startsWith('sunmil_session=')) as string;
    expect(line).toBeTruthy();
    expect(line).toMatch(/HttpOnly/i);
  });

  maybe('brings back the same farm, and says nothing new about the key', async () => {
    const first = await newFarm();
    const before = (await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie: first.cookie } })).json();

    const again = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: { key: first.key } });
    expect(again.statusCode).toBe(200);
    const body = again.json();
    expect(body.created).toBe(false);
    // Said once. Repeating it here would put the key in every proxy log.
    expect(body.key).toBeUndefined();

    const after = (await app.inject({
      method: 'GET', url: '/api/farm', headers: { cookie: sessionCookie(again)! },
    })).json();
    expect(after.farm.id).toBe(before.farm.id);
  });

  maybe('stores only a hash, never the key', async () => {
    const { key } = await newFarm();
    const plain = await prisma.user.findFirst({ where: { guestKey: key } });
    expect(plain).toBeNull();
    const hashed = await prisma.user.findUnique({
      where: { guestKey: crypto.createHash('sha256').update(key, 'utf8').digest('hex') },
    });
    expect(hashed).not.toBeNull();
  });

  maybe('refuses a key that matches nothing instead of opening a new farm', async () => {
    const before = await prisma.user.count();
    // Well-formed, and almost certainly nobody's.
    const res = await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { key: crypto.randomBytes(24).toString('base64url') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('guest_unknown');
    expect(sessionCookie(res)).toBeNull();
    expect(await prisma.user.count()).toBe(before);
  });

  maybe('refuses a malformed key the same way', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: { key: 'not a key' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('guest_unknown');
  });

  maybe('rejects unknown fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { key: undefined, userId: 'someone-else' },
    });
    expect(res.statusCode).toBe(400);
  });

  maybe('limits opening farms without punishing a player coming back', async () => {
    // The two directions are not the same risk. Opening farms writes rows for
    // an anonymous caller and is keyed by IP; coming back with a key you can
    // already prove you own is keyed by the key. Without that split, one
    // Discord server behind a single NAT locks itself out.
    const ip = '198.51.100.42';
    const bucket = `sunmil:rl:auth-guest:ip:${ip}`;
    const from = { 'x-forwarded-for': ip };
    await redis.del(bucket).catch(() => undefined);

    const first = await app.inject({ method: 'POST', url: '/api/auth/guest', headers: from, payload: {} });
    expect(first.statusCode).toBe(200);
    const key = first.json().key as string;

    let limited = false;
    for (let i = 0; i < 24; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/guest', headers: from, payload: {} });
      if (res.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true);

    const back = await app.inject({
      method: 'POST', url: '/api/auth/guest', headers: from, payload: { key },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().created).toBe(false);

    // Local dev shares this Redis; a spent bucket left behind is a developer
    // locked out of their own login for five minutes.
    await redis.del(bucket).catch(() => undefined);
  });

  maybe('gives each farm its own key', async () => {
    const a = await newFarm();
    const b = await newFarm();
    expect(a.key).not.toBe(b.key);

    const aFarm = (await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie: a.cookie } })).json();
    const bFarm = (await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie: b.cookie } })).json();
    expect(aFarm.farm.id).not.toBe(bFarm.farm.id);
  });
});
