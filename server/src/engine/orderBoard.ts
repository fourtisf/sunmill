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
  const missing = ORDERS.boardSize - ctx.state.orders.length;
  if (missing <= 0) return;

  const intervalMs = scaled(ORDERS.refillSec) * 1000;
  const elapsed = ctx.now.getTime() - ctx.state.farm.ordersFilledAt.getTime();
  const earned = force ? missing : Math.floor(elapsed / intervalMs);
  const add = Math.min(missing, Math.max(0, earned));
  if (add <= 0) return;

  const generated = makeOrders(ctx.state.farm.level, add);
  for (const g of generated) {
    const row = await ctx.tx.order.create({
      data: {
        farmId: ctx.state.farm.id,
        who: g.who,
        items: g.items,
        coins: g.coins,
        xp: g.xp,
        hay: decimal(g.hay),
      },
    });
    ctx.state.orders.push({
      id: row.id, who: row.who, items: g.items, coins: row.coins,
      xp: row.xp, hay: row.hay, createdAt: row.createdAt,
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
