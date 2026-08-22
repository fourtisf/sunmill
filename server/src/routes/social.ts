/**
 * Other people.
 *
 * The leaderboard listed names and led nowhere, and the neighbours on the
 * order board are strings from a config file. This is the smallest thing that
 * makes the other names real: you can go and look at someone's farm, and you
 * can send them something out of your barn.
 *
 * Visiting is strictly read-only — the snapshot is built by the same resolver
 * every other read uses, then stripped of everything that is nobody else's
 * business: balances, inventory, orders, tasks, streak. A visitor sees a farm,
 * not a bank statement.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { errors } from '../lib/errors';
import { LIMITS, consume, rateLimit } from '../lib/ratelimit';
import { requireAuth } from '../auth/plugin';
import { runAction } from './_context';
import { loadFarm } from '../engine/farm';
import { resolveFarm } from '../engine/resolve';
import { give, qtyOf, spaceFor, take } from '../engine/inventory';
import { writeLedger } from '../lib/ledger';
import { ITEMS, fieldsOpen, storeOf } from '../config/gamedata';

/** Nobody sends a hundred of anything as a present. */
const MAX_GIFT_QTY = 20;
/** How many unclaimed gifts a mailbox holds before it turns people away. */
const MAILBOX_LIMIT = 30;

const giftBody = z.object({
  toUserId: z.string().min(1).max(64),
  item: z.string().min(1).max(32),
  qty: z.number().int().min(1).max(MAX_GIFT_QTY),
  note: z.string().max(120).optional(),
}).strict();

const claimBody = z.object({ giftId: z.string().min(1).max(64) }).strict();

export default async function socialRoutes(app: FastifyInstance) {
  /**
   * GET /api/visit/:userId — somebody else's farm, as a visitor sees it.
   */
  app.get<{ Params: { userId: string } }>('/api/visit/:userId', {
    preHandler: rateLimit('visit', LIMITS.read),
  }, async (req) => {
    await requireAuth(req);
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).strict().parse(req.params);

    const host = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!host) throw errors.notFound('Farm');

    const state = await loadFarm(prisma, userId).catch(() => null);
    if (!state) throw errors.notFound('Farm');

    const now = new Date();
    // Resolved for display only. Nothing is persisted: a visit must not settle
    // somebody else's timers, and the lazy resolver means it does not have to
    // — their farm settles the next time they read it themselves.
    const resolved = resolveFarm(
      { level: state.farm.level, tiles: state.tiles, machines: state.machines, pens: state.pens },
      now,
    );

    return {
      serverTime: now.toISOString(),
      host: { id: host.id, name: host.name, farmName: state.farm.name },
      farm: {
        level: state.farm.level,
        fieldsOpen: fieldsOpen(state.farm.level),
        tiles: resolved.tiles,
        machines: resolved.machines,
        pens: resolved.pens,
      },
    };
  });

  /**
   * POST /api/gift — send something out of your barn.
   *
   * The items leave the sender here and land in nobody's store: they sit in
   * the Gift row until claimed. Anything else either overflows a store the
   * sender cannot see, or has the goods existing in two farms at once.
   */
  app.post('/api/gift', async (req) => {
    const { userId } = await requireAuth(req);
    const body = giftBody.parse(req.body);
    if (body.toUserId === userId) throw errors.badRequest('That is your own farm');
    if (!ITEMS[body.item]) throw errors.badRequest('No such item');

    await consume(userId, 'gift', LIMITS.gift);

    const recipient = await prisma.user.findUnique({
      where: { id: body.toUserId }, select: { id: true },
    });
    if (!recipient) throw errors.notFound('Farm');

    const waiting = await prisma.gift.count({
      where: { toUserId: body.toUserId, claimedAt: null },
    });
    if (waiting >= MAILBOX_LIMIT) throw errors.badRequest('Their mailbox is full');

    return runAction(userId, async (ctx) => {
      if (qtyOf(ctx.state.inventory, body.item) < body.qty) {
        throw errors.missingItems({ [body.item]: body.qty });
      }
      take(ctx.state.inventory, body.item, body.qty);

      await ctx.tx.gift.create({
        data: {
          fromUserId: userId, toUserId: body.toUserId,
          item: body.item, qty: body.qty, note: body.note ?? null,
        },
      });
      await writeLedger(ctx.tx, {
        userId,
        kind: 'gift_send',
        detail: { to: body.toUserId, item: body.item, qty: body.qty },
      });
      return {
        notice: {
          code: 'gift_sent',
          message: `Sent ${body.qty} ${ITEMS[body.item].name}`,
          params: { n: body.qty, item: body.item },
          icon: body.item,
        },
      };
    });
  });

  /** GET /api/gifts — what is waiting in my mailbox. */
  app.get('/api/gifts', { preHandler: rateLimit('gifts', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);
    const gifts = await prisma.gift.findMany({
      where: { toUserId: userId, claimedAt: null },
      orderBy: { createdAt: 'desc' },
      take: MAILBOX_LIMIT,
      select: {
        id: true, item: true, qty: true, note: true, createdAt: true,
        from: { select: { id: true, name: true } },
      },
    });
    return {
      gifts: gifts.map((g) => ({
        id: g.id, item: g.item, qty: g.qty, note: g.note,
        createdAt: g.createdAt.toISOString(),
        from: { id: g.from.id, name: g.from.name },
      })),
    };
  });

  /**
   * POST /api/gifts/claim — take one out of the mailbox.
   *
   * The capacity check happens here, not when it was sent, because this is the
   * first moment anyone knows how full the store is. A gift that does not fit
   * stays in the mailbox rather than being partly taken and partly lost.
   */
  app.post('/api/gifts/claim', async (req) => {
    const { userId } = await requireAuth(req);
    const { giftId } = claimBody.parse(req.body);

    return runAction(userId, async (ctx) => {
      // Claimed inside the transaction, and only if it is still unclaimed:
      // two taps on the same gift must credit it once.
      const claimed = await ctx.tx.gift.updateMany({
        where: { id: giftId, toUserId: userId, claimedAt: null },
        data: { claimedAt: ctx.now },
      });
      if (claimed.count !== 1) throw errors.notFound('Gift');

      const gift = await ctx.tx.gift.findUniqueOrThrow({ where: { id: giftId } });
      const room = spaceFor(ctx.state.inventory, ctx.state.farm, gift.item);
      if (room < gift.qty) throw errors.noSpace(storeOf(gift.item));

      give(ctx.state.inventory, ctx.state.farm, gift.item, gift.qty);
      await writeLedger(ctx.tx, {
        userId,
        kind: 'gift_claim',
        detail: { from: gift.fromUserId, item: gift.item, qty: gift.qty },
      });
      return {
        notice: {
          code: 'gift_claimed',
          message: `Collected ${gift.qty} ${ITEMS[gift.item]?.name ?? gift.item}`,
          params: { n: gift.qty, item: gift.item },
          icon: gift.item,
        },
      };
    });
  });
}
