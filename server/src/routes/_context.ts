/**
 * The shape every action route shares: one Prisma transaction that loads the
 * farm, resolves timers against the server clock, applies the mutation, writes
 * a Ledger row, and returns the full resolved snapshot (CLAUDE.md rule 3).
 *
 * Actions mutate `state` in memory as well as through `tx`, so the snapshot
 * built at the end reflects the post-action farm without a second round trip.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import type { Tx } from '../lib/db';
import { decimal, hayToUnits, unitsToHay } from '../lib/money';
import { writeLedger } from '../lib/ledger';
import type { LedgerKind } from '../lib/ledger';
import { addXp } from '../engine/progression';
import { resolveFarm } from '../engine/resolve';
import {
  buildSnapshot, loadFarm, resolveAndPersist, saveInventory,
} from '../engine/farm';
import type { FarmState, Snapshot } from '../engine/farm';
import type { Inventory } from '../engine/inventory';
import type { ResolvedFarm } from '../engine/types';

export interface ActionContext {
  tx: Tx;
  userId: string;
  state: FarmState;
  /** Timers as of the start of the action. */
  resolved: ResolvedFarm;
  now: Date;
  /** Inventory as loaded, for computing the minimal write at the end. */
  inventoryBefore: Inventory;
  /** Levels gained during this action, filled in by grantXp. */
  levelsGained: number[];
}

export type ActionResult = Pick<Snapshot, 'notice'> | void;
export type ActionFn = (ctx: ActionContext) => Promise<ActionResult>;

/** Run a read or a mutation inside one transaction and return a snapshot. */
export async function runAction(userId: string, fn: ActionFn): Promise<Snapshot> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const state = await loadFarm(tx, userId);
    const inventoryBefore = { ...state.inventory };
    const resolved = await resolveAndPersist(tx, state, now);

    const ctx: ActionContext = {
      tx, userId, state, resolved, now, inventoryBefore, levelsGained: [],
    };
    const extras = (await fn(ctx)) ?? {};

    await saveInventory(tx, state.farm.id, inventoryBefore, state.inventory);

    // Re-resolve from the mutated state so the response shows the new farm.
    const after = resolveFarm(
      { level: state.farm.level, tiles: state.tiles, machines: state.machines, pens: state.pens },
      now,
    );

    return buildSnapshot(state, after, now, {
      ...extras,
      levelsGained: ctx.levelsGained.length ? ctx.levelsGained : undefined,
    });
  }, { timeout: 15_000 });
}

/* ================= BALANCE MUTATORS ================= */

export function addCoins(ctx: ActionContext, delta: bigint): void {
  ctx.state.farm.coins += delta;
  if (ctx.state.farm.coins < 0n) throw new Error('coin balance went negative');
}

export function addHay(ctx: ActionContext, delta: string): void {
  const units = hayToUnits(ctx.state.farm.hay) + hayToUnits(delta);
  if (units < 0n) throw new Error('hay balance went negative');
  ctx.state.farm.hay = new Prisma.Decimal(unitsToHay(units));
}

/**
 * Grant XP and settle any level-ups it causes, including their coin/$HAY
 * bonuses and their own Ledger row.
 */
export async function grantXp(ctx: ActionContext, gained: number): Promise<void> {
  if (gained <= 0) return;
  const before = { level: ctx.state.farm.level, xp: ctx.state.farm.xp };
  const result = addXp(before.level, before.xp, gained);
  ctx.state.farm.level = result.level;
  ctx.state.farm.xp = result.xp;

  if (result.levelsGained.length) {
    addCoins(ctx, result.coinsGained);
    addHay(ctx, result.hayGained);
    ctx.levelsGained.push(...result.levelsGained);
    await writeLedger(ctx.tx, {
      userId: ctx.userId,
      kind: 'levelup',
      detail: { from: before.level, to: result.level, levels: result.levelsGained },
      coinsDelta: result.coinsGained,
      hayDelta: result.hayGained,
    });
  }
}

/** Persist the farm's scalar columns. Call once per action, after mutating. */
export async function saveFarm(ctx: ActionContext): Promise<void> {
  await ctx.tx.farm.update({
    where: { id: ctx.state.farm.id },
    data: {
      coins: ctx.state.farm.coins,
      hay: decimal(ctx.state.farm.hay.toString()),
      xp: ctx.state.farm.xp,
      level: ctx.state.farm.level,
      siloCap: ctx.state.farm.siloCap,
      barnCap: ctx.state.farm.barnCap,
    },
  });
}

/** Convenience: one ledger row for the action itself. */
export async function ledger(
  ctx: ActionContext,
  kind: LedgerKind,
  detail: Prisma.InputJsonValue,
  deltas: { coins?: bigint; hay?: string; xp?: number } = {},
): Promise<void> {
  await writeLedger(ctx.tx, {
    userId: ctx.userId,
    kind,
    detail,
    coinsDelta: deltas.coins ?? 0n,
    hayDelta: deltas.hay ?? '0',
    xpDelta: deltas.xp ?? 0,
  });
}
