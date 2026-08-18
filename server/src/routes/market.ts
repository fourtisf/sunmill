import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MARKET, requireItem, scaled, sellables } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { LIMITS, rateLimit } from '../lib/ratelimit';
import { getBoard, releaseListing, reserveListing } from '../lib/marketCache';
import { listingPriceValid } from '../engine/market';
import { give, qtyOf, spaceFor, take } from '../engine/inventory';
import { prisma } from '../lib/db';
import { addCoins, grantXp, ledger, runAction, saveFarm } from './_context';

const buyBody = z.object({ listingId: z.string().min(1).max(64) }).strict();
const sellBody = z.object({
  item: z.string().min(1).max(32),
  qty: z.number().int().min(1).max(9999),
}).strict();

export default async function marketRoutes(app: FastifyInstance) {
  /** GET /api/market — the player's listings, generated and cached server-side. */
  app.get('/api/market', { preHandler: rateLimit('market-read', LIMITS.read) }, async (req) => {
    const { userId } = await requireAuth(req);
    const farm = await prisma.farm.findUnique({ where: { userId }, select: { id: true, level: true } });
    if (!farm) throw errors.notFound('Farm');

    const now = new Date();
    const board = await getBoard(farm.id, farm.level, now);
    return {
      listings: board.listings,
      rolledAt: board.rolledAt,
      refreshSeconds: scaled(MARKET.refreshSec),
      serverTime: now.toISOString(),
    };
  });

  /**
   * POST /api/market/buy — one unit from a listing.
   *
   * The unit is reserved in Redis first so two tabs cannot buy the same last
   * one; if the transaction then fails, the reservation is handed back. The
   * price is re-checked against the band the generator can produce, so even a
   * poisoned cache cannot invent a bargain.
   */
  app.post('/api/market/buy', { preHandler: rateLimit('market-buy') }, async (req) => {
    const body = buyBody.parse(req.body);
    const { userId } = await requireAuth(req);

    const farm = await prisma.farm.findUnique({ where: { userId }, select: { id: true, level: true } });
    if (!farm) throw errors.notFound('Farm');

    // Make sure a board exists before reserving against it.
    await getBoard(farm.id, farm.level, new Date());
    const listing = await reserveListing(farm.id, body.listingId);
    if (!listing) throw errors.badRequest('That listing is gone');

    try {
      if (!listingPriceValid(listing)) throw errors.badRequest('That listing is gone');
      if (!sellables(farm.level).includes(listing.item)) throw errors.badRequest('That listing is gone');
      const item = requireItem(listing.item);
      const price = BigInt(listing.price);

      return await runAction(userId, async (ctx) => {
        if (ctx.state.farm.coins < price) throw errors.notEnoughCoins();
        if (spaceFor(ctx.state.inventory, ctx.state.farm, listing.item) <= 0) {
          throw errors.noSpace(item.type === 'crop' ? 'silo' : 'barn');
        }
        const got = give(ctx.state.inventory, ctx.state.farm, listing.item, 1);
        if (!got) throw errors.noSpace(item.type === 'crop' ? 'silo' : 'barn');

        addCoins(ctx, -price);
        await saveFarm(ctx);
        await ledger(ctx, 'buy', {
          listingId: listing.id, item: listing.item, qty: 1, price: listing.price, who: listing.who,
        }, { coins: -price });
        return undefined;
      });
    } catch (err) {
      await releaseListing(farm.id, body.listingId);
      throw err;
    }
  });

  /** POST /api/market/sell — sell surplus at the config price, plus a little XP. */
  app.post('/api/market/sell', { preHandler: rateLimit('market-sell') }, async (req) => {
    const body = sellBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const item = requireItem(body.item);
      const have = qtyOf(ctx.state.inventory, body.item);
      if (have <= 0) throw errors.badRequest(`No ${item.name} to sell`);

      const qty = Math.min(body.qty, have);
      if (!take(ctx.state.inventory, body.item, qty)) throw errors.badRequest(`No ${item.name} to sell`);

      const gain = BigInt(item.sell * qty);
      addCoins(ctx, gain);

      const xp = Math.ceil(item.xp * qty * MARKET.sellXpFactor);
      await grantXp(ctx, xp);
      await saveFarm(ctx);
      await ledger(ctx, 'sell', {
        item: body.item, qty, unitPrice: item.sell,
      }, { coins: gain, xp });

      return { notice: { message: `Sold ${qty}× ${item.name} — +${gain}`, icon: 'coin' } };
    });
  });
}
