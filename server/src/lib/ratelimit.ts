/**
 * Per-user token bucket in Redis. Every action route sits behind one so a
 * scripted client cannot hammer the economy (HANDOFF §6).
 *
 * Implemented as a fixed window with an atomic INCR + EXPIRE: cheap, and the
 * worst case (a burst straddling two windows) is well inside what a human
 * playing the game will ever hit.
 */
import { FastifyRequest } from 'fastify';
import { errors } from './errors';
import { keys, redis } from './redis';

export interface Limit {
  /** Requests allowed per window. */
  points: number;
  /** Window length in seconds. */
  windowSec: number;
}

/** Tuned so a fast human tapping crops never trips, but a script does. */
export const LIMITS = {
  action: { points: 120, windowSec: 60 },
  read: { points: 240, windowSec: 60 },
  auth: { points: 20, windowSec: 300 },
  hay: { points: 6, windowSec: 3600 },
} satisfies Record<string, Limit>;

export async function consume(userId: string, bucket: string, limit: Limit): Promise<void> {
  const key = keys.rate(userId, bucket);
  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, limit.windowSec);
  } catch {
    // A Redis outage must not lock players out of their farm; Postgres is
    // still the authority for every balance.
    return;
  }
  if (count > limit.points) {
    let ttl = limit.windowSec;
    try {
      const t = await redis.ttl(key);
      if (t > 0) ttl = t;
    } catch { /* fall back to the window length */ }
    throw errors.rateLimited(ttl);
  }
}

/** Fastify preHandler factory. */
export function rateLimit(bucket: string, limit: Limit = LIMITS.action) {
  return async (req: FastifyRequest) => {
    const userId = req.user?.userId;
    if (!userId) return; // auth guard will reject anyway
    await consume(userId, bucket, limit);
  };
}
