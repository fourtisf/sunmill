/**
 * The closed-beta gate.
 *
 * The point of these is that the gate is server-side: not that an overlay
 * appears, but that no route which can mint a session will do so without the
 * cookie. If any of these ever pass by accident, the gate is decoration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Must be set before src/env.ts is first evaluated. dotenv does not override
// a variable that is already present, so this wins over the local .env too.
process.env.INVITE_CODE = 'test-gate-4821';

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

// Runtime, not it.skipIf: skipIf is evaluated at collection time, before
// beforeAll has had a chance to reach the database. Matches the other files.
const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 30_000);

/** Pull the invite cookie out of a set-cookie header. */
function inviteCookie(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : [raw];
  for (const line of all) {
    if (typeof line === 'string' && line.startsWith('sunmil_invite=')) return line.split(';')[0];
  }
  return null;
}

describe('closed-beta gate', () => {
  maybe('announces that a code is needed without leaking it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invite' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ required: true, ok: false });
    expect(JSON.stringify(body)).not.toContain('test-gate-4821');
  });

  maybe('refuses a dev login with no invite cookie', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/dev', payload: { handle: `gate-${Date.now()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_required');
  });

  maybe('refuses to open a farm with no invite cookie', async () => {
    // The passcode-only path is the one most players take, so the gate has to
    // hold here above all: no cookie, no farm.
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_required');
  });

  maybe('opens a farm once the cookie is held', async () => {
    // Opening a farm is IP-limited and this Redis is shared with local dev and
    // with the guest suite, so this test starts from a bucket it owns.
    await redis.del('sunmil:rl:auth-guest:ip:127.0.0.1').catch(() => undefined);
    const gate = await app.inject({
      method: 'POST', url: '/api/invite', payload: { code: 'test-gate-4821' },
    });
    const cookie = inviteCookie(gate) as string;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/guest', headers: { cookie }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(true);
  });

  maybe('refuses to mint a wallet nonce with no invite cookie', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/nonce',
      payload: { address: '0x1111111111111111111111111111111111111111' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_required');
  });

  maybe('rejects the wrong code and sets no cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invite', payload: { code: '0000' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_invalid');
    expect(inviteCookie(res)).toBeNull();
  });

  maybe('accepts the right code and hands back an httpOnly cookie', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/invite', payload: { code: 'test-gate-4821' },
    });
    expect(res.statusCode).toBe(200);
    const raw = res.headers['set-cookie'];
    const line = (Array.isArray(raw) ? raw : [raw]).find(
      (l) => typeof l === 'string' && l.startsWith('sunmil_invite='),
    ) as string;
    expect(line).toBeTruthy();
    expect(line).toContain('HttpOnly');
  });

  maybe('lets a dev login through once the cookie is held', async () => {
    const gate = await app.inject({
      method: 'POST', url: '/api/invite', payload: { code: 'test-gate-4821' },
    });
    const cookie = inviteCookie(gate);
    expect(cookie).toBeTruthy();

    const res = await app.inject({
      method: 'POST', url: '/api/auth/dev',
      headers: { cookie: cookie as string },
      payload: { handle: `gate-ok-${Date.now()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  maybe('will not take a forged invite cookie', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/dev',
      headers: { cookie: 'sunmil_invite=not-a-real-token' },
      payload: { handle: `gate-forged-${Date.now()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_required');
  });

  maybe('rejects unknown fields on the invite body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/invite', payload: { code: 'test-gate-4821', admin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  maybe('does not let a caller pick their own rate-limit bucket', async () => {
    // The regression this guards: with Fastify's trustProxy set to `true`, the
    // left-most X-Forwarded-For entry wins — and that is written by the client.
    // nginx appends rather than replaces, so a caller who sends their own
    // header chooses what req.ip reports and gets a fresh bucket per guess.
    // Trusting only the local hop makes the address nginx observed the one
    // that counts, so rotating the prefix buys nothing.
    await redis.del('sunmil:rl:invite:ip:198.51.100.7').catch(() => undefined);
    let sawLimit = false;
    for (let i = 0; i < 20; i += 1) {
      const res = await app.inject({
        method: 'POST', url: '/api/invite',
        headers: { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7` },
        payload: { code: `bad-${i}` },
      });
      if (res.statusCode === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
    await redis.del('sunmil:rl:invite:ip:198.51.100.7').catch(() => undefined);
  });

  maybe('rate-limits guessing, so a short code cannot just be enumerated', async () => {
    // A fresh bucket for this test alone; the route keys on the caller's IP.
    await redis.del('sunmil:rl:invite:ip:127.0.0.1').catch(() => undefined);
    let sawLimit = false;
    for (let i = 0; i < 24; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/invite', payload: { code: `bad-${i}` } });
      if (res.statusCode === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
    // Local dev shares this Redis, so leaving the bucket spent would lock the
    // developer out of their own gate for ten minutes.
    await redis.del('sunmil:rl:invite:ip:127.0.0.1').catch(() => undefined);
  });
});
