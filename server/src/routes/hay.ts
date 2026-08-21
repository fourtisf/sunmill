/**
 * $HAY withdraw/deposit (HANDOFF §7).
 *
 * Both endpoints stay behind HAY_ONCHAIN_ENABLED and refuse to run without a
 * fully configured treasury. Off-chain `hay` — what orders and level-ups grant
 * and what expansions cost — works regardless and needs none of this.
 *
 * Do not turn the flag on until ALFA has signed off on emission and sinks.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, onChainReady } from '../env';
import { requireAuth } from '../auth/plugin';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { sendHay, verifyDeposit } from '../lib/chain';
import { writeLedger } from '../lib/ledger';
import { decimal, hayToUnits, unitsToHay } from '../lib/money';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { addHay, ledger, runAction, saveFarm } from './_context';

const withdrawBody = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'amount must be a positive number with up to 2 decimals'),
}).strict();

const depositBody = z.object({
  // A Solana transaction signature: 64 bytes, base58, so 86-88 characters and
  // no 0, O, I or l. This was an EVM 0x-hash until the chain module moved to
  // Solana — which would have rejected every real deposit at the boundary,
  // before it ever reached the code that verifies it.
  txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/, 'not a transaction signature'),
}).strict();

function requireFlag(): void {
  if (!env.HAY_ONCHAIN_ENABLED) throw errors.disabled('On-chain $HAY');
  if (!onChainReady()) throw errors.disabled('On-chain $HAY (treasury not configured)');
}

/** Game hay already withdrawn in the last 24h, in hundredths. */
async function withdrawnToday(userId: string): Promise<bigint> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.hayTransfer.findMany({
    where: {
      userId, direction: 'withdraw', createdAt: { gte: since },
      status: { in: ['pending', 'review', 'sent', 'confirmed'] },
    },
    select: { amount: true },
  });
  return rows.reduce((acc, r) => acc + hayToUnits(r.amount), 0n);
}

