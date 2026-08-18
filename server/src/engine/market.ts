/**
 * Roadside market generation (HANDOFF §2.6).
 *
 * Listings are generated per player and cached in Redis, so the price is not
 * derivable from config alone. Every purchase therefore re-checks the price
 * against the legal band — even a poisoned cache cannot invent a price.
 */
import { MARKET, NEIGHBOUR_NAMES, requireItem, sellables } from '../config/gamedata';
import { pick, randFloat, randInt } from './rng';

export interface Listing {
  id: string;
  item: string;
  qty: number;
  price: number;
  who: string;
}

export interface MarketBoard {
  listings: Listing[];
  /** ISO timestamp of the roll, used to age the board out. */
  rolledAt: string;
  /** The level the board was rolled for — a level-up re-rolls it. */
  level: number;
}

export function priceBand(itemId: string): { min: number; max: number } {
  const sell = requireItem(itemId).sell;
  return { min: Math.round(sell * MARKET.priceMin), max: Math.round(sell * MARKET.priceMax) };
}

export function rollMarket(level: number, now: Date): MarketBoard {
  const pool = sellables(level);
  const listings: Listing[] = [];
  for (let i = 0; i < MARKET.listings && pool.length; i += 1) {
    const item = pick(pool);
    const it = requireItem(item);
    const band = it.sell < MARKET.cheapUnder ? MARKET.cheapQty : MARKET.pricyQty;
    listings.push({
      id: `${i}-${item}-${Math.random().toString(36).slice(2, 8)}`,
      item,
      qty: randInt(band.min, band.max),
      price: Math.round(it.sell * randFloat(MARKET.priceMin, MARKET.priceMax)),
      who: pick(NEIGHBOUR_NAMES),
    });
  }
  return { listings, rolledAt: now.toISOString(), level };
}

/** A listing is only honoured when its price sits inside the generated band. */
export function listingPriceValid(listing: Listing): boolean {
  const band = priceBand(listing.item);
  return Number.isInteger(listing.price) && listing.price >= band.min && listing.price <= band.max;
}
