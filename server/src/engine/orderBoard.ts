/**
 * Order board upkeep. Lives here rather than in the orders route because
 * GET /api/farm tops the board up too — otherwise a player who never opens the
 * Orders panel would see an empty truck forever.
 */
import { ORDERS, scaled } from '../config/gamedata';
import { decimal } from '../lib/money';
import { cacheDel, keys } from '../lib/redis';
import { makeOrders } from './orders';
import type { ActionLike } from './orderBoardTypes';

/**
 * Top the board back up to `boardSize`, at most one order per refill interval.
 * `force` skips the wait — used right after a delivery, so filling the truck is
 * never punished by an empty board.
 *
 * The interval throttle is what stops a player churning Skip to reroll: any
 * generation resets the clock, so the board cannot be refreshed faster than
 * the game intends.
 */
export async function refillBoard(ctx: ActionLike, force = false): Promise<void> {
  await dropExpired(ctx);

  const missing = ORDERS.boardSize - ctx.state.orders.length;
  if (missing <= 0) return;

  const intervalMs = scaled(ORDERS.refillSec) * 1000;
  const elapsed = ctx.now.getTime() - ctx.state.farm.ordersFilledAt.getTime();
  const earned = force ? missing : Math.floor(elapsed / intervalMs);
  const add = Math.min(missing, Math.max(0, earned));
  if (add <= 0) return;

  const generated = makeOrders(ctx.state.farm.level, add);
  const expiresAt = new Date(ctx.now.getTime() + scaled(ORDERS.ttlSec) * 1000);
  const names = await neighbourNames(ctx, generated.length);

  for (const [i, g] of generated.entries()) {
    const row = await ctx.tx.order.create({
      data: {
        farmId: ctx.state.farm.id,
        who: names[i] ?? g.who,
        items: g.items,
        coins: g.coins,
        xp: g.xp,
        hay: decimal(g.hay),
        expiresAt,
      },
    });
    ctx.state.orders.push({
      id: row.id, who: row.who, items: g.items, coins: row.coins,
      xp: row.xp, hay: row.hay, createdAt: row.createdAt, expiresAt: row.expiresAt,
    });
  }

  if (generated.length) {
    ctx.state.farm.ordersFilledAt = ctx.now;
    await ctx.tx.farm.update({
      where: { id: ctx.state.farm.id },
      data: { ordersFilledAt: ctx.now },
    });
    await cacheDel(keys.orders(ctx.state.farm.id));
  }
}

/**
 * Drop orders whose time ran out. Without an expiry the truck was a static
 * list nobody had a reason to act on today.
 */
async function dropExpired(ctx: ActionLike): Promise<void> {
  const expired = ctx.state.orders.filter((o) => o.expiresAt && o.expiresAt <= ctx.now);
  if (!expired.length) return;
  await ctx.tx.order.deleteMany({ where: { id: { in: expired.map((o) => o.id) } } });
  ctx.state.orders = ctx.state.orders.filter((o) => !expired.includes(o));
  await cacheDel(keys.orders(ctx.state.farm.id));
}

/**
 * Names for the order board. Real players first, so the truck feels like it
 * belongs to a world with other farms in it; the fixed list in gamedata is
 * only the fallback for an empty or brand-new database.
 */
async function neighbourNames(ctx: ActionLike, count: number): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const others = await ctx.tx.user.findMany({
      where: { name: { not: null }, id: { not: ctx.state.farm.userId } },
      select: { name: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    if (!others.length) return [];
    const pool = others.map((u) => u.name as string);
    return Array.from({ length: count }, () => pool[Math.floor(Math.random() * pool.length)]);
  } catch {
    return [];
  }
}
