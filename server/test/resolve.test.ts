import { describe, expect, it } from 'vitest';
import {
  machineToStored, penToStored, resolveFarm, resolveMachine, resolvePen, resolveTile,
} from '../src/engine/resolve';
import { ITEMS, MACHINES, PENS, TIME_SCALE, machineDef, scaled } from '../src/config/gamedata';
import type { RawMachine, RawPen, RawTile } from '../src/engine/types';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

describe('resolveTile — plant → ready boundary', () => {
  const wheatGrow = scaled(ITEMS.wheat.grow!);
  const tile: RawTile = { index: 0, crop: 'wheat', plantedAt: T0 };

  it('is not ready one millisecond before the boundary', () => {
    const r = resolveTile(tile, new Date(T0.getTime() + wheatGrow * 1000 - 1), 1);
    expect(r.ready).toBe(false);
    expect(r.dur).toBe(wheatGrow);
    expect(r.readyAt).toBe(new Date(T0.getTime() + wheatGrow * 1000).toISOString());
  });

  it('is ready exactly on the boundary', () => {
    expect(resolveTile(tile, at(wheatGrow), 1).ready).toBe(true);
  });

  it('stays ready long after — it never auto-harvests', () => {
    const r = resolveTile(tile, at(wheatGrow * 100), 1);
    expect(r.ready).toBe(true);
    expect(r.crop).toBe('wheat');
  });

  it('reports an empty tile as not ready', () => {
    const r = resolveTile({ index: 1, crop: null, plantedAt: null }, at(9999), 1);
    expect(r.ready).toBe(false);
    expect(r.readyAt).toBeNull();
  });

  it('marks tiles beyond the level cap as closed', () => {
    expect(resolveTile({ index: 3, crop: null, plantedAt: null }, T0, 1).open).toBe(true);
    expect(resolveTile({ index: 4, crop: null, plantedAt: null }, T0, 1).open).toBe(false);
    expect(resolveTile({ index: 4, crop: null, plantedAt: null }, T0, 2).open).toBe(true);
  });

  it('uses the crop-specific duration', () => {
    const cane: RawTile = { index: 2, crop: 'sugarcane', plantedAt: T0 };
    const dur = scaled(ITEMS.sugarcane.grow!);
    expect(resolveTile(cane, at(dur - 0.001), 6).ready).toBe(false);
    expect(resolveTile(cane, at(dur), 6).ready).toBe(true);
  });
});

describe('resolveMachine — queue chaining', () => {
  const mill = machineDef('mill')!;
  const jobSec = scaled(14); // cfeed

  const queued = (n: number): RawMachine => ({
    machine: 'mill',
    jobs: Array.from({ length: n }, (_, i) => ({
      out: 'cfeed', sec: jobSec, startedAt: i === 0 ? T0.toISOString() : null,
    })),
    done: {},
  });

  it('leaves an in-flight head alone and derives the queued starts', () => {
    const r = resolveMachine(queued(3), at(jobSec - 1), 1);
    expect(r.changed).toBe(false);
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0].startsAt).toBe(T0.toISOString());
    expect(r.jobs[1].startsAt).toBe(at(jobSec).toISOString());
    expect(r.jobs[2].startsAt).toBe(at(jobSec * 2).toISOString());
    expect(r.done).toEqual({});
  });

  it('starts the next job when the previous completes, not at now', () => {
    const r = resolveMachine(queued(3), at(jobSec + 1), 1);
    expect(r.changed).toBe(true);
    expect(r.done).toEqual({ cfeed: 1 });
    expect(r.jobs).toHaveLength(2);
    // Job 2 started the instant job 1 finished — not when we happened to look.
    expect(r.jobs[0].startsAt).toBe(at(jobSec).toISOString());
    expect(r.jobs[0].endsAt).toBe(at(jobSec * 2).toISOString());
  });

  it('settles a whole queue left unattended', () => {
    const r = resolveMachine(queued(3), at(jobSec * 10), 1);
    expect(r.jobs).toHaveLength(0);
    expect(r.done).toEqual({ cfeed: 3 });
  });

  it('completes a job exactly on its boundary', () => {
    expect(resolveMachine(queued(1), at(jobSec - 0.001), 1).done).toEqual({});
    expect(resolveMachine(queued(1), at(jobSec), 1).done).toEqual({ cfeed: 1 });
  });

  it('is idempotent — resolving the stored result again changes nothing', () => {
    const once = resolveMachine(queued(3), at(jobSec * 1.5), 1);
    const twice = resolveMachine(machineToStored(once), at(jobSec * 1.5), 1);
    expect(twice.changed).toBe(false);
    expect(twice.done).toEqual(once.done);
    expect(twice.jobs.map((j) => j.startsAt)).toEqual(once.jobs.map((j) => j.startsAt));
  });

  it('accumulates onto goods already waiting to be collected', () => {
    const state: RawMachine = { ...queued(1), done: { cfeed: 2 } };
    expect(resolveMachine(state, at(jobSec), 1).done).toEqual({ cfeed: 3 });
  });

  it('heals a queue whose head lost its start time', () => {
    const broken: RawMachine = {
      machine: 'mill', jobs: [{ out: 'cfeed', sec: jobSec, startedAt: null }], done: {},
    };
    const r = resolveMachine(broken, T0, 1);
    expect(r.changed).toBe(true);
    expect(r.jobs[0].startsAt).toBe(T0.toISOString());
  });

  it('reports slots and the level gate from config', () => {
    const r = resolveMachine({ machine: 'sugar', jobs: [], done: {} }, T0, 1);
    expect(r.slots).toBe(mill.slots);
    expect(r.open).toBe(false);
    expect(resolveMachine({ machine: 'sugar', jobs: [], done: {} }, T0, 6).open).toBe(true);
  });
});

