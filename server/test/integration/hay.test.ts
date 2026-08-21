/**
 * $HAY withdraw and deposit with the feature flag ON (HANDOFF §7).
 *
 * The chain layer itself is stubbed — these tests are about the parts that are
 * ours and that move a balance: that a withdrawal debits before it broadcasts
 * and refunds if the broadcast fails, that the daily cap and the review
 * threshold are enforced, and above all that a deposit can never be credited
 * twice however many times the confirm endpoint is called.
 *
 * The environment is set here, before the app is built, because the feature
 * flag is read once at boot; it is restored afterwards so this file cannot
 * change how any other suite sees the flag. Nothing here touches a real chain.
 *
 * Expect Prisma unique-constraint errors in the output during the idempotency
 * tests — that collision IS the mechanism keeping a deposit from being
 * credited twice, and the route catches it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWallet } from './_wallet';
import type { FastifyInstance } from 'fastify';

const ENV_KEYS = [
  'HAY_ONCHAIN_ENABLED', 'CHAIN_RPC_URL', 'CHAIN_ID', 'HAY_TOKEN_ADDRESS',
  'TREASURY_ADDRESS', 'TREASURY_PRIVATE_KEY',
  'HAY_WITHDRAW_DAILY_CAP', 'HAY_WITHDRAW_REVIEW_THRESHOLD',
] as const;
const ENV_BEFORE = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.HAY_ONCHAIN_ENABLED = 'true';
process.env.CHAIN_RPC_URL = 'http://127.0.0.1:8545';
process.env.CHAIN_ID = '1337';
process.env.HAY_TOKEN_ADDRESS = 'HAYmint1111111111111111111111111111111111111';
process.env.TREASURY_ADDRESS = 'Treasury1111111111111111111111111111111111';
process.env.TREASURY_PRIVATE_KEY = 'TreasuryKey1111111111111111111111111111111111111111111111111111111111111111111111111111';
process.env.HAY_WITHDRAW_DAILY_CAP = '50';
process.env.HAY_WITHDRAW_REVIEW_THRESHOLD = '25';

// A distinct hash per broadcast, as a real chain would give: HayTransfer.txHash
// is unique, so a stub that repeated itself would collide across runs.
let broadcast = 0;
/**
 * A Solana signature is base58 and 86-88 characters, which is the shape the
 * deposit route now insists on — so the stub has to produce it too, and in the
 * base58 alphabet: base36 of a timestamp happily emits 0, l, o and i, none of
 * which exist in base58. That is what the first version of this did, and the
 * route was right to refuse it.
 */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (n: number, width = 87) => {
  let out = '';
  let v = Math.abs(Math.floor(n));
  do { out = B58[v % 58] + out; v = Math.floor(v / 58) } while (v > 0);
  return out.padStart(width, '1');   // '1' is base58 for zero
};
const nextTxHash = () => b58(Date.now() * 1000 + (broadcast += 1));

const sendHay = vi.fn(async () => nextTxHash());
const verifyDeposit = vi.fn(async () => ({ ok: true, amount: '5.00', confirmations: 12 }));

vi.mock('../../src/lib/chain', () => ({
  sendHay: (...args: unknown[]) => sendHay(...(args as [])),
  verifyDeposit: (...args: unknown[]) => verifyDeposit(...(args as [])),
  getProvider: () => { throw new Error('not used in tests') },
  tokenDecimals: async () => 18,
}));

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
  for (const key of ENV_KEYS) {
    if (ENV_BEFORE[key] === undefined) delete process.env[key];
    else process.env[key] = ENV_BEFORE[key];
  }
});

beforeEach(() => {
  sendHay.mockClear();
  verifyDeposit.mockClear();
  sendHay.mockImplementation(async () => nextTxHash());
  verifyDeposit.mockImplementation(async () => ({ ok: true, amount: '5.00', confirmations: 12 }));
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) { console.warn(`skipped (no database): ${name}`); return }
    await fn();
  }, 30_000);

interface Player { cookie: string; farmId: string; userId: string; address: string }

/** A wallet-authenticated player — withdrawals need a wallet on the account. */
async function walletPlayer(hay = '40'): Promise<Player> {
  const wallet = createWallet();
  const nonce = await app.inject({
    method: 'POST', url: '/api/auth/nonce', payload: { address: wallet.address },
  });
  const { message } = nonce.json();
  const login = await app.inject({
    method: 'POST', url: '/api/auth/wallet',
    payload: { address: wallet.address, signature: wallet.sign(message) },
  });
  expect(login.statusCode).toBe(200);
  const raw = login.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];

  const user = await prisma.user.findUniqueOrThrow({
    where: { wallet: wallet.address },
    include: { farm: true },
  });
  await prisma.farm.update({ where: { id: user.farm!.id }, data: { hay } });
  return { cookie, farmId: user.farm!.id, userId: user.id, address: wallet.address };
}

