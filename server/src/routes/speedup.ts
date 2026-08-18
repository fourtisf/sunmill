/**
 * POST /api/speedup — pay $HAY to finish a timer now.
 *
 * This is the game's main $HAY sink. Before it existed, orders and level-ups
 * granted hay and almost nothing consumed it, so balances only ever grew.
 *
 * The price is derived server-side from the time actually remaining, read from
 * the same resolved state the client renders — the client never says what a
 * speed-up should cost, and cannot ask for one on a timer that already
 * finished.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_TILES, SPEEDUP } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { rateLimit } from '../lib/ratelimit';
import { hayToUnits, roundHay } from '../lib/money';
import {
  ALL_MACHINE_IDS, ALL_PEN_IDS, requireMachineUnlocked, requirePenUnlocked,
  saveMachine, savePen,
} from '../engine/farm';
import { machineToStored, penToStored, resolveMachine, resolvePen, resolveTile } from '../engine/resolve';
import { addHay, ledger, runAction, saveFarm } from './_context';

const body = z.discriminatedUnion('target', [
  z.object({ target: z.literal('tile'), index: z.number().int().min(0).max(MAX_TILES - 1) }).strict(),
  z.object({ target: z.literal('machine'), machine: z.enum(ALL_MACHINE_IDS as [string, ...string[]]) }).strict(),
  z.object({
    target: z.literal('pen'),
    pen: z.enum(ALL_PEN_IDS as [string, ...string[]]),
    index: z.number().int().min(0).max(31).optional(),
  }).strict(),
]);

/** What it costs to skip `remainingSec`. Rounded to whole $HAY cents. */
export function speedUpCost(remainingSec: number): string {
  const minutes = remainingSec / 60;
  const raw = roundHay(minutes * SPEEDUP.hayPerMinute);
  return hayToUnits(raw) < hayToUnits(SPEEDUP.minHay) ? SPEEDUP.minHay : raw;
}

