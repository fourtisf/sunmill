/**
 * Loading, resolving and persisting a farm. Every route goes through here so
 * that timers are resolved on every read and write (HANDOFF §4) and every
 * response carries the same full snapshot the client mirrors (§6).
 */
import { Prisma } from '@prisma/client';
import {
  MACHINES, PENS, TIME_SCALE, fieldsOpen, machineDef, penDef,
} from '../config/gamedata';
import { errors } from '../lib/errors';
import { hayString } from '../lib/money';
import type { Tx } from '../lib/db';
import { used } from './inventory';
import type { Inventory } from './inventory';
import { xpToNext } from './progression';
import { machineToStored, penToStored, resolveFarm } from './resolve';
import type {
  AnimalSlot, MachineJob, RawMachine, RawPen, RawTile, ResolvedFarm,
} from './types';

export interface FarmRow {
  id: string;
  userId: string;
  coins: bigint;
  hay: Prisma.Decimal;
  xp: number;
  level: number;
  siloCap: number;
  barnCap: number;
  ordersFilledAt: Date;
}

export interface OrderRow {
  id: string;
  who: string;
  items: Record<string, number>;
  coins: number;
  xp: number;
  hay: Prisma.Decimal;
  createdAt: Date;
}

export interface FarmState {
  farm: FarmRow;
  tiles: RawTile[];
  machines: RawMachine[];
  pens: RawPen[];
  inventory: Inventory;
  orders: OrderRow[];
}

const farmInclude = {
  tiles: { orderBy: { index: 'asc' } },
  machines: true,
  pens: true,
  inventory: true,
  orders: { orderBy: { createdAt: 'asc' } },
} as const;

function asJobs(value: unknown): MachineJob[] {
  return Array.isArray(value) ? (value as MachineJob[]) : [];
}

function asDone(value: unknown): Record<string, number> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? ({ ...(value as Record<string, number>) })
    : {};
}

function asAnimals(value: unknown): AnimalSlot[] {
  return Array.isArray(value) ? (value as AnimalSlot[]) : [];
}

function asItems(value: unknown): Record<string, number> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? ({ ...(value as Record<string, number>) })
    : {};
}

/** Load everything a route needs, in one round trip. */
export async function loadFarm(tx: Tx, userId: string): Promise<FarmState> {
  const row = await tx.farm.findUnique({ where: { userId }, include: farmInclude });
  if (!row) throw errors.notFound('Farm');

  const inventory: Inventory = {};
  for (const i of row.inventory) if (i.qty > 0) inventory[i.item] = i.qty;

  return {
    farm: {
      id: row.id,
      userId: row.userId,
      coins: row.coins,
      hay: row.hay,
      xp: row.xp,
      level: row.level,
      siloCap: row.siloCap,
      barnCap: row.barnCap,
      ordersFilledAt: row.ordersFilledAt,
    },
    tiles: row.tiles.map((t) => ({ index: t.index, crop: t.crop, plantedAt: t.plantedAt })),
    machines: row.machines.map((m) => ({
      machine: m.machine, jobs: asJobs(m.jobs), done: asDone(m.done),
    })),
    pens: row.pens.map((p) => ({ pen: p.pen, animals: asAnimals(p.animals) })),
    inventory,
    orders: row.orders.map((o) => ({
      id: o.id, who: o.who, items: asItems(o.items),
      coins: o.coins, xp: o.xp, hay: o.hay, createdAt: o.createdAt,
    })),
  };
}

/**
 * Resolve timers and, when something actually settled, write the normalised
 * state back. Reads only write when a job completed or an animal finished —
 * a read of an idle farm touches nothing.
 */
export async function resolveAndPersist(tx: Tx, state: FarmState, now: Date): Promise<ResolvedFarm> {
  const resolved = resolveFarm(
    { level: state.farm.level, tiles: state.tiles, machines: state.machines, pens: state.pens },
    now,
  );

  for (const id of resolved.dirtyMachines) {
    const view = resolved.machines.find((m) => m.machine === id);
    if (!view) continue;
    const stored = machineToStored(view);
    await tx.machineState.update({
      where: { farmId_machine: { farmId: state.farm.id, machine: id } },
      data: { jobs: stored.jobs as unknown as Prisma.InputJsonValue, done: stored.done },
    });
    const local = state.machines.find((m) => m.machine === id);
    if (local) { local.jobs = stored.jobs; local.done = stored.done; }
  }

  for (const id of resolved.dirtyPens) {
    const view = resolved.pens.find((p) => p.pen === id);
    if (!view) continue;
    const stored = penToStored(view);
    await tx.penState.update({
      where: { farmId_pen: { farmId: state.farm.id, pen: id } },
      data: { animals: stored.animals as unknown as Prisma.InputJsonValue },
    });
    const local = state.pens.find((p) => p.pen === id);
    if (local) local.animals = stored.animals;
  }

  return resolved;
}

