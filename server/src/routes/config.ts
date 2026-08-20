/**
 * The client renders from this — it holds no prices, durations or level gates
 * of its own (CLAUDE.md "what NOT to do"). Everything here is public game data;
 * nothing derived from a secret goes out.
 */
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db';
import { redis } from '../lib/redis';
import { schemaStatus } from '../lib/schema';
import {
  CROPS, DAILY, EXPAND, FIELD_OPEN, ITEMS, LEVEL_UP_TEXT, MACHINES, MARKET,
  MAX_LEVEL_CURVE, MAX_TILES, ORDERS, PENS, SPEEDUP, TASK_TEMPLATES,
  TIME_SCALE, UPGRADES, scaled,
} from '../config/gamedata';
import { env, onChainReady } from '../env';
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
    },
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
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      redis.ping().then((r) => r === 'PONG').catch(() => false),
    ]);
    // Only meaningful once the connection is known good; against an
    // unreachable database it would report a drift it cannot actually see.
    const schema = db ? await schemaStatus() : { ok: false, pending: [], unknown: 'database unreachable' };
    const ok = db && cache && schema.ok;
    if (!ok) reply.code(503);
    return {
      ok,
      time,
      postgres: db,
      redis: cache,
      schema: schema.ok,
      ...(schema.pending.length ? { pendingMigrations: schema.pending } : {}),
    };
  });
}