describe('resolvePen — feed → ready cycle', () => {
  const coop = PENS.find((p) => p.id === 'chicken')!;
  const sec = scaled(coop.sec);

  const pen = (fedOffset: number): RawPen => ({
    pen: 'chicken',
    animals: [
      { state: 'full', fedAt: at(fedOffset).toISOString() },
      { state: 'hungry', fedAt: null },
      { state: 'ready', fedAt: at(-999).toISOString() },
      { state: 'full', fedAt: at(fedOffset + 5).toISOString() },
    ],
  });

  it('keeps a freshly fed animal full', () => {
    const r = resolvePen(pen(0), at(sec - 1), 1);
    expect(r.changed).toBe(false);
    expect(r.animals[0].state).toBe('full');
    expect(r.animals[0].readyAt).toBe(at(sec).toISOString());
  });

  it('turns it ready exactly on the boundary', () => {
    const r = resolvePen(pen(0), at(sec), 1);
    expect(r.changed).toBe(true);
    expect(r.animals[0].state).toBe('ready');
    // The one fed five seconds later is still working.
    expect(r.animals[3].state).toBe('full');
  });

  it('leaves hungry and already-ready animals untouched', () => {
    const r = resolvePen(pen(0), at(sec * 5), 1);
    expect(r.animals[1].state).toBe('hungry');
    expect(r.animals[1].readyAt).toBeNull();
    expect(r.animals[2].state).toBe('ready');
  });

  it('never auto-collects — ready animals stay ready', () => {
    const r = resolvePen(pen(0), at(sec * 100), 1);
    expect(r.animals.filter((a) => a.state === 'ready')).toHaveLength(3);
  });

  it('is idempotent through the stored form', () => {
    const once = resolvePen(pen(0), at(sec), 1);
    const twice = resolvePen(penToStored(once), at(sec), 1);
    expect(twice.changed).toBe(false);
    expect(twice.animals.map((a) => a.state)).toEqual(once.animals.map((a) => a.state));
  });

  it('uses each pen its own production time', () => {
    const sheep = PENS.find((p) => p.id === 'sheep')!;
    const fold: RawPen = { pen: 'sheep', animals: [{ state: 'full', fedAt: T0.toISOString() }] };
    expect(resolvePen(fold, at(scaled(sheep.sec) - 0.001), 6).animals[0].state).toBe('full');
    expect(resolvePen(fold, at(scaled(sheep.sec)), 6).animals[0].state).toBe('ready');
  });
});

describe('resolveFarm', () => {
  const input = {
    level: 1,
    tiles: [
      { index: 1, crop: 'wheat', plantedAt: T0 },
      { index: 0, crop: null, plantedAt: null },
    ] as RawTile[],
    machines: [
      { machine: 'mill', jobs: [{ out: 'cfeed', sec: scaled(14), startedAt: T0.toISOString() }], done: {} },
    ] as RawMachine[],
    pens: [
      { pen: 'chicken', animals: [{ state: 'full', fedAt: T0.toISOString() }] },
    ] as RawPen[],
  };

  it('returns tiles in index order and fills in missing machines/pens', () => {
    const r = resolveFarm(input, T0);
    expect(r.tiles.map((t) => t.index)).toEqual([0, 1]);
    // Against config, not a literal: the point is that every machine and pen
    // the game defines gets a row whether or not the farm has one yet. A
    // hardcoded list only asserts how much content existed the day it was
    // written, and fails the next time any is added.
    expect(r.machines.map((m) => m.machine)).toEqual(MACHINES.map((m) => m.id));
    expect(r.pens.map((p) => p.pen)).toEqual(PENS.map((p) => p.id));
    expect(r.dirtyMachines).toEqual([]);
    expect(r.dirtyPens).toEqual([]);
  });

  it('flags exactly the machines and pens that settled', () => {
    const r = resolveFarm(input, at(scaled(60)));
    expect(r.dirtyMachines).toEqual(['mill']);
    expect(r.dirtyPens).toEqual(['chicken']);
    expect(r.machines[0].done).toEqual({ cfeed: 1 });
    expect(r.pens[0].animals[0].state).toBe('ready');
  });

  it('hides machines and pens the player has not reached', () => {
    const r = resolveFarm(input, T0);
    expect(r.machines.find((m) => m.machine === 'sugar')!.open).toBe(false);
    expect(r.pens.find((p) => p.pen === 'sheep')!.open).toBe(false);
  });
});

describe('TIME_SCALE', () => {
  it('scales every duration off one constant', () => {
    expect(scaled(10)).toBe(10 * TIME_SCALE);
  });
});
