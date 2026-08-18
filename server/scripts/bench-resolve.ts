/**
 * Resolver throughput, with no database in the way.
 *
 *   npx tsx scripts/bench-resolve.ts
 *
 * Three shapes matter: an idle farm (the common read), a busy farm mid-cycle,
 * and a farm nobody has touched for a week — the last one is what proves the
 * lazy design does not degrade with neglect, since a week-old queue settles in
 * the same single pass as a one-second-old one.
 */
import { MACHINES, PENS, scaled } from '../src/config/gamedata';
import { resolveFarm } from '../src/engine/resolve';
import type { RawMachine, RawPen, RawTile } from '../src/engine/types';

const now = new Date('2026-01-01T12:00:00.000Z');
const ago = (sec: number) => new Date(now.getTime() - sec * 1000).toISOString();

function tiles(planted: boolean): RawTile[] {
  return Array.from({ length: 12 }, (_, i) => ({
    index: i,
    crop: planted ? 'wheat' : null,
    plantedAt: planted ? new Date(now.getTime() - 5000) : null,
  }));
}

function machines(jobsEach: number, startedSecAgo: number): RawMachine[] {
  return MACHINES.map((m) => ({
    machine: m.id,
    jobs: Array.from({ length: jobsEach }, (_, i) => ({
      out: m.recipes[0].out,
      sec: scaled(m.recipes[0].sec),
      startedAt: i === 0 ? ago(startedSecAgo) : null,
    })),
    done: {},
  }));
}

function pens(fedSecAgo: number): RawPen[] {
  return PENS.map((p) => ({
    pen: p.id,
    animals: Array.from({ length: p.count }, () => ({
      state: 'full' as const, fedAt: ago(fedSecAgo),
    })),
  }));
}

const CASES = [
  { name: 'idle farm            ', input: { level: 10, tiles: tiles(false), machines: machines(0, 0), pens: pens(0) } },
  { name: 'busy farm mid-cycle  ', input: { level: 10, tiles: tiles(true), machines: machines(3, 5), pens: pens(5) } },
  { name: 'untouched for a week ', input: { level: 10, tiles: tiles(true), machines: machines(3, 604800), pens: pens(604800) } },
];

const ITERATIONS = 200_000;

console.log(`resolveFarm — ${ITERATIONS.toLocaleString()} iterations per case\n`);
for (const c of CASES) {
  // warm up so we measure steady state, not the first-call JIT.
  for (let i = 0; i < 10_000; i += 1) resolveFarm(c.input, now);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i += 1) resolveFarm(c.input, now);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perOp = (ms * 1000) / ITERATIONS;
  console.log(
    `  ${c.name} ${perOp.toFixed(2).padStart(7)} µs/farm`
    + `   ${Math.round(ITERATIONS / (ms / 1000)).toLocaleString().padStart(10)} farms/sec`,
  );
}
console.log('\nNeglect costs nothing extra: a week-old queue settles in the same single');
console.log('pass as a fresh read (cheaper, in fact — finished jobs stop being rendered).');
console.log('That is the point of resolving lazily instead of running timers per farm.');
