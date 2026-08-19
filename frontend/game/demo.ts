/**
 * The scene behind the login card.
 *
 * The landing page is the farm itself, but nobody is logged in yet, so there
 * is no snapshot and the renderer would draw bare grass — the trees, barn,
 * silo, animals and crops all live in drawEntities, which needs one.
 *
 * This builds a snapshot-shaped object purely to look at. It is decoration and
 * nothing else: it is only ever installed while the pre-game chrome is hidden,
 * every route that could spend or earn anything requires a session the visitor
 * does not have, and the first real `apply()` overwrites it. S.demo marks it so
 * the idle sync knows not to treat it as a farm worth refreshing.
 */
import type { GameConfig, Snapshot } from './types';

/** A fixed spread of growth stages, so the fields are not all one colour. */
const PLOTS: Array<[string, number]> = [
  ['wheat', 0.95], ['wheat', 0.55], ['corn', 0.30], ['carrot', 1],
  ['wheat', 1], ['soy', 0.72], ['carrot', 0.44], ['wheat', 0.18],
  ['corn', 0.88], ['wheat', 1], ['soy', 0.35], ['carrot', 0.62],
];

export function demoSnapshot(config: GameConfig): Snapshot {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const tiles = Array.from({ length: config.maxTiles }, (_, index) => {
    const plot = PLOTS[index];
    if (!index || !plot || index >= 12) {
      return { index, crop: null, plantedAt: null, dur: 0, ready: false, readyAt: null, open: index < 12 };
    }
    const [crop, grown] = plot;
    const dur = config.items[crop]?.growSeconds ?? 60;
    const started = now - dur * 1000 * grown;
    return {
      index, crop, plantedAt: iso(started), dur,
      ready: grown >= 1, readyAt: iso(started + dur * 1000), open: true,
    };
  });

  const machines = config.machines.map((def, i) => ({
    machine: def.id,
    jobs: i === 0
      ? [{ out: def.recipes[0].out, sec: def.recipes[0].sec, startedAt: iso(now - def.recipes[0].sec * 400),
           startsAt: iso(now - def.recipes[0].sec * 400), endsAt: iso(now + def.recipes[0].sec * 600) }]
      : [],
    done: {}, slots: def.slots, extraSlots: 0, open: i < 2,
  }));

  const pens = config.pens.map((def, i) => ({
    pen: def.id,
    animals: Array.from({ length: def.count }, (_, a) => ({
      state: (a % 3 === 0 ? 'ready' : 'full') as 'ready' | 'full',
      fedAt: iso(now - 60_000), readyAt: iso(now + 60_000),
    })),
    open: i === 0,
  }));

  return {
    serverTime: iso(now),
    timeScale: config.timeScale,
    player: { name: null, farmName: null },
    farm: {
      id: 'demo', coins: '0', hay: '0.00', xp: 0, level: 6, xpNext: 100,
      siloCap: 60, barnCap: 40, siloUsed: 0, barnUsed: 0, fieldsOpen: 12,
      inventory: {}, tiles, machines, pens,
    },
    orders: [], tasks: [],
    streak: { day: 0, claimedToday: true, coins: 0, hay: '0.00' },
    tutorial: { step: 0, done: true },
    away: null,
    notice: null,
  } as unknown as Snapshot;
}
