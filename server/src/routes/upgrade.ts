/**
 * POST /api/upgrade — late-game capacity: extra machine slots and extra
 * animals.
 *
 * The prototype ran out of things to give at level 10. These are what levels
 * 11 to 18 unlock, and both cost coins AND $HAY so the endgame keeps draining
 * the token rather than letting it pile up. Nothing here adds a new item type,
 * because the art engine is fixed and a new item would have no sprite.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UPGRADES, penDef } from '../config/gamedata';
import { requireAuth } from '../auth/plugin';
import { errors } from '../lib/errors';
import { hayToUnits } from '../lib/money';
import { rateLimit } from '../lib/ratelimit';
import {
  ALL_MACHINE_IDS, ALL_PEN_IDS, requireMachineUnlocked, requirePenUnlocked, savePen,
} from '../engine/farm';
import { penToStored, resolvePen } from '../engine/resolve';
import { addCoins, addHay, ledger, runAction, saveFarm } from './_context';

const body = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('machineSlot'),
    machine: z.enum(ALL_MACHINE_IDS as [string, ...string[]]),
  }).strict(),
  z.object({
    target: z.literal('penAnimal'),
    pen: z.enum(ALL_PEN_IDS as [string, ...string[]]),
  }).strict(),
]);

export interface UpgradeQuote {
  bought: number;
  max: number;
  /** Null once every step has been bought. */
  next: { level: number; coins: number; hay: string } | null;
}

export function quoteUpgrade(
  rules: { maxExtra: number; levels: number[]; coins: number[]; hay: string[] },
  bought: number,
): UpgradeQuote {
  if (bought >= rules.maxExtra) return { bought, max: rules.maxExtra, next: null };
  return {
    bought,
    max: rules.maxExtra,
    next: { level: rules.levels[bought], coins: rules.coins[bought], hay: rules.hay[bought] },
  };
}

export default async function upgradeRoutes(app: FastifyInstance) {
  /** GET /api/upgrade — what is available, and what the next step costs. */
  app.get('/api/upgrade', { preHandler: rateLimit('upgrade-read') }, async (req) => {
    const { userId } = await requireAuth(req);
    const snapshot = await runAction(userId, async () => {});

    return {
      machineSlots: snapshot.farm.machines
        .filter((m) => m.open)
        .map((m) => ({
          machine: m.machine,
          slots: m.slots,
          ...quoteUpgrade(UPGRADES.machineSlot, m.extraSlots),
        })),
      penAnimals: snapshot.farm.pens
        .filter((p) => p.open)
        .map((p) => {
          const base = penDef(p.pen)?.count ?? 0;
          return {
            pen: p.pen,
            animals: p.animals.length,
            ...quoteUpgrade(UPGRADES.penAnimal, Math.max(0, p.animals.length - base)),
          };
        }),
      level: snapshot.farm.level,
    };
  });

  app.post('/api/upgrade', { preHandler: rateLimit('upgrade') }, async (req) => {
    const input = body.parse(req.body);
    const { userId } = await requireAuth(req);

    return runAction(userId, async (ctx) => {
      const { level } = ctx.state.farm;

      if (input.target === 'machineSlot') {
        const def = requireMachineUnlocked(level, input.machine);
        const state = ctx.state.machines.find((m) => m.machine === def.id);
        if (!state) throw errors.notFound('Machine');

        const bought = state.extraSlots ?? 0;
        const quote = quoteUpgrade(UPGRADES.machineSlot, bought);
        if (!quote.next) throw errors.badRequest(`${def.name} already has every slot`);
        if (level < quote.next.level) throw errors.levelLocked('That slot', quote.next.level);

        await spend(quote.next.coins, quote.next.hay);
        state.extraSlots = bought + 1;
        await ctx.tx.machineState.update({
          where: { farmId_machine: { farmId: ctx.state.farm.id, machine: def.id } },
          data: { extraSlots: state.extraSlots },
        });
        await ledger(ctx, 'upgrade', {
          target: 'machineSlot', machine: def.id, slots: def.slots + state.extraSlots,
        }, { coins: -BigInt(quote.next.coins), hay: `-${quote.next.hay}` });

        return {
          notice: {
            code: 'machine_slot_added',
            message: `${def.name} now runs ${def.slots + state.extraSlots} jobs`,
            params: { machine: def.id, jobs: def.slots + state.extraSlots } as Record<string, string | number>,
            icon: 'coin',
          },
        };
      }

      const def = requirePenUnlocked(level, input.pen);
      const state = ctx.state.pens.find((p) => p.pen === def.id);
      if (!state) throw errors.notFound('Pen');

      const bought = Math.max(0, state.animals.length - def.count);
      const quote = quoteUpgrade(UPGRADES.penAnimal, bought);
      if (!quote.next) throw errors.badRequest(`The ${def.name.toLowerCase()} is already full`);
      if (level < quote.next.level) throw errors.levelLocked('That animal', quote.next.level);

      await spend(quote.next.coins, quote.next.hay);
      // Resolve first so a finished animal is not reset by the rewrite.
      const stored = penToStored(resolvePen(state, ctx.now, level));
      stored.animals.push({ state: 'hungry', fedAt: null });
      state.animals = stored.animals;
      await savePen(ctx.tx, ctx.state.farm.id, state);
      await ledger(ctx, 'upgrade', {
        target: 'penAnimal', pen: def.id, animals: state.animals.length,
      }, { coins: -BigInt(quote.next.coins), hay: `-${quote.next.hay}` });

      return {
        notice: {
          code: 'animal_added',
          message: `A new arrival at the ${def.name.toLowerCase()}`,
          params: { pen: def.id } as Record<string, string | number>,
          icon: def.out,
        },
      };

      async function spend(coins: number, hay: string) {
        if (ctx.state.farm.coins < BigInt(coins)) throw errors.notEnoughCoins();
        if (hayToUnits(ctx.state.farm.hay) < hayToUnits(hay)) throw errors.notEnoughHay();
        addCoins(ctx, -BigInt(coins));
        addHay(ctx, `-${hay}`);
        await saveFarm(ctx);
      }
    });
  });
}
