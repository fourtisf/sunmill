/**
 * Order board generation and reward maths (HANDOFF §2.5).
 *
 * Rewards are a pure function of the item map, which is what makes it safe to
 * store them on the Order row for display and then RE-DERIVE them at delivery
 * (§6): a tampered row can never pay out more than the config allows.
 */
import { ORDERS, NEIGHBOUR_NAMES, requireItem, sellables } from '../config/gamedata';
import { roundHay } from '../lib/money';
import { pick, randInt } from './rng';

export interface OrderReward {
  coins: number;
  xp: number;
  hay: string;
}

export interface GeneratedOrder extends OrderReward {
  who: string;
  items: Record<string, number>;
}

/** THE reward formula. Every payout in the game goes through this one function. */
export function orderReward(items: Record<string, number>): OrderReward {
  let coinsRaw = 0;
  let xp = 0;
  for (const id of Object.keys(items)) {
    const qty = items[id];
    const it = requireItem(id);
    coinsRaw += it.sell * qty * ORDERS.coinMultiplier;
    xp += it.xp * qty;
  }
  return {
    coins: Math.round(coinsRaw) + ORDERS.coinBonus,
    xp: xp + ORDERS.xpBonus,
    hay: roundHay(coinsRaw / ORDERS.hayDivisor),
  };
}

/** One order a player at `level` could plausibly fill. Null when nothing fits. */
export function makeOrder(level: number): GeneratedOrder | null {
  const pool = sellables(level).filter((id) => requireItem(id).sell >= ORDERS.minSellPrice);
  if (!pool.length) return null;

  const wanted = randInt(1, Math.min(ORDERS.maxDistinctItems, pool.length));
  const chosen = new Set<string>();
  for (let guard = 0; chosen.size < wanted && guard < 40; guard += 1) chosen.add(pick(pool));

  const items: Record<string, number> = {};
  for (const id of chosen) {
    const band = requireItem(id).sell < ORDERS.cheapUnder ? ORDERS.cheapQty : ORDERS.pricyQty;
    items[id] = randInt(band.min, band.max);
  }

  return { who: pick(NEIGHBOUR_NAMES), items, ...orderReward(items) };
}

/** Generate up to `count` orders. Fewer if the level pool is too thin. */
export function makeOrders(level: number, count: number): GeneratedOrder[] {
  const out: GeneratedOrder[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = makeOrder(level);
    if (!o) break;
    out.push(o);
  }
  return out;
}

/**
 * Reject an order whose stored items are not something this player could have
 * been offered — the last line of defence before we pay out.
 */
export function orderItemsValid(items: Record<string, number>, level: number): boolean {
  const allowed = new Set(sellables(level));
  const ids = Object.keys(items);
  if (!ids.length || ids.length > ORDERS.maxDistinctItems) return false;
  for (const id of ids) {
    const qty = items[id];
    if (!Number.isInteger(qty) || qty <= 0) return false;
    if (!allowed.has(id)) return false;
    const band = requireItem(id).sell < ORDERS.cheapUnder ? ORDERS.cheapQty : ORDERS.pricyQty;
    if (qty > band.max) return false;
  }
  return true;
}
