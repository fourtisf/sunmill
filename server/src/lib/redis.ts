/**
 * Redis: session cache, per-user market + order-board caches, rate-limit
 * buckets. Nothing here is authoritative — every cached value is either
 * re-derived or re-validated against Postgres and gamedata before it can move
 * coins (HANDOFF §3).
 */
import Redis from 'ioredis';
import { env } from '../env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis]', err.message);
});

export const keys = {
  market: (farmId: string) => `sunmill:market:${farmId}`,
  orders: (farmId: string) => `sunmill:orders:${farmId}`,
  rate: (userId: string, bucket: string) => `sunmill:rl:${bucket}:${userId}`,
  nonce: (address: string) => `sunmill:nonce:${address}`,
  hayDaily: (userId: string) => `sunmill:haycap:${userId}`,
};

/** Best-effort get — a Redis outage degrades to a cache miss, never a 500. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  } catch {
    /* cache writes are best effort */
  }
}

export async function cacheDel(...keysToDrop: string[]): Promise<void> {
  try {
    if (keysToDrop.length) await redis.del(...keysToDrop);
  } catch {
    /* ignore */
  }
}
