import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ORDERS, scaled } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { prisma } from '../lib/db';
import { cacheDel, cacheGet, cacheSet, keys } from '../lib/redis';
import { orderItemsValid, orderReward } from '../engine/orders';
import { refillBoard } from '../engine/orderBoard';
import { takeAll } from '../engine/inventory';
import { addCoins, addHay, bump, grantXp, ledger, runAction, saveFarm } from './_context';

const idBody = z.object({ orderId: z.string().min(1).max(64) }).strict();

interface CachedOrder {
  id: string; who: string; items: Record<string, number>;
  coins: number; xp: number; hay: string;
}

export default async function orderRoutes(app: FastifyInstance) {
  /**
   * GET /api/orders — the board. Cached per farm in Redis for one refill
   * interval; a cache hit skips the refill transaction entirely and only
   * re-reads the inventory, which is what `canFill` depends on.
   */
  app.get('/api/orders', { preHandler: rateLimit('orders-read', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);

    const farm = await prisma.farm.findUnique({
      where: { userId },
      select: { id: true, inventory: { select: { item: true, qty: true } } },
    });
    if (!farm) throw errors.notFound('Farm');

    const cached = await cacheGet<CachedOrder[]>(keys.orders(farm.id));
    if (cached) {
      const inv: Record<string, number> = {};
      for (const i of farm.inventory) if (i.qty > 0) inv[i.item] = i.qty;
      return {
        orders: cached.map((o) => ({
          ...o,
          canFill: Object.keys(o.items).every((k) => (inv[k] ?? 0) >= o.items[k]),
        })),
        serverTime: new Date().toISOString(),
        cached: true,
      };
    }

    const snapshot = await runAction(userId, async (ctx) => {
      await refillBoard(ctx);
    });
    await cacheSet(
      keys.orders(snapshot.farm.id),
      snapshot.orders.map(({ canFill, ...rest }) => rest),
      Math.max(5, scaled(ORDERS.refillSec)),
    );
    return { orders: snapshot.orders, serverTime: snapshot.serverTime, cached: false };
  });

  /** POST /api/orders/deliver — consume the items, pay out, refill. */
  app.post('/api/orders/deliver', { preHandler: rateLimit('orders-deliver') }, async (req) => {
    const body = idBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const order = ctx.state.orders.find((o) => o.id === body.orderId);
      if (!order) throw errors.notFound('Order');

      // The stored rewards are for display. What we actually pay is re-derived
      // from gamedata right here (HANDOFF §6), after checking the item map is
      // something this player could have been offered.
      if (!orderItemsValid(order.items, ctx.state.farm.level)) {
        throw errors.badRequest('That order is no longer valid');
      }
      const reward = orderReward(order.items);

      if (!takeAll(ctx.state.inventory, order.items)) throw errors.missingItems(order.items);

      addCoins(ctx, BigInt(reward.coins));
      addHay(ctx, reward.hay);
      await grantXp(ctx, reward.xp);

      await ctx.tx.order.delete({ where: { id: order.id } });
      ctx.state.orders = ctx.state.orders.filter((o) => o.id !== order.id);

      await saveFarm(ctx);
      await ledger(ctx, 'order', {
        orderId: order.id, who: order.who, items: order.items,
      }, { coins: BigInt(reward.coins), hay: reward.hay, xp: reward.xp });

      await bump(ctx, 'deliver');
      await refillBoard(ctx, true);
      await cacheDel(keys.orders(ctx.state.farm.id));

      return {
        notice: {
          message: `Delivered to ${order.who} — +${reward.coins} coins, +${reward.hay} $HAY`,
          icon: 'coin',
        },
      };
    });
  });

  /** POST /api/orders/skip — drop an order; the board refills on its timer. */
  app.post('/api/orders/skip', { preHandler: rateLimit('orders-skip') }, async (req) => {
    const body = idBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const order = ctx.state.orders.find((o) => o.id === body.orderId);
      if (!order) throw errors.notFound('Order');

      await ctx.tx.order.delete({ where: { id: order.id } });
      ctx.state.orders = ctx.state.orders.filter((o) => o.id !== order.id);

      await ledger(ctx, 'order_skip', { orderId: order.id, items: order.items });
      await refillBoard(ctx);
      await cacheDel(keys.orders(ctx.state.farm.id));
      return undefined;
    });
  });
}