function call(p: Player, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie: p.cookie }, payload: payload as never });
}

async function hayOf(p: Player): Promise<string> {
  const res = await call(p, 'GET', '/api/farm');
  return res.json().farm.hay;
}

describe('status', () => {
  maybe('reports the flag, the wallet and the cap', async () => {
    const p = await walletPlayer();
    const res = await call(p, 'GET', '/api/hay/status');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.wallet).toBe(p.address);
    expect(body.dailyCap).toBe(50);
    expect(body.withdrawnToday).toBe('0.00');
  });

  maybe('the config advertises on-chain $HAY once it is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().features.hayOnChain).toBe(true);
  });
});

describe('withdraw', () => {
  maybe('debits the balance, broadcasts, and records the transfer', async () => {
    const p = await walletPlayer('40');
    const res = await call(p, 'POST', '/api/hay/withdraw', { amount: '10.00' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('sent');
    expect(res.json().txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);

    expect(sendHay).toHaveBeenCalledOnce();
    expect(sendHay.mock.calls[0]).toEqual([p.address, '10.00']);
    expect(await hayOf(p)).toBe('30.00');

    const transfer = await prisma.hayTransfer.findFirstOrThrow({ where: { userId: p.userId } });
    expect(transfer.direction).toBe('withdraw');
    expect(transfer.status).toBe('sent');
    expect(transfer.txHash).toBe(res.json().txHash);

    const row = await prisma.ledger.findFirstOrThrow({
      where: { userId: p.userId, kind: 'hay_withdraw' },
    });
    expect(row.hayDelta.toString()).toBe('-10');
    expect(row.status).toBe('pending');
  });

  maybe('a withdrawal at the review threshold is held, and never broadcast', async () => {
    const p = await walletPlayer('40');
    const res = await call(p, 'POST', '/api/hay/withdraw', { amount: '25.00' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('review');
    expect(sendHay).not.toHaveBeenCalled();

    // The hay is still debited — the operator releases the transfer, not the API.
    expect(await hayOf(p)).toBe('15.00');
    const transfer = await prisma.hayTransfer.findFirstOrThrow({ where: { userId: p.userId } });
    expect(transfer.status).toBe('review');
    expect(transfer.txHash).toBeNull();
  });

  maybe('a failed broadcast returns the $HAY and marks the attempt failed', async () => {
    const p = await walletPlayer('40');
    sendHay.mockImplementation(async () => { throw new Error('rpc unreachable') });

    const res = await call(p, 'POST', '/api/hay/withdraw', { amount: '10.00' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('failed');
    expect(await hayOf(p)).toBe('40.00');

    const transfer = await prisma.hayTransfer.findFirstOrThrow({ where: { userId: p.userId } });
    expect(transfer.status).toBe('failed');
    expect(transfer.error).toContain('rpc unreachable');

    // Both halves are on the ledger: the debit and the refund.
    const rows = await prisma.ledger.findMany({
      where: { userId: p.userId, kind: 'hay_withdraw' }, orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const net = rows.reduce((acc, r) => acc + Number(r.hayDelta), 0);
    expect(net).toBe(0);
  });

  maybe('more than the balance is refused', async () => {
    const p = await walletPlayer('5');
    const res = await call(p, 'POST', '/api/hay/withdraw', { amount: '10.00' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('insufficient_hay');
    expect(sendHay).not.toHaveBeenCalled();
    expect(await hayOf(p)).toBe('5.00');
  });

  maybe('the rolling daily cap counts held and sent withdrawals alike', async () => {
    const p = await walletPlayer('200');
    // 24 + 24 = 48, both under the 25 review threshold, both under the 50 cap.
    expect((await call(p, 'POST', '/api/hay/withdraw', { amount: '24.00' })).statusCode).toBe(200);
    expect((await call(p, 'POST', '/api/hay/withdraw', { amount: '24.00' })).statusCode).toBe(200);

    const over = await call(p, 'POST', '/api/hay/withdraw', { amount: '5.00' });
    expect(over.statusCode).toBe(400);
    expect(over.json().message).toContain('Daily withdrawal cap');

    const status = await call(p, 'GET', '/api/hay/status');
    expect(status.json().withdrawnToday).toBe('48.00');
    // The refusal cost nothing: 200 − 48 still on the farm.
    expect(await hayOf(p)).toBe('152.00');
  });

  maybe('yesterday\'s withdrawals do not count against today', async () => {
    const p = await walletPlayer('200');
    expect((await call(p, 'POST', '/api/hay/withdraw', { amount: '24.00' })).statusCode).toBe(200);
    await prisma.hayTransfer.updateMany({
      where: { userId: p.userId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const status = await call(p, 'GET', '/api/hay/status');
    expect(status.json().withdrawnToday).toBe('0.00');
    expect((await call(p, 'POST', '/api/hay/withdraw', { amount: '40.00' })).statusCode).toBe(200);
  });

  maybe('zero and malformed amounts are rejected at the boundary', async () => {
    const p = await walletPlayer('40');
    for (const amount of ['0', '0.00', '-5.00', 'abc', '1.234', '']) {
      const res = await call(p, 'POST', '/api/hay/withdraw', { amount });
      expect(res.statusCode).toBe(400);
    }
    expect(await hayOf(p)).toBe('40.00');
  });

  maybe('an account with no wallet cannot withdraw', async () => {
    const dev = await app.inject({
      method: 'POST', url: '/api/auth/dev', payload: { handle: `hay-nowallet-${Date.now()}` },
    });
    const raw = dev.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
    const res = await app.inject({
      method: 'POST', url: '/api/hay/withdraw', headers: { cookie }, payload: { amount: '1.00' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Connect a wallet');
  });
});

describe('deposit', () => {
  // Unique per run: txHash is unique for the lifetime of the database.
  const hash = (n: number) => b58(Date.now() * 1000 + n);

  maybe('credits the verified amount and records the transfer', async () => {
    const p = await walletPlayer('10');
    const txHash = hash(1001);
    const res = await call(p, 'POST', '/api/hay/deposit/confirm', { txHash });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
    expect(res.json().amount).toBe('5.00');
    expect(verifyDeposit.mock.calls[0]).toEqual([txHash, p.address]);
    expect(await hayOf(p)).toBe('15.00');

    const transfer = await prisma.hayTransfer.findUniqueOrThrow({ where: { txHash } });
    expect(transfer.direction).toBe('deposit');
    expect(transfer.status).toBe('confirmed');

    const row = await prisma.ledger.findFirstOrThrow({
      where: { userId: p.userId, kind: 'hay_deposit' },
    });
    expect(row.hayDelta.toString()).toBe('5');
  });

  maybe('the same transaction can never be credited twice', async () => {
    const p = await walletPlayer('10');
    const txHash = hash(2002);

    const first = await call(p, 'POST', '/api/hay/deposit/confirm', { txHash });
    expect(first.statusCode).toBe(200);
    expect(await hayOf(p)).toBe('15.00');

    // Hammer it: the unique txHash is what makes this safe, not a check-then-act.
    const again = await Promise.all(Array.from({ length: 5 }, () =>
      call(p, 'POST', '/api/hay/deposit/confirm', { txHash })));
    for (const r of again) {
      expect(r.statusCode).toBe(200);
      expect(r.json().alreadyCredited).toBe(true);
    }
    expect(await hayOf(p)).toBe('15.00');
    expect(await prisma.ledger.count({ where: { userId: p.userId, kind: 'hay_deposit' } })).toBe(1);
  });

  maybe('concurrent first-time confirms credit exactly once', async () => {
    const p = await walletPlayer('10');
    const txHash = hash(3003);

    const results = await Promise.all(Array.from({ length: 4 }, () =>
      call(p, 'POST', '/api/hay/deposit/confirm', { txHash })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await hayOf(p)).toBe('15.00');
    expect(await prisma.hayTransfer.count({ where: { txHash } })).toBe(1);
    expect(await prisma.ledger.count({ where: { userId: p.userId, kind: 'hay_deposit' } })).toBe(1);
  });

  maybe('another account cannot claim someone else\'s transaction', async () => {
    const owner = await walletPlayer('10');
    const thief = await walletPlayer('10');
    const txHash = hash(4004);

    expect((await call(owner, 'POST', '/api/hay/deposit/confirm', { txHash })).statusCode).toBe(200);
    const stolen = await call(thief, 'POST', '/api/hay/deposit/confirm', { txHash });
    expect(stolen.statusCode).toBe(409);
    expect(await hayOf(thief)).toBe('10.00');
  });

  maybe('a transaction the chain will not vouch for credits nothing', async () => {
    const p = await walletPlayer('10');
    verifyDeposit.mockImplementation(async () => ({ ok: false, reason: 'Not enough confirmations yet' }));

    const res = await call(p, 'POST', '/api/hay/deposit/confirm', { txHash: hash(5005) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('confirmations');
    expect(await hayOf(p)).toBe('10.00');
    expect(await prisma.hayTransfer.count({ where: { txHash: hash(5005) } })).toBe(0);
  });

  maybe('a malformed transaction hash is rejected at the boundary', async () => {
    const p = await walletPlayer('10');
    // Too short, wrong alphabet, empty, EVM-shaped, and base58 of the wrong
    // length — every one of these has to bounce before the chain is asked.
    for (const txHash of [
      'Sig123', 'not a signature!', '', '0x' + 'a'.repeat(64),
      '0OIl' + 'A'.repeat(83), 'A'.repeat(120),
    ]) {
      const res = await call(p, 'POST', '/api/hay/deposit/confirm', { txHash });
      expect(res.statusCode).toBe(400);
    }
    expect(verifyDeposit).not.toHaveBeenCalled();
  });
});
