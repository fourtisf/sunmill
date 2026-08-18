import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EXPAND } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import { hayToUnits } from '../lib/money';
import { addCoins, addHay, ledger, runAction, saveFarm } from './_context';

const body = z.object({ target: z.enum(['silo', 'barn']) }).strict();

export default async function expandRoutes(app: FastifyInstance) {
  /** POST /api/expand — buy +20 capacity. Price scales with current capacity. */
  app.post('/api/expand', { preHandler: rateLimit('expand') }, async (req) => {
    const { target } = body.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const rules = EXPAND[target];
      const current = target === 'silo' ? ctx.state.farm.siloCap : ctx.state.farm.barnCap;
      if (current + rules.step > rules.max) {
        throw errors.badRequest(`${target === 'silo' ? 'Silo' : 'Barn'} is already at its maximum`);
      }

      const coinCost = BigInt(Math.round(current * rules.coinsPerCap));
      if (ctx.state.farm.coins < coinCost) throw errors.notEnoughCoins();
      if (hayToUnits(ctx.state.farm.hay) < hayToUnits(rules.hay)) throw errors.notEnoughHay();

      addCoins(ctx, -coinCost);
      addHay(ctx, `-${rules.hay}`);
      if (target === 'silo') ctx.state.farm.siloCap = current + rules.step;
      else ctx.state.farm.barnCap = current + rules.step;

      await saveFarm(ctx);
      await ledger(ctx, 'expand', {
        target, from: current, to: current + rules.step, coinCost: coinCost.toString(), hayCost: rules.hay,
      }, { coins: -coinCost, hay: `-${rules.hay}` });

      return { notice: { code: 'expand_done', message: 'Upgrade complete!', icon: 'coin' } };
    });
  });
}