export default async function speedupRoutes(app: FastifyInstance) {
  app.post('/api/speedup', { preHandler: rateLimit('speedup') }, async (req) => {
    const input = body.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;
      const nowMs = ctx.now.getTime();
      /** How far back every start time must move for the work to be done. */
      let shiftMs = 0;
      let detail: Record<string, unknown>;

      /**
       * Validate the remaining time and take the $HAY. Awaited at each call
       * site so the ledger row is written inside this transaction.
       */
      const charge = async (ms: number, what: Record<string, unknown>) => {
        const remainingSec = ms / 1000;
        if (remainingSec <= SPEEDUP.minRemainingSec) {
          throw errors.badRequest('Almost done already — just wait');
        }
        const cost = speedUpCost(remainingSec);
        if (hayToUnits(ctx.state.farm.hay) < hayToUnits(cost)) throw errors.notEnoughHay();
        addHay(ctx, `-${cost}`);
        await ledger(
          ctx, 'speedup',
          { ...what, remainingSec: Math.round(remainingSec), cost },
          { hay: `-${cost}` },
        );
      };

      if (input.target === 'tile') {
        const tile = ctx.state.tiles.find((t) => t.index === input.index);
        if (!tile) throw errors.notFound('Tile');
        if (!tile.crop || !tile.plantedAt) throw errors.badRequest('Nothing planted there');

        const view = resolveTile(tile, ctx.now, level);
        if (view.ready) throw errors.badRequest('That crop is already ready');
        shiftMs = Date.parse(view.readyAt as string) - nowMs;
        detail = { target: 'tile', index: input.index, crop: tile.crop };

        await charge(shiftMs, detail);
        // Backdate the planting so the crop is ready right now. Readiness is
        // derived from plantedAt, so this is the whole edit.
        tile.plantedAt = new Date(tile.plantedAt.getTime() - shiftMs);
        await ctx.tx.tile.update({
          where: { farmId_index: { farmId: ctx.state.farm.id, index: input.index } },
          data: { plantedAt: tile.plantedAt },
        });
      } else if (input.target === 'machine') {
        const def = requireMachineUnlocked(level, input.machine);
        const state = ctx.state.machines.find((m) => m.machine === def.id);
        if (!state) throw errors.notFound('Machine');

        const view = resolveMachine(state, ctx.now, level);
        if (!view.jobs.length) throw errors.badRequest('Nothing on the line');
        // Skipping the whole queue, not just the head — that is what the
        // player is looking at and what they expect to pay for.
        const lastEnd = Date.parse(view.jobs[view.jobs.length - 1].endsAt);
        shiftMs = lastEnd - nowMs;
        detail = { target: 'machine', machine: def.id, jobs: view.jobs.length };

        await charge(shiftMs, detail);
        const stored = machineToStored(view);
        if (stored.jobs[0]?.startedAt) {
          stored.jobs[0].startedAt = new Date(Date.parse(stored.jobs[0].startedAt) - shiftMs).toISOString();
        }
        state.jobs = stored.jobs;
        state.done = stored.done;
        await saveMachine(ctx.tx, ctx.state.farm.id, state);
      } else {
        const def = requirePenUnlocked(level, input.pen);
        const state = ctx.state.pens.find((p) => p.pen === def.id);
        if (!state) throw errors.notFound('Pen');

        const view = resolvePen(state, ctx.now, level);
        const working = view.animals
          .map((a, i) => ({ a, i }))
          .filter(({ a, i }) => a.state === 'full' && a.readyAt
            && (input.index == null || i === input.index));
        if (!working.length) throw errors.badRequest('Nothing to hurry along here');

        const latest = Math.max(...working.map(({ a }) => Date.parse(a.readyAt as string)));
        shiftMs = latest - nowMs;
        detail = { target: 'pen', pen: def.id, animals: working.length };

        await charge(shiftMs, detail);
        const stored = penToStored(view);
        for (const { i } of working) {
          const animal = stored.animals[i];
          if (animal.fedAt) {
            animal.fedAt = new Date(Date.parse(animal.fedAt) - shiftMs).toISOString();
          }
        }
        state.animals = stored.animals;
        await savePen(ctx.tx, ctx.state.farm.id, state);
      }

      await saveFarm(ctx);
      return { notice: { message: 'Finished it early', icon: 'hay' } };
    });
  });

  /**
   * GET /api/speedup/quote — what a speed-up would cost right now, so the
   * client can show a price without guessing at the formula.
   */
  app.get('/api/speedup/quote', { preHandler: rateLimit('speedup-quote') }, async (req) => {
    const { userId } = await requireAuth(req);
    const snapshot = await runAction(userId, async () => {});
    const nowMs = Date.parse(snapshot.serverTime);

    const quote = (endsAt: string | null) => {
      if (!endsAt) return null;
      const remaining = (Date.parse(endsAt) - nowMs) / 1000;
      if (remaining <= SPEEDUP.minRemainingSec) return null;
      return { remainingSec: Math.round(remaining), hay: speedUpCost(remaining) };
    };

    return {
      serverTime: snapshot.serverTime,
      tiles: snapshot.farm.tiles
        .filter((t) => t.crop && !t.ready)
        .map((t) => ({ index: t.index, ...quote(t.readyAt) }))
        .filter((t) => t.hay),
      machines: snapshot.farm.machines
        .filter((m) => m.jobs.length)
        .map((m) => ({ machine: m.machine, ...quote(m.jobs[m.jobs.length - 1].endsAt) }))
        .filter((m) => m.hay),
      pens: snapshot.farm.pens
        .filter((p) => p.animals.some((a) => a.state === 'full'))
        .map((p) => {
          const latest = p.animals
            .filter((a) => a.state === 'full' && a.readyAt)
            .map((a) => Date.parse(a.readyAt as string));
          return { pen: p.pen, ...quote(new Date(Math.max(...latest)).toISOString()) };
        })
        .filter((p) => p.hay),
    };
  });
}
