import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireItem } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import { give, qtyOf, spaceFor, take } from '../engine/inventory';
import { ALL_PEN_IDS, requirePenUnlocked, savePen } from '../engine/farm';
import { penToStored, resolvePen } from '../engine/resolve';
import { bump, grantXp, ledger, runAction, saveFarm } from './_context';

const penId = z.enum(ALL_PEN_IDS as [string, ...string[]]);

const feedBody = z.object({
  pen: penId,
  /** Omit to feed every hungry animal that there is feed for. */
  index: z.number().int().min(0).max(31).optional(),
}).strict();

const collectBody = z.object({
  pen: penId,
  index: z.number().int().min(0).max(31).optional(),
}).strict();

export default async function penRoutes(app: FastifyInstance) {
  /** POST /api/pen/feed — consume feed, start the production timer. */
  app.post('/api/pen/feed', { preHandler: rateLimit('pen-feed') }, async (req) => {
    const body = feedBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const def = requirePenUnlocked(level, body.pen);
      const state = ctx.state.pens.find((p) => p.pen === def.id);
      if (!state) throw errors.notFound('Pen');

      const stored = penToStored(resolvePen(state, ctx.now, level));
      if (body.index != null && body.index >= stored.animals.length) throw errors.notFound('Animal');

      const targets = body.index != null
        ? [body.index]
        : stored.animals.map((_, i) => i);

      let fed = 0;
      for (const i of targets) {
        const animal = stored.animals[i];
        if (!animal || animal.state !== 'hungry') continue;
        if (qtyOf(ctx.state.inventory, def.feed) <= 0) break;
        if (!take(ctx.state.inventory, def.feed, 1)) break;
        stored.animals[i] = { state: 'full', fedAt: ctx.now.toISOString() };
        fed += 1;
      }

      if (!fed) {
        if (qtyOf(ctx.state.inventory, def.feed) <= 0) {
          throw errors.missingItems({ [def.feed]: 1 });
        }
        throw errors.badRequest('Nothing to feed here');
      }

      state.animals = stored.animals;
      await savePen(ctx.tx, ctx.state.farm.id, state);
      await ledger(ctx, 'feed', { pen: def.id, fed, feed: def.feed });
      await bump(ctx, 'feed', fed);
      return undefined;
    });
  });

  /** POST /api/pen/collect — take the product from every ready animal. */
  app.post('/api/pen/collect', { preHandler: rateLimit('pen-collect') }, async (req) => {
    const body = collectBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const def = requirePenUnlocked(level, body.pen);
      const state = ctx.state.pens.find((p) => p.pen === def.id);
      if (!state) throw errors.notFound('Pen');

      const stored = penToStored(resolvePen(state, ctx.now, level));
      if (body.index != null && body.index >= stored.animals.length) throw errors.notFound('Animal');

      const targets = body.index != null ? [body.index] : stored.animals.map((_, i) => i);

      let collected = 0;
      let short = false;
      for (const i of targets) {
        const animal = stored.animals[i];
        if (!animal || animal.state !== 'ready') continue;
        if (spaceFor(ctx.state.inventory, ctx.state.farm, def.out) <= 0) { short = true; break; }
        const got = give(ctx.state.inventory, ctx.state.farm, def.out, 1);
        if (!got) { short = true; break; }
        stored.animals[i] = { state: 'hungry', fedAt: null };
        collected += 1;
      }

      if (!collected) {
        if (short) throw errors.noSpace('barn');
        throw errors.badRequest('Nothing to collect here');
      }

      state.animals = stored.animals;
      await savePen(ctx.tx, ctx.state.farm.id, state);

      const xp = requireItem(def.out).xp * collected;
      await grantXp(ctx, xp);
      await saveFarm(ctx);
      await ledger(ctx, 'produce', { pen: def.id, item: def.out, qty: collected }, { xp });
      await bump(ctx, 'collect_pen', collected);

      if (short) return { notice: { message: 'Barn is full', icon: def.out, bad: true } };
      return undefined;
    });
  });
}
