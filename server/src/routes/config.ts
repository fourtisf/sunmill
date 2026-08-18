/**
 * The client renders from this — it holds no prices, durations or level gates
 * of its own (CLAUDE.md "what NOT to do"). Everything here is public game data;
 * nothing derived from a secret goes out.
 */
import { FastifyInstance } from 'fastify';
import {
  CROPS, EXPAND, FIELD_OPEN, ITEMS, LEVEL_UP_TEXT, MACHINES, MARKET,
  MAX_TILES, ORDERS, PENS, TIME_SCALE, scaled,
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
    levelUpText: LEVEL_UP_TEXT,
    // Pre-computed so the client never re-implements the XP curve.
    xpCurve: Array.from({ length: 30 }, (_, i) => xpNeed(i + 1)),
    expand: EXPAND,
    orders: { boardSize: ORDERS.boardSize },
    market: { refreshSeconds: scaled(MARKET.refreshSec) },
    features: {
      hayOnChain: env.HAY_ONCHAIN_ENABLED && onChainReady(),
    },
  }));

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));
}
