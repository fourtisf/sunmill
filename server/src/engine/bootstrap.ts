/**
 * Creating a farm. Every starting value comes from gamedata — the client never
 * supplies a balance, a capacity or an inventory.
 */
import { Prisma } from '@prisma/client';
import { MACHINES, MAX_TILES, PENS, START } from '../config/gamedata';
import { decimal } from '../lib/money';
import type { Tx } from '../lib/db';
import type { AnimalSlot } from './types';

function freshAnimals(count: number): AnimalSlot[] {
  return Array.from({ length: count }, () => ({ state: 'hungry' as const, fedAt: null }));
}

/** Create the farm, all 12 tile slots, the four machines and the three pens. */
export async function createFarm(tx: Tx, userId: string) {
  const farm = await tx.farm.create({
    data: {
      userId,
      coins: START.coins,
      hay: decimal(START.hay),
      xp: START.xp,
      level: START.level,
      siloCap: START.siloCap,
      barnCap: START.barnCap,
      // Epoch, so the order board fills on the very first read instead of
      // trickling in one order per refill interval.
      ordersFilledAt: new Date(0),
      tiles: {
        create: Array.from({ length: MAX_TILES }, (_, index) => ({ index, crop: null, plantedAt: null })),
      },
      machines: {
        create: MACHINES.map((m) => ({ machine: m.id, jobs: [], done: {} })),
      },
      pens: {
        create: PENS.map((p) => ({
          pen: p.id,
          animals: freshAnimals(p.count) as unknown as Prisma.InputJsonValue,
        })),
      },
      inventory: {
        create: Object.entries(START.inventory).map(([item, qty]) => ({ item, qty })),
      },
    },
  });
  return farm;
}

/**
 * Heal a farm that predates a config change — a new machine, a new pen, or
 * more tile slots. Idempotent, so it is safe to run on every login.
 */
export async function ensureFarmShape(tx: Tx, farmId: string) {
  const [tiles, machines, pens] = await Promise.all([
    tx.tile.findMany({ where: { farmId }, select: { index: true } }),
    tx.machineState.findMany({ where: { farmId }, select: { machine: true } }),
    tx.penState.findMany({ where: { farmId }, select: { pen: true } }),
  ]);

  const haveTiles = new Set(tiles.map((t) => t.index));
  const missingTiles = Array.from({ length: MAX_TILES }, (_, i) => i).filter((i) => !haveTiles.has(i));
  if (missingTiles.length) {
    await tx.tile.createMany({
      data: missingTiles.map((index) => ({ farmId, index })),
      skipDuplicates: true,
    });
  }

  const haveMachines = new Set(machines.map((m) => m.machine));
  const missingMachines = MACHINES.filter((m) => !haveMachines.has(m.id));
  if (missingMachines.length) {
    await tx.machineState.createMany({
      data: missingMachines.map((m) => ({ farmId, machine: m.id, jobs: [], done: {} })),
      skipDuplicates: true,
    });
  }

  const havePens = new Set(pens.map((p) => p.pen));
  const missingPens = PENS.filter((p) => !havePens.has(p.id));
  if (missingPens.length) {
    await tx.penState.createMany({
      data: missingPens.map((p) => ({
        farmId,
        pen: p.id,
        animals: freshAnimals(p.count) as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }
}
