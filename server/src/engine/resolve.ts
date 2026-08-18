/**
 * SUNMILL — lazy, server-authoritative timer resolution (HANDOFF §4).
 *
 * There are no cron jobs and no per-farm intervals. Every request that touches
 * a farm calls resolve() with the SERVER clock; the resolved state is a pure
 * function of (stored rows, game config, now), so it is deterministic and
 * idempotent — resolving twice is the same as resolving once, and a farm that
 * has not been read for a week settles correctly on its next request.
 *
 * Nothing here auto-harvests. Crops/animals become `ready`; the player still
 * has to tap. Machine jobs are the one exception the prototype makes: a job
 * that finishes moves itself into `done` and starts the next queued job, which
 * is exactly the prototype's queue chaining.
 *
 * NOTE on retuning: machine jobs store the real duration they were queued
 * with, so a TIME_SCALE change never re-times work already in progress. Crops
 * and animals derive their duration from live config, so a TIME_SCALE change
 * does apply to them immediately.
 */
import {
  MACHINES, PENS, fieldsOpen, growSeconds, machineDef, penDef, scaled,
} from '../config/gamedata';
import type {
  RawMachine, RawPen, RawTile, ResolvedAnimal, ResolvedFarm, ResolvedJob,
  ResolvedMachine, ResolvedPen, ResolvedTile,
} from './types';

const SEC = 1000;

function iso(d: Date): string {
  return d.toISOString();
}

/* ================= TILES ================= */

/**
 * A tile is ready when now >= plantedAt + grow. Readiness is derived, never
 * stored — there is nothing to write back, so reads stay cheap.
 */
export function resolveTile(tile: RawTile, now: Date, level: number): ResolvedTile {
  const open = tile.index < fieldsOpen(level);
  if (!tile.crop || !tile.plantedAt) {
    return {
      index: tile.index, crop: null, plantedAt: null,
      dur: 0, ready: false, readyAt: null, open,
    };
  }
  const dur = growSeconds(tile.crop);
  const readyAt = new Date(tile.plantedAt.getTime() + dur * SEC);
  return {
    index: tile.index,
    crop: tile.crop,
    plantedAt: iso(tile.plantedAt),
    dur,
    ready: now.getTime() >= readyAt.getTime(),
    readyAt: iso(readyAt),
    open,
  };
}

/* ================= MACHINES ================= */

/**
 * Walk the queue from its head. Every job whose end time has passed moves into
 * `done`, and the next job starts at exactly the moment the previous finished
 * — never at `now` — so a farm left alone for an hour settles the same way it
 * would have with someone watching.
 */
export function resolveMachine(state: RawMachine, now: Date, level: number): ResolvedMachine & { changed: boolean } {
  const def = machineDef(state.machine);
  const extraSlots = state.extraSlots ?? 0;
  const slots = (def?.slots ?? 0) + extraSlots;
  const open = def ? level >= def.lvl : false;

  const done: Record<string, number> = { ...state.done };
  const pending = Array.isArray(state.jobs) ? state.jobs.slice() : [];
  let changed = false;

  // A queue can only exist with a start time on its head; heal a missing one
  // rather than letting the job hang forever.
  if (pending.length > 0 && !pending[0].startedAt) {
    pending[0] = { ...pending[0], startedAt: iso(now) };
    changed = true;
  }

  let cursor = pending.length > 0 && pending[0].startedAt
    ? new Date(pending[0].startedAt).getTime()
    : now.getTime();

  const jobs: ResolvedJob[] = [];
  for (const job of pending) {
    const startsAt = cursor;
    const endsAt = startsAt + job.sec * SEC;
    if (now.getTime() >= endsAt) {
      done[job.out] = (done[job.out] ?? 0) + 1;
      cursor = endsAt;
      changed = true;
      continue;
    }
    jobs.push({
      out: job.out,
      sec: job.sec,
      startedAt: iso(new Date(startsAt)),
      startsAt: iso(new Date(startsAt)),
      endsAt: iso(new Date(endsAt)),
    });
    cursor = endsAt;
  }

  return { machine: state.machine, jobs, done, slots, extraSlots, open, changed };
}

/** The stored form of a resolved machine — only the head keeps a start time. */
export function machineToStored(resolved: ResolvedMachine): RawMachine {
  return {
    machine: resolved.machine,
    extraSlots: resolved.extraSlots,
    jobs: resolved.jobs.map((j, i) => ({
      out: j.out,
      sec: j.sec,
      startedAt: i === 0 ? j.startsAt : null,
    })),
    done: resolved.done,
  };
}

/* ================= PENS ================= */

/** A fed animal becomes `ready` once its production time has elapsed. */
export function resolvePen(state: RawPen, now: Date, level: number): ResolvedPen & { changed: boolean } {
  const def = penDef(state.pen);
  const open = def ? level >= def.lvl : false;
  const sec = def ? scaled(def.sec) : 0;
  let changed = false;

  const animals: ResolvedAnimal[] = (Array.isArray(state.animals) ? state.animals : []).map((a) => {
    if (a.state !== 'full' || !a.fedAt) {
      return { state: a.state, fedAt: a.fedAt ?? null, readyAt: null };
    }
    const readyAt = new Date(new Date(a.fedAt).getTime() + sec * SEC);
    if (now.getTime() >= readyAt.getTime()) {
      changed = true;
      return { state: 'ready', fedAt: a.fedAt, readyAt: iso(readyAt) };
    }
    return { state: 'full', fedAt: a.fedAt, readyAt: iso(readyAt) };
  });

  return { pen: state.pen, animals, open, changed };
}

export function penToStored(resolved: ResolvedPen): RawPen {
  return {
    pen: resolved.pen,
    animals: resolved.animals.map((a) => ({ state: a.state, fedAt: a.fedAt })),
  };
}

/* ================= WHOLE FARM ================= */

export interface ResolveInput {
  level: number;
  tiles: RawTile[];
  machines: RawMachine[];
  pens: RawPen[];
}

export function resolveFarm(input: ResolveInput, now: Date): ResolvedFarm {
  const tiles = input.tiles
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((t) => resolveTile(t, now, input.level));

  const dirtyMachines: string[] = [];
  const machines: ResolvedMachine[] = [];
  for (const def of MACHINES) {
    const raw = input.machines.find((m) => m.machine === def.id)
      ?? { machine: def.id, jobs: [], done: {} };
    const r = resolveMachine(raw, now, input.level);
    if (r.changed) dirtyMachines.push(def.id);
    machines.push({
      machine: r.machine, jobs: r.jobs, done: r.done,
      slots: r.slots, extraSlots: r.extraSlots, open: r.open,
    });
  }

  const dirtyPens: string[] = [];
  const pens: ResolvedPen[] = [];
  for (const def of PENS) {
    const raw = input.pens.find((p) => p.pen === def.id)
      ?? { pen: def.id, animals: [] };
    const r = resolvePen(raw, now, input.level);
    if (r.changed) dirtyPens.push(def.id);
    pens.push({ pen: r.pen, animals: r.animals, open: r.open });
  }

  return { tiles, machines, pens, dirtyMachines, dirtyPens };
}

/** Convenience for routes: the resolved view of one machine, or throw. */
export function findMachine(farm: ResolvedFarm, id: string): ResolvedMachine | undefined {
  return farm.machines.find((m) => m.machine === id);
}

export function findPen(farm: ResolvedFarm, id: string): ResolvedPen | undefined {
  return farm.pens.find((p) => p.pen === id);
}

export function findTile(farm: ResolvedFarm, index: number): ResolvedTile | undefined {
  return farm.tiles.find((t) => t.index === index);
}
