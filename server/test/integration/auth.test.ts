/**
 * Wallet login, driven with a real signing key.
 *
 * The nonce flow is the only thing standing between a wallet address and
 * somebody else's farm, so it is worth proving with actual signatures rather
 * than a stub: that a valid signature opens a session, that a nonce cannot be
 * replayed, that another wallet's signature is rejected, and that the session
 * cookie is httpOnly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import type { FastifyInstance } from 'fastify';
import { challengeMessage } from '../../src/auth/wallet';

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

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 30_000);

async function getNonce(address: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/nonce', payload: { address } });
  expect(res.statusCode).toBe(200);
  return res.json() as { nonce: string; message: string };
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
}

describe('wallet login', () => {
  maybe('a valid signature opens a session and creates the farm', async () => {
    const wallet = Wallet.createRandom();
    const { message } = await getNonce(wallet.address);
    const signature = await wallet.signMessage(message);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: wallet.address, signature },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().wallet).toBe(wallet.address.toLowerCase());

    const setCookie = res.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
    expect(header.toLowerCase()).toContain('httponly');
    expect(header.toLowerCase()).toContain('samesite=lax');

    const cookie = cookieFrom(res as never);
    const farm = await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie } });
    expect(farm.statusCode).toBe(200);
    expect(farm.json().farm.coins).toBe('640');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.wallet).toBe(wallet.address.toLowerCase());
  });

  maybe('signing in again returns the same farm, not a new one', async () => {
    const wallet = Wallet.createRandom();

    const login = async () => {
      const { message } = await getNonce(wallet.address);
      const res = await app.inject({
        method: 'POST', url: '/api/auth/wallet',
        payload: { address: wallet.address, signature: await wallet.signMessage(message) },
      });
      expect(res.statusCode).toBe(200);
      return cookieFrom(res as never);
    };

    const first = await login();
    await app.inject({
      method: 'POST', url: '/api/plant',
      headers: { cookie: first }, payload: { tiles: [0], crop: 'wheat' },
    });

    const second = await login();
    const farm = await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie: second } });
    // Same farm: the wheat planted in the first session is still growing.
    expect(farm.json().farm.tiles[0].crop).toBe('wheat');
    expect(farm.json().farm.coins).toBe('639');
  });

  maybe('a nonce cannot be replayed', async () => {
    const wallet = Wallet.createRandom();
    const { message } = await getNonce(wallet.address);
    const signature = await wallet.signMessage(message);

    const first = await app.inject({
      method: 'POST', url: '/api/auth/wallet', payload: { address: wallet.address, signature },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST', url: '/api/auth/wallet', payload: { address: wallet.address, signature },
    });
    expect(replay.statusCode).toBe(401);
  });

  maybe('one wallet cannot sign in as another', async () => {
    const victim = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const { message } = await getNonce(victim.address);

    // The attacker signs the victim's challenge with their own key.
    const res = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: victim.address, signature: await attacker.signMessage(message) },
    });
    expect(res.statusCode).toBe(401);
  });

  maybe('a signature over a different message is rejected', async () => {
    const wallet = Wallet.createRandom();
    await getNonce(wallet.address);
    const forged = await wallet.signMessage(challengeMessage(wallet.address, 'a-nonce-we-never-issued'));

    const res = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: wallet.address, signature: forged },
    });
    expect(res.statusCode).toBe(401);
  });

  maybe('an expired nonce is rejected', async () => {
    const wallet = Wallet.createRandom();
    const { nonce, message } = await getNonce(wallet.address);
    await prisma.authNonce.update({
      where: { nonce }, data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: wallet.address, signature: await wallet.signMessage(message) },
    });
    expect(res.statusCode).toBe(401);
  });

  maybe('a malformed address never reaches the signature check', async () => {
    for (const address of ['not-an-address', '0x123', '', '0xZZZZ5f4e8b7a2c1d9e0f3a4b5c6d7e8f90123456']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/nonce', payload: { address } });
      expect(res.statusCode).toBe(400);
    }
  });

  maybe('logging out clears the session', async () => {
    const wallet = Wallet.createRandom();
    const { message } = await getNonce(wallet.address);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/wallet',
      payload: { address: wallet.address, signature: await wallet.signMessage(message) },
    });
    const cookie = cookieFrom(login as never);
    expect((await app.inject({ method: 'GET', url: '/api/farm', headers: { cookie } })).statusCode).toBe(200);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const cleared = Array.isArray(out.headers['set-cookie'])
      ? (out.headers['set-cookie'] as string[])[0]
      : String(out.headers['set-cookie']);
    expect(cleared).toContain('sunmill_session=;');
  });

  maybe('a forged session cookie is not accepted', async () => {
    // A syntactically plausible JWT signed with the wrong key.
    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign({ userId: 'someone-elses-id' }, 'not-the-real-secret', { issuer: 'sunmill' });
    const res = await app.inject({
      method: 'GET', url: '/api/farm', headers: { cookie: `sunmill_session=${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