export default async function hayRoutes(app: FastifyInstance) {
  /** GET /api/hay/status — what the client should show for the token UI. */
  app.get('/api/hay/status', async (req) => {
    const { userId } = await requireAuth(req);
    const enabled = env.HAY_ONCHAIN_ENABLED && onChainReady();
    const [user, spent] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } }),
      enabled ? withdrawnToday(userId) : Promise.resolve(0n),
    ]);
    return {
      enabled,
      wallet: user?.wallet ?? null,
      dailyCap: env.HAY_WITHDRAW_DAILY_CAP,
      withdrawnToday: unitsToHay(spent),
      reviewThreshold: env.HAY_WITHDRAW_REVIEW_THRESHOLD,
    };
  });

  /**
   * POST /api/hay/withdraw — game hay → on-chain $HAY.
   * Debits and records first, then broadcasts; a broadcast failure refunds.
   */
  app.post('/api/hay/withdraw', { preHandler: rateLimit('hay-withdraw', LIMITS.hay) }, async (req) => {
    requireFlag();
    const { amount } = withdrawBody.parse(req.body);
    const { userId } = await requireAuth(req);

    const units = hayToUnits(amount);
    if (units <= 0n) throw errors.badRequest('Amount must be greater than zero');

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } });
    if (!user?.wallet) throw errors.badRequest('Connect a wallet before withdrawing');

    const spent = await withdrawnToday(userId);
    if (spent + units > hayToUnits(String(env.HAY_WITHDRAW_DAILY_CAP))) {
      throw errors.badRequest('Daily withdrawal cap reached');
    }

    const needsReview = units >= hayToUnits(String(env.HAY_WITHDRAW_REVIEW_THRESHOLD));

    // Debit + audit atomically. The transfer row is the thing the chain job
    // (or an operator, for a held withdrawal) acts on afterwards.
    const { transferId, snapshot } = await (async () => {
      let transferId = '';
      const snap = await runAction(userId, async (ctx) => {
        if (hayToUnits(ctx.state.farm.hay) < units) throw errors.notEnoughHay();
        addHay(ctx, `-${amount}`);
        await saveFarm(ctx);

        const row = await ctx.tx.hayTransfer.create({
          data: {
            userId,
            direction: 'withdraw',
            amount: decimal(amount),
            wallet: user.wallet as string,
            status: needsReview ? 'review' : 'pending',
          },
        });
        transferId = row.id;

        await writeLedger(ctx.tx, {
          userId,
          kind: 'hay_withdraw',
          detail: { transferId: row.id, wallet: user.wallet, amount, review: needsReview },
          hayDelta: `-${amount}`,
          status: 'pending',
        });
        return {
          notice: {
            code: needsReview ? 'hay_withdraw_review' : 'hay_withdraw_sent',
            message: needsReview
              ? 'Withdrawal received — held for review'
              : 'Withdrawal submitted',
            params: { amount },
            icon: 'hay',
          },
        };
      });
      return { transferId, snapshot: snap };
    })();

    if (needsReview) {
      return { status: 'review', transferId, snapshot };
    }

    try {
      const txHash = await sendHay(user.wallet, amount);
      await prisma.hayTransfer.update({
        where: { id: transferId },
        data: { status: 'sent', txHash },
      });
      return { status: 'sent', transferId, txHash, snapshot };
    } catch (err) {
      // Broadcast failed — give the hay back and mark the attempt failed.
      const message = err instanceof Error ? err.message : 'chain error';
      const refunded = await runAction(userId, async (ctx) => {
        addHay(ctx, amount);
        await saveFarm(ctx);
        await ctx.tx.hayTransfer.update({
          where: { id: transferId },
          data: { status: 'failed', error: message.slice(0, 500) },
        });
        await ledger(ctx, 'hay_withdraw', {
          transferId, refunded: true, reason: message.slice(0, 500),
        }, { hay: amount });
        return {
          notice: {
            code: 'hay_withdraw_failed',
            message: 'Withdrawal failed — $HAY returned',
            icon: 'hay',
            bad: true,
          },
        };
      });
      return { status: 'failed', transferId, error: 'Withdrawal failed, your $HAY was returned', snapshot: refunded };
    }
  });

  /**
   * POST /api/hay/deposit/confirm — on-chain $HAY → game hay.
   * txHash is unique in the database, so the same deposit can never be
   * credited twice however many times this is called.
   */
  app.post('/api/hay/deposit/confirm', { preHandler: rateLimit('hay-deposit', LIMITS.hay) }, async (req) => {
    requireFlag();
    const { txHash } = depositBody.parse(req.body);
    const { userId } = await requireAuth(req);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } });
    if (!user?.wallet) throw errors.badRequest('Connect a wallet before depositing');

    const existing = await prisma.hayTransfer.findUnique({ where: { txHash } });
    if (existing) {
      if (existing.userId !== userId) throw errors.conflict('That transaction is already claimed');
      return { status: existing.status, alreadyCredited: existing.status === 'confirmed' };
    }

    const check = await verifyDeposit(txHash, user.wallet);
    if (!check.ok || !check.amount) throw errors.badRequest(check.reason ?? 'Could not verify that deposit');

    const amount = check.amount;
    try {
      const snapshot = await runAction(userId, async (ctx) => {
        // Claim the hash inside the transaction: the unique index is what
        // actually makes this idempotent under concurrent calls.
        await ctx.tx.hayTransfer.create({
          data: {
            userId,
            direction: 'deposit',
            amount: decimal(amount),
            wallet: user.wallet as string,
            txHash,
            status: 'confirmed',
          },
        });
        addHay(ctx, amount);
        await saveFarm(ctx);
        await ledger(ctx, 'hay_deposit', {
          txHash, wallet: user.wallet, amount, confirmations: check.confirmations,
        }, { hay: amount });
        return {
          notice: { code: 'hay_deposited', message: `Deposited ${amount} $HAY`, params: { amount }, icon: 'hay' },
        };
      });
      return { status: 'confirmed', amount, snapshot };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') return { status: 'confirmed', alreadyCredited: true };
      throw err;
    }
  });
}