/* ================= PERSISTENCE HELPERS ================= */

export async function saveInventory(
  tx: Tx, farmId: string, before: Inventory, after: Inventory,
): Promise<void> {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const item of ids) {
    const from = before[item] ?? 0;
    const to = after[item] ?? 0;
    if (from === to) continue;
    if (to <= 0) {
      await tx.inventoryItem.deleteMany({ where: { farmId, item } });
    } else {
      await tx.inventoryItem.upsert({
        where: { farmId_item: { farmId, item } },
        create: { farmId, item, qty: to },
        update: { qty: to },
      });
    }
  }
}

export async function saveMachine(tx: Tx, farmId: string, machine: RawMachine): Promise<void> {
  await tx.machineState.update({
    where: { farmId_machine: { farmId, machine: machine.machine } },
    data: {
      jobs: machine.jobs as unknown as Prisma.InputJsonValue,
      done: machine.done as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function savePen(tx: Tx, farmId: string, pen: RawPen): Promise<void> {
  await tx.penState.update({
    where: { farmId_pen: { farmId, pen: pen.pen } },
    data: { animals: pen.animals as unknown as Prisma.InputJsonValue },
  });
}

/* ================= SNAPSHOT ================= */

export interface Snapshot {
  serverTime: string;
  timeScale: number;
  farm: {
    id: string;
    coins: string;
    hay: string;
    xp: number;
    level: number;
    xpNext: number;
    siloCap: number;
    barnCap: number;
    siloUsed: number;
    barnUsed: number;
    fieldsOpen: number;
    inventory: Inventory;
    tiles: ResolvedFarm['tiles'];
    machines: ResolvedFarm['machines'];
    pens: ResolvedFarm['pens'];
  };
  orders: Array<{
    id: string; who: string; items: Record<string, number>;
    coins: number; xp: number; hay: string; canFill: boolean;
  }>;
  /** Levels reached by the action that produced this snapshot, in order. */
  levelsGained?: number[];
  /** Anything the server wants the client to say out loud. */
  notice?: { message: string; icon?: string; bad?: boolean };
}

export function buildSnapshot(
  state: FarmState,
  resolved: ResolvedFarm,
  now: Date,
  extras: Pick<Snapshot, 'levelsGained' | 'notice'> = {},
): Snapshot {
  const inv = state.inventory;
  return {
    serverTime: now.toISOString(),
    timeScale: TIME_SCALE,
    farm: {
      id: state.farm.id,
      coins: state.farm.coins.toString(),
      hay: hayString(state.farm.hay),
      xp: state.farm.xp,
      level: state.farm.level,
      xpNext: state.farm.xp + xpToNext(state.farm.level, state.farm.xp),
      siloCap: state.farm.siloCap,
      barnCap: state.farm.barnCap,
      siloUsed: used(inv, 'silo'),
      barnUsed: used(inv, 'barn'),
      fieldsOpen: fieldsOpen(state.farm.level),
      inventory: { ...inv },
      tiles: resolved.tiles,
      machines: resolved.machines,
      pens: resolved.pens,
    },
    orders: state.orders.map((o) => ({
      id: o.id,
      who: o.who,
      items: o.items,
      coins: o.coins,
      xp: o.xp,
      hay: hayString(o.hay),
      canFill: Object.keys(o.items).every((k) => (inv[k] ?? 0) >= o.items[k]),
    })),
    ...extras,
  };
}

/* ================= GUARDS ================= */

export function requireMachineUnlocked(level: number, machineId: string) {
  const def = machineDef(machineId);
  if (!def) throw errors.notFound('Machine');
  if (level < def.lvl) throw errors.levelLocked(def.name, def.lvl);
  return def;
}

export function requirePenUnlocked(level: number, penId: string) {
  const def = penDef(penId);
  if (!def) throw errors.notFound('Pen');
  if (level < def.lvl) throw errors.levelLocked(def.name, def.lvl);
  return def;
}

export function requireTileOpen(level: number, index: number) {
  if (!Number.isInteger(index) || index < 0) throw errors.badRequest('Bad tile index');
  if (index >= fieldsOpen(level)) throw errors.levelLocked('That field', level + 1);
  return index;
}

export const ALL_MACHINE_IDS = MACHINES.map((m) => m.id);
export const ALL_PEN_IDS = PENS.map((p) => p.id);
