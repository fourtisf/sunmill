import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recipeDef, requireItem, scaled } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import { give, hasAll, takeAll } from '../engine/inventory';
import { ALL_MACHINE_IDS, requireMachineUnlocked, saveMachine } from '../engine/farm';
import { machineToStored, resolveMachine } from '../engine/resolve';
import { grantXp, ledger, runAction, saveFarm } from './_context';

const machineId = z.enum(ALL_MACHINE_IDS as [string, ...string[]]);

const queueBody = z.object({
  machine: machineId,
  recipeOut: z.string().min(1).max(32),
}).strict();

const collectBody = z.object({ machine: machineId }).strict();

export default async function machineRoutes(app: FastifyInstance) {
  /** POST /api/machine/queue — consume ingredients, take a slot, start the timer. */
  app.post('/api/machine/queue', { preHandler: rateLimit('machine-queue') }, async (req) => {
    const body = queueBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const def = requireMachineUnlocked(level, body.machine);
      const recipe = recipeDef(def, body.recipeOut);
      if (!recipe) throw errors.notFound('Recipe');
      if (level < recipe.lvl) throw errors.levelLocked(requireItem(recipe.out).name, recipe.lvl);

      const state = ctx.state.machines.find((m) => m.machine === def.id);
      if (!state) throw errors.notFound('Machine');

      // Work from the resolved queue so a job that finished while we were away
      // has already freed its slot.
      const view = resolveMachine(state, ctx.now, level);
      if (view.jobs.length >= def.slots) throw errors.queueFull(def.name);
      if (!hasAll(ctx.state.inventory, recipe.inp)) throw errors.missingItems(recipe.inp);
      if (!takeAll(ctx.state.inventory, recipe.inp)) throw errors.missingItems(recipe.inp);

      const stored = machineToStored(view);
      // Duration is frozen at enqueue time so retuning TIME_SCALE never
      // re-times work already on the line.
      stored.jobs.push({ out: recipe.out, sec: scaled(recipe.sec), startedAt: null });
      if (stored.jobs.length === 1) stored.jobs[0].startedAt = ctx.now.toISOString();

      state.jobs = stored.jobs;
      state.done = stored.done;
      await saveMachine(ctx.tx, ctx.state.farm.id, state);

      await ledger(ctx, 'craft', {
        machine: def.id, out: recipe.out, inputs: recipe.inp, seconds: scaled(recipe.sec),
      });
      return undefined;
    });
  });

  /** POST /api/machine/collect — move finished goods into the barn. */
  app.post('/api/machine/collect', { preHandler: rateLimit('machine-collect') }, async (req) => {
    const body = collectBody.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const def = requireMachineUnlocked(level, body.machine);
      const state = ctx.state.machines.find((m) => m.machine === def.id);
      if (!state) throw errors.notFound('Machine');

      const view = resolveMachine(state, ctx.now, level);
      const stored = machineToStored(view);
      const waiting = Object.keys(stored.done).filter((k) => stored.done[k] > 0);
      if (!waiting.length) throw errors.badRequest('Nothing to collect');

      const collected: Record<string, number> = {};
      let xp = 0;
      let short = false;
      for (const item of waiting) {
        const want = stored.done[item];
        const got = give(ctx.state.inventory, ctx.state.farm, item, want);
        if (got > 0) {
          collected[item] = got;
          xp += requireItem(item).xp * got;
        }
        if (got < want) { stored.done[item] = want - got; short = true; } else delete stored.done[item];
      }

      if (!Object.keys(collected).length) throw errors.noSpace('barn');

      state.jobs = stored.jobs;
      state.done = stored.done;
      await saveMachine(ctx.tx, ctx.state.farm.id, state);

      await grantXp(ctx, xp);
      await saveFarm(ctx);
      await ledger(ctx, 'collect', { machine: def.id, items: collected }, { xp });

      if (short) return { notice: { message: 'Barn is full', icon: waiting[0], bad: true } };
      return undefined;
    });
  });
}
