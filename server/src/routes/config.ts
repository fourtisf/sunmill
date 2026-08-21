/**
 * The client renders from this — it holds no prices, durations or level gates
 * of its own (CLAUDE.md "what NOT to do"). Everything here is public game data;
 * nothing derived from a secret goes out.
 */
import { FastifyInstance } from 'fastify';
import { dbFault, prisma, prismaCode } from '../lib/db';
import { redis } from '../lib/redis';
import { schemaStatus } from '../lib/schema';
import {
  CROPS, DAILY, EXPAND, FIELD_OPEN, ITEMS, LEVEL_UP_TEXT, MACHINES, MARKET,
  MAX_LEVEL_CURVE, MAX_TILES, ORDERS, PENS, SPEEDUP, TASK_TEMPLATES,
  TIME_SCALE, UPGRADES, scaled,
} from '../config/gamedata';
import { env, onChainReady } from '../env';
import { pushEnabled } from '../lib/push';
import { xpNeed } from '../config/gamedata';

export default async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => ({
    timeScale: TIME_SCALE,
    items: Object.fromEntries(
      Object.entries(ITEMS).map(([id, it]) => [
        id,
        {
          ...it,
          // Real seconds, so the client's progress bars need no game rules.
          growSeconds: it.grow != null ? scaled(it.grow) : null,
        },
      ]),
    ),
    crops: CROPS,
    machines: MACHINES.map((m) => ({
      ...m,
      recipes: m.recipes.map((r) => ({ ...r, seconds: scaled(r.sec) })),
    })),
    pens: PENS.map((p) => ({ ...p, seconds: scaled(p.sec) })),
    fieldOpen: FIELD_OPEN,
    maxTiles: MAX_TILES,
    maxLevelCurve: MAX_LEVEL_CURVE,
    levelUpText: LEVEL_UP_TEXT,
    // Pre-computed so the client never re-implements the XP curve.
    xpCurve: Array.from({ length: MAX_LEVEL_CURVE + 10 }, (_, i) => xpNeed(i + 1)),
    expand: EXPAND,
    speedup: { hayPerMinute: SPEEDUP.hayPerMinute, minHay: SPEEDUP.minHay, minRemainingSec: SPEEDUP.minRemainingSec },
    upgrades: UPGRADES,
    tasks: TASK_TEMPLATES,
    daily: {
      taskCount: DAILY.taskCount,
      allDoneBonus: DAILY.allDoneBonus,
      streakCoins: DAILY.streakCoins,
      streakHay: DAILY.streakHay,
    },
    orders: { boardSize: ORDERS.boardSize, ttlSeconds: scaled(ORDERS.ttlSec) },
    market: { refreshSeconds: scaled(MARKET.refreshSec) },
    features: {
      hayOnChain: env.HAY_ONCHAIN_ENABLED && onChainReady(),
      // Which sign-in the client should offer. The server decides, because the
      // server is what actually registered (or did not register) the routes —
      // a button the API would 404 is worse than no button.
      walletLogin: env.WALLET_LOGIN,
      guestLogin: env.GUEST_LOGIN,
      // Whether it is worth the client asking for notification permission at
      // all. A deployment with no VAPID keys never asks.
      push: pushEnabled(),
    },
    // The public half of the VAPID pair. Public by definition — a browser
    // cannot subscribe without it.
    ...(pushEnabled() ? { vapidPublicKey: env.VAPID_PUBLIC_KEY } : {}),
  }));

  /**
   * Liveness by default — cheap, no dependencies, safe to poll.
   *
   * `?deep=1` also proves Postgres and Redis are reachable, and that the
   * database is the shape this build expects. Worth having its own switch: the
   * routes a visitor hits first touch none of the three, so a broken
   * dependency shows up as a 500 on the first login rather than anywhere
   * obvious, and this answers that in one request.
   *
   * The schema half is not pedantry. `SELECT 1` passes against a database
   * whose migrations were never applied, so a deploy that skipped them looks
   * green here while every login 500s — which is exactly how a live site ends
   * up with a Start farming button that cannot start a farm.
   */
  app.get('/api/health', async (req, reply) => {
    const time = new Date().toISOString();
    if (!(req.query as { deep?: string })?.deep) return { ok: true, time };

    const [db, cache] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => ({ ok: true, err: null as unknown }))
        .catch((err: unknown) => ({ ok: false, err })),
      redis.ping().then((r) => ({ ok: r === 'PONG', err: null as unknown }))
        .catch((err: unknown) => ({ ok: false, err })),
    ]);
    // Only meaningful once the connection is known good; against an
    // unreachable database it would report a drift it cannot actually see.
    const schema = db.ok ? await schemaStatus() : { ok: false, pending: [], unknown: 'database unreachable' };
    const ok = db.ok && cache.ok && schema.ok;
    if (!ok) reply.code(503);

    // The whole error goes in the log, where the operator is and the public is
    // not. Discarding it here is what made `"postgres":false` a dead end: the
    // endpoint that exists to answer "why is the site down" knew the reason,
    // said only that there was one, and sent whoever was on call round after
    // round of guessing at a box they were already logged into.
    if (!db.ok) req.log.error({ err: db.err }, 'deep health: postgres is not answering');
    if (!cache.ok) req.log.error({ err: cache.err }, 'deep health: redis is not answering');

    return {
      ok,
      time,
      postgres: db.ok,
      redis: cache.ok,
      schema: schema.ok,
      // The code, and nothing else. /api/health is unauthenticated, and the
      // messages these carry name hosts, ports and role names. A P-code says
      // "wrong password" or "no such database" to the one person who can act
      // on it and nothing at all to anyone else.
      ...(db.ok ? {} : { postgresCode: prismaCode(db.err) ?? dbFault(db.err) ?? 'unknown' }),
      ...(cache.ok ? {} : { redisCode: errCode(cache.err) }),
      ...(schema.pending.length ? { pendingMigrations: schema.pending } : {}),
    };
  });
}

/** ioredis reports ECONNREFUSED, NOAUTH, ETIMEDOUT and the like on `code`. */
function errCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}
