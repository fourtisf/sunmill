import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_TILES, cropUnlocked, requireItem } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import { give, spaceFor } from '../engine/inventory';
import { requireTileOpen } from '../engine/farm';
import { resolveTile } from '../engine/resolve';
import { addCoins, grantXp, ledger, runAction, saveFarm } from './_context';

const plantBody = z.object({
  tiles: z.array(z.number().int().min(0).max(MAX_TILES - 1)).min(1).max(MAX_TILES),
  crop: z.string().min(1).max(32),
}).strict();

const harvestBody = z.object({
  tile: z.number().int().min(0).max(MAX_TILES - 1),
}).strict();

export default async function fieldRoutes(app: FastifyInstance) {
  /**
   * POST /api/plant — the sweep. One call plants every tile the drag touched;
   * the server charges seed cost per tile and stops when the coins run out.
   */
  app.post('/api/plant', { preHandler: rateLimit('plant') }, async (req) => {
    const body = plantBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const item = requireItem(body.crop);
      if (item.type !== 'crop') throw errors.badRequest('That is not a seed');
      if (!cropUnlocked(body.crop, level)) throw errors.levelLocked(item.name, item.lvl ?? 1);

      const seedCost = BigInt(item.seed ?? 0);
      const wanted = Array.from(new Set(body.tiles)).sort((a, b) => a - b);

      const planted: number[] = [];
      let brokeEarly = false;
      for (const index of wanted) {
        requireTileOpen(level, index);
        const tile = ctx.state.tiles.find((t) => t.index === index);
        if (!tile) throw errors.notFound('Tile');
        if (tile.crop) continue; // already growing — the sweep passed over it
        if (ctx.state.farm.coins < seedCost) { brokeEarly = true; break; }

        addCoins(ctx, -seedCost);
        tile.crop = body.crop;
        tile.plantedAt = ctx.now;
        await ctx.tx.tile.update({
          where: { farmId_index: { farmId: ctx.state.farm.id, index } },
          data: { crop: body.crop, plantedAt: ctx.now },
        });
        planted.push(index);
      }

      if (!planted.length) {
        if (brokeEarly) throw errors.notEnoughCoins();
        throw errors.badRequest('Nothing to plant there');
      }

      await saveFarm(ctx);
      const spent = seedCost * BigInt(planted.length);
      await ledger(ctx, 'plant', { crop: body.crop, tiles: planted, seedCost: item.seed }, { coins: -spent });

      if (brokeEarly) {
        return { notice: { message: `Only had coins for ${planted.length}`, icon: body.crop, bad: true } };
      }
      return undefined;
    });
  });

  /** POST /api/harvest — tap a ready tile. Yield lands in the silo if it fits. */
  app.post('/api/harvest', { preHandler: rateLimit('harvest') }, async (req) => {
    const body = harvestBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      requireTileOpen(level, body.tile);

      const tile = ctx.state.tiles.find((t) => t.index === body.tile);
      if (!tile) throw errors.notFound('Tile');
      if (!tile.crop || !tile.plantedAt) throw errors.badRequest('Nothing planted there');

      const view = resolveTile(tile, ctx.now, level);
      if (!view.ready) throw errors.notReady(requireItem(tile.crop).name);

      const item = requireItem(tile.crop);
      const yieldQty = item.yield ?? 1;
      if (spaceFor(ctx.state.inventory, ctx.state.farm, tile.crop) <= 0) throw errors.noSpace('silo');

      const got = give(ctx.state.inventory, ctx.state.farm, tile.crop, yieldQty);
      const cropId = tile.crop;

      tile.crop = null;
      tile.plantedAt = null;
      await ctx.tx.tile.update({
        where: { farmId_index: { farmId: ctx.state.farm.id, index: body.tile } },
        data: { crop: null, plantedAt: null },
      });

      await grantXp(ctx, item.xp);
      await saveFarm(ctx);
      await ledger(ctx, 'harvest', { crop: cropId, tile: body.tile, got, yield: yieldQty }, { xp: item.xp });

      if (got < yieldQty) {
        return { notice: { message: 'Silo nearly full — sell or upgrade', icon: cropId, bad: true } };
      }
      return undefined;
    });
  });
}
