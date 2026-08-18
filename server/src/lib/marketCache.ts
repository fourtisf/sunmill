/**
 * Per-player market board, cached in Redis (HANDOFF §3). The cache is never
 * trusted for money: a purchase re-checks the price against the band the
 * generator can produce (engine/market.ts) before a single coin moves.
 */
import { MARKET, scaled } from '../config/gamedata';
import { rollMarket } from '../engine/market';
import type { Listing, MarketBoard } from '../engine/market';
import { cacheGet, cacheSet, keys, redis } from './redis';

const TTL_PADDING_SEC = 30;

function ttl(): number {
  return scaled(MARKET.refreshSec) + TTL_PADDING_SEC;
}

function isStale(board: MarketBoard, level: number, now: Date): boolean {
  if (board.level !== level) return true;
  const age = (now.getTime() - new Date(board.rolledAt).getTime()) / 1000;
  return age >= scaled(MARKET.refreshSec);
}

/** The player's current board, rolling a fresh one when it has aged out. */
export async function getBoard(farmId: string, level: number, now: Date): Promise<MarketBoard> {
  const cached = await cacheGet<MarketBoard>(keys.market(farmId));
  if (cached && Array.isArray(cached.listings) && !isStale(cached, level, now)) return cached;

  const board = rollMarket(level, now);
  await cacheSet(keys.market(farmId), board, ttl());
  return board;
}

export async function dropBoard(farmId: string): Promise<void> {
  try {
    await redis.del(keys.market(farmId));
  } catch { /* best effort */ }
}

/**
 * Atomically take one unit off a listing. Returns the listing as it was before
 * the decrement, or null when it is gone or sold out — so two tabs cannot buy
 * the same last unit twice.
 */
const RESERVE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local board = cjson.decode(raw)
for i, l in ipairs(board.listings) do
  if l.id == ARGV[1] then
    if (tonumber(l.qty) or 0) <= 0 then return nil end
    local taken = cjson.encode(l)
    board.listings[i].qty = l.qty - 1
    redis.call('SET', KEYS[1], cjson.encode(board), 'KEEPTTL')
    return taken
  end
end
return nil
`;

const RELEASE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local board = cjson.decode(raw)
for i, l in ipairs(board.listings) do
  if l.id == ARGV[1] then
    board.listings[i].qty = l.qty + 1
    redis.call('SET', KEYS[1], cjson.encode(board), 'KEEPTTL')
    return 1
  end
end
return 0
`;

export async function reserveListing(farmId: string, listingId: string): Promise<Listing | null> {
  try {
    const raw = (await redis.eval(RESERVE, 1, keys.market(farmId), listingId)) as string | null;
    return raw ? (JSON.parse(raw) as Listing) : null;
  } catch {
    return null;
  }
}

/** Put a reserved unit back after a failed purchase. */
export async function releaseListing(farmId: string, listingId: string): Promise<void> {
  try {
    await redis.eval(RELEASE, 1, keys.market(farmId), listingId);
  } catch { /* best effort — the board re-rolls soon anyway */ }
}
