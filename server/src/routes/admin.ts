/**
 * Operator routes for withdrawals held at the review threshold.
 *
 * The withdraw endpoint deliberately does not broadcast those — it debits the
 * game hay and records the transfer, then stops. Until now there was nothing
 * to act on them with, so they simply hung there. This is that tool.
 *
 * Access needs BOTH a user flagged isAdmin AND the ADMIN_TOKEN header, so a
 * stolen session alone cannot move treasury funds.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { requireAuth } from '../auth/plugin';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { sendHay } from '../lib/chain';
import { writeLedger } from '../lib/ledger';
import { decimal, hayToUnits, unitsToHay } from '../lib/money';
import { LIMITS, rateLimit } from '../lib/ratelimit';

const releaseBody = z.object({ transferId: z.string().min(1).max(64) }).strict();
const rejectBody = z.object({
  transferId: z.string().min(1).max(64),
  reason: z.string().trim().min(1).max(200),
}).strict();

async function requireAdmin(req: FastifyRequest): Promise<string> {
  const { userId } = await requireAuth(req);
  if (!env.ADMIN_TOKEN) throw errors.notFound('Route');

  const header = req.headers['x-admin-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || token !== env.ADMIN_TOKEN) throw errors.forbidden('Admin token required');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) throw errors.forbidden('Not an operator');
  return userId;
}

export default async function adminRoutes(app: FastifyInstance) {
  /** GET /api/admin/withdrawals — everything waiting on a human. */
  app.get('/api/admin/withdrawals', { preHandler: rateLimit('admin', LIMITS.read) }, async (req) => {
    await requireAdmin(req);
    const rows = await prisma.hayTransfer.findMany({
      where: { direction: 'withdraw', status: 'review' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, amount: true, wallet: true, createdAt: true,
        user: { select: { id: true, name: true, wallet: true } },
      },
    });

    return {
      pending: rows.map((r) => ({
        id: r.id,
        amount: unitsToHay(hayToUnits(r.amount)),
        wallet: r.wallet,
        player: r.user.name,
        userId: r.user.id,
        requestedAt: r.createdAt.toISOString(),
      })),
    };
  });

  /**
   * POST /api/admin/withdrawals/release — broadcast a held withdrawal.
   * The player's hay was already debited when they asked, so this only moves
   * the on-chain half; a failed broadcast leaves the row in review to retry.
   */
  app.post('/api/admin/withdrawals/release', { preHandler: rateLimit('admin-write') }, async (req) => {
    await requireAdmin(req);
    const { transferId } = releaseBody.parse(req.body);

    const transfer = await prisma.hayTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw errors.notFound('Transfer');
    if (transfer.status !== 'review') throw errors.conflict(`That transfer is already ${transfer.status}`);

    // Claim it first so two operators cannot both broadcast.
    const claimed = await prisma.hayTransfer.updateMany({
      where: { id: transferId, status: 'review' },
      data: { status: 'pending' },
    });
    if (claimed.count !== 1) throw errors.conflict('Someone else is handling that one');

    try {
      const txHash = await sendHay(transfer.wallet, unitsToHay(hayToUnits(transfer.amount)));
      await prisma.hayTransfer.update({
        where: { id: transferId }, data: { status: 'sent', txHash },
      });
      return { status: 'sent', transferId, txHash };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'chain error';
      await prisma.hayTransfer.update({
        where: { id: transferId },
        data: { status: 'review', error: message.slice(0, 500) },
      });
      throw errors.badRequest(`Broadcast failed: ${message.slice(0, 200)}`);
    }
  });

  /**
   * POST /api/admin/withdrawals/reject — refuse a held withdrawal and give the
   * player their game hay back, with a Ledger row recording the reversal.
   */
  app.post('/api/admin/withdrawals/reject', { preHandler: rateLimit('admin-write') }, async (req) => {
    const operator = await requireAdmin(req);
    const { transferId, reason } = rejectBody.parse(req.body);

    return prisma.$transaction(async (tx) => {
      const transfer = await tx.hayTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw errors.notFound('Transfer');
      if (transfer.status !== 'review') throw errors.conflict(`That transfer is already ${transfer.status}`);

      const rejected = await tx.hayTransfer.updateMany({
        where: { id: transferId, status: 'review' },
        data: { status: 'failed', error: `rejected by operator: ${reason}` },
      });
      if (rejected.count !== 1) throw errors.conflict('Someone else is handling that one');

      const amount = unitsToHay(hayToUnits(transfer.amount));
      const farm = await tx.farm.findUniqueOrThrow({ where: { userId: transfer.userId } });
      const restored = unitsToHay(hayToUnits(farm.hay) + hayToUnits(amount));
      await tx.farm.update({ where: { id: farm.id }, data: { hay: decimal(restored) } });

      await writeLedger(tx, {
        userId: transfer.userId,
        kind: 'hay_withdraw',
        detail: { transferId, rejected: true, reason, operator },
        hayDelta: amount,
      });

      return { status: 'rejected', transferId, refunded: amount };
    });
  });
}
