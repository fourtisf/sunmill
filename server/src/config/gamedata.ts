/**
 * SUNMIL — game balance. THE single source of truth for every number the
 * economy depends on (HANDOFF §2). Nothing here may be duplicated in the
 * client, and no route may hardcode a price, duration, yield or recipe.
 *
 * TIME_SCALE multiplies every duration below. The tables hold the prototype's
 * demo-sped values; TIME_SCALE=20 gives the Hay Day cadence HANDOFF §2.1
 * recommends (wheat ~3min, sugarcane ~23min). It is read from the environment
 * so balance can be retuned with a restart instead of a redeploy.
 */

export const TIME_SCALE: number = (() => {
  const raw = process.env.TIME_SCALE;
  if (raw == null || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`TIME_SCALE must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return n;
})();

/** Base seconds → real seconds. Every duration in the game goes through this. */
export function scaled(baseSeconds: number): number {
  return baseSeconds * TIME_SCALE;
}

export type ItemType = 'crop' | 'good';

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  /** Coins paid when sold at the market. */
  sell: number;
  /** XP granted when one unit is produced. */
  xp: number;
  /** Crops only: base grow seconds, seed cost in coins, units per harvest. */
  grow?: number;
  seed?: number;
  yield?: number;
  /** Crops only: the level that unlocks the seed. */
  lvl?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  wheat: { id: 'wheat', name: 'Wheat', type: 'crop', sell: 3, xp: 1, grow: 9, seed: 1, yield: 3, lvl: 1 },
  corn: { id: 'corn', name: 'Corn', type: 'crop', sell: 9, xp: 2, grow: 22, seed: 4, yield: 2, lvl: 1 },
  carrot: { id: 'carrot', name: 'Carrot', type: 'crop', sell: 16, xp: 3, grow: 34, seed: 8, yield: 2, lvl: 2 },
  soybean: { id: 'soybean', name: 'Soybean', type: 'crop', sell: 24, xp: 4, grow: 50, seed: 13, yield: 2, lvl: 4 },
  sugarcane: { id: 'sugarcane', name: 'Sugarcane', type: 'crop', sell: 38, xp: 5, grow: 70, seed: 21, yield: 2, lvl: 6 },
  // Levels 9, 13 and 19 had nothing in them. These continue the curve the five
  // above set: sell roughly x1.5 a step, seed on the same Fibonacci-ish run,
  // grow time and XP one notch on. Profit per second lands within a few
  // percent of sugarcane's, so the new crops are a step up, not a shortcut.
  tomato: { id: 'tomato', name: 'Tomato', type: 'crop', sell: 56, xp: 6, grow: 95, seed: 34, yield: 2, lvl: 9 },
  strawberry: { id: 'strawberry', name: 'Strawberry', type: 'crop', sell: 80, xp: 7, grow: 125, seed: 55, yield: 2, lvl: 13 },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', type: 'crop', sell: 116, xp: 8, grow: 160, seed: 89, yield: 2, lvl: 19 },

  egg: { id: 'egg', name: 'Egg', type: 'good', sell: 14, xp: 3 },
  milk: { id: 'milk', name: 'Milk', type: 'good', sell: 22, xp: 4 },
  wool: { id: 'wool', name: 'Wool', type: 'good', sell: 32, xp: 5 },
  cfeed: { id: 'cfeed', name: 'Chicken Feed', type: 'good', sell: 9, xp: 2 },
  vfeed: { id: 'vfeed', name: 'Cow Feed', type: 'good', sell: 16, xp: 3 },
  sfeed: { id: 'sfeed', name: 'Sheep Feed', type: 'good', sell: 22, xp: 4 },
  bread: { id: 'bread', name: 'Bread', type: 'good', sell: 28, xp: 5 },
  cake: { id: 'cake', name: 'Carrot Cake', type: 'good', sell: 96, xp: 12 },
  cream: { id: 'cream', name: 'Cream', type: 'good', sell: 54, xp: 7 },
  butter: { id: 'butter', name: 'Butter', type: 'good', sell: 78, xp: 9 },
  sugar: { id: 'sugar', name: 'Sugar', type: 'good', sell: 48, xp: 6 },
  syrup: { id: 'syrup', name: 'Syrup', type: 'good', sell: 86, xp: 10 },
  // What the new crops and the Kitchen are for.
  cheese: { id: 'cheese', name: 'Cheese', type: 'good', sell: 84, xp: 11 },
  soup: { id: 'soup', name: 'Garden Soup', type: 'good', sell: 150, xp: 14 },
  jam: { id: 'jam', name: 'Berry Jam', type: 'good', sell: 330, xp: 20 },
  pie: { id: 'pie', name: 'Pumpkin Pie', type: 'good', sell: 380, xp: 26 },
};

export const CROPS = ['wheat', 'corn', 'carrot', 'soybean', 'sugarcane', 'tomato', 'strawberry', 'pumpkin'] as const;

export interface RecipeDef {
  out: string;
  inp: Record<string, number>;
  /** Base seconds — multiply with scaled(). */
  sec: number;
  lvl: number;
}

export interface MachineDef {
  id: string;
  name: string;
  /** Sprite key in the art engine — the client renders from this. */
  art: string;
  lvl: number;
  /** Iso world position, kept so the client renders identically. */
  x: number;
  y: number;
  slots: number;
  recipes: RecipeDef[];
}

export const MACHINES: MachineDef[] = [
  {
    id: 'mill', name: 'Feed Mill', art: 'mill', lvl: 1, x: 2.4, y: 6.7, slots: 3,
    recipes: [
      { out: 'cfeed', inp: { wheat: 2, corn: 1 }, sec: 14, lvl: 1 },
      { out: 'vfeed', inp: { corn: 2, soybean: 1 }, sec: 26, lvl: 4 },
      { out: 'sfeed', inp: { soybean: 2, wheat: 3 }, sec: 34, lvl: 6 },
    ],
  },
  {
    id: 'bakery', name: 'Bakery', art: 'bakery', lvl: 2, x: 4.0, y: 6.9, slots: 3,
    recipes: [
      { out: 'bread', inp: { wheat: 3 }, sec: 22, lvl: 2 },
      { out: 'cake', inp: { carrot: 2, egg: 2, sugar: 1 }, sec: 55, lvl: 7 },
    ],
  },
  {
    id: 'dairy', name: 'Dairy', art: 'dairy', lvl: 3, x: 2.2, y: 8.6, slots: 3,
    recipes: [
      { out: 'cream', inp: { milk: 2 }, sec: 28, lvl: 3 },
      { out: 'cheese', inp: { milk: 3 }, sec: 40, lvl: 5 },
      { out: 'butter', inp: { milk: 3, sugar: 1 }, sec: 45, lvl: 6 },
    ],
  },
  {
    id: 'sugar', name: 'Sugar Mill', art: 'sugarmill', lvl: 6, x: 4.0, y: 8.9, slots: 3,
    recipes: [
      { out: 'sugar', inp: { sugarcane: 2 }, sec: 30, lvl: 6 },
      { out: 'syrup', inp: { sugarcane: 3, milk: 1 }, sec: 50, lvl: 8 },
    ],
  },
  {
    // The fifth workshop, and the one that gives levels 10 to 20 something to
    // open. It sits below the Sugar Mill, keeping the yard's block of
    // workshops together, clear of the pond at (2.3, 10.9) and of the cow
    // pasture, which starts at x 5.4.
    id: 'kitchen', name: 'Kitchen', art: 'kitchen', lvl: 10, x: 4.0, y: 10.9, slots: 3,
    recipes: [
      { out: 'soup', inp: { tomato: 2, carrot: 1 }, sec: 60, lvl: 10 },
      { out: 'jam', inp: { strawberry: 3, sugar: 1 }, sec: 80, lvl: 16 },
      { out: 'pie', inp: { pumpkin: 2, butter: 1, egg: 1 }, sec: 100, lvl: 20 },
    ],
  },
];

export interface PenDef {
  id: string;
  name: string;
  art: string;
  lvl: number;
  feed: string;
  out: string;
  /** Base seconds — multiply with scaled(). */
  sec: number;
  count: number;
  /** Iso layout, mirrored to the client so the pens render identically. */
  hx: number; hy: number;
  x0: number; y0: number; x1: number; y1: number;
  scale: number;
  roof?: string;
}

export const PENS: PenDef[] = [
  {
    id: 'chicken', name: 'Chicken Coop', art: 'coop', lvl: 1, feed: 'cfeed', out: 'egg', sec: 30, count: 4,
    hx: 6.5, hy: 7.0, x0: 5.5, y0: 6.1, x1: 8.3, y1: 8.2, scale: 0.92,
  },
  {
    id: 'cow', name: 'Cow Pasture', art: 'shelter', lvl: 3, feed: 'vfeed', out: 'milk', sec: 48, count: 3,
    hx: 6.4, hy: 9.4, x0: 5.4, y0: 8.5, x1: 9.0, y1: 11.2, scale: 0.9, roof: '#C4402E',
  },
  {
    id: 'sheep', name: 'Sheep Fold', art: 'shelter', lvl: 6, feed: 'sfeed', out: 'wool', sec: 70, count: 3,
    hx: 9.8, hy: 9.6, x0: 9.2, y0: 8.6, x1: 11.6, y1: 11.0, scale: 0.95, roof: '#3A8FC4',
  },
];

/* ================= PROGRESSION (HANDOFF §2.4) ================= */

export const START = {
  coins: 640n,
  hay: '8',
  siloCap: 60,
  barnCap: 60,
  level: 1,
  xp: 0,
  /** Starter inventory, matching the prototype. */
  inventory: { wheat: 12, corn: 6, cfeed: 2 } as Record<string, number>,
};

/** XP required to go from `lvl` to `lvl + 1`. */
export function xpNeed(lvl: number): number {
  return Math.round(18 + lvl * 20 + lvl * lvl * 3);
}

/** Demo values — revisit for the real economy (HANDOFF §7). */
export const LEVEL_UP_REWARD = { coins: 60n, hay: '2' };

/**
 * Fields open, indexed by level. The prototype stopped at 12 fields and level
 * 10, which is where the game ran out of things to give; the curve now runs to
 * level 20 and 24 fields.
 *
 * Levels 11+ deliberately unlock capacity rather than new crops or goods: the
 * art engine is fixed (CLAUDE.md rule 2), so every item that exists has a
 * sprite and any new one would not. Late progression therefore comes from
 * scale — more fields, more machine slots, more animals — which the existing
 * sprites already draw.
 */
export const FIELD_OPEN = [
  4, 4, 6, 6, 8, 8, 10, 10, 12, 12,
  12, 14, 14, 16, 16, 18, 20, 20, 22, 24, 24,
];
export const MAX_TILES = 24;
export const MAX_LEVEL_CURVE = FIELD_OPEN.length - 1;

export function fieldsOpen(level: number): number {
  return FIELD_OPEN[Math.min(Math.max(level, 0), MAX_LEVEL_CURVE)];
}

export const LEVEL_UP_TEXT = [
  '',
  'Two fields open up. Plant wheat and corn.',
  'Bakery unlocked. Carrot seeds in the tray.',
  'Cow pasture unlocked, and the Dairy opens.',
  'Soybean seeds unlocked. Cow feed too.',
  'Two more fields. Space to breathe.',
  'Sugarcane, Sugar Mill and the Sheep Fold.',
  'Carrot Cake recipe unlocked at the Bakery.',
  'Syrup unlocked. Your best-selling good yet.',
  'Two more fields. Scale it up.',
  'The whole chain is yours. Now make it bigger.',
  'Two more fields, and the machines can take another slot.',
  'The pens have room for another animal.',
  'Two more fields. The yard is filling up.',
  'Another machine slot. Keep the line moving.',
  'Two more fields, and another animal in each pen.',
  'Four more fields. A proper estate.',
  'The last machine slot. Three jobs deep is nothing now.',
  'Two more fields, and the last animal each pen will hold.',
  'Two more fields. Twenty-four in all.',
  'Master farmer. Nothing on this island is beyond you.',
];

export const NEIGHBOUR_NAMES = [
  'Rina', 'Tobias', 'Mei', 'Otto', 'Sanne', 'Kofi', 'Yuki', 'Bram',
  'Nadia', 'Pia', 'Ravi', 'Elsi', 'Marco', 'Dewi', 'Hank', 'Lucia',
];

/* ================= EXPANSION (HANDOFF §1.8) ================= */

export const EXPAND = {
  silo: { coinsPerCap: 8, hay: '1', step: 20, max: 500 },
  barn: { coinsPerCap: 10, hay: '1', step: 20, max: 500 },
};

/* ================= SPEED-UP: THE $HAY SINK ================= */

/**
 * Pay $HAY to finish a timer now.
 *
 * Before this existed, orders and level-ups granted hay and only two
 * expansions ever consumed any, so the balance had nowhere to go — emission
 * with no demand behind it. This is the genre's standard sink and the main
 * one here: it scales with how much time is left, so it drains more the more
 * impatient the player is.
 *
 * The rate is a placeholder pending an economy pass. It sits here as one
 * number so it can be retuned without touching a route.
 */
export const SPEEDUP = {
  /** $HAY charged per remaining minute, before rounding. */
  hayPerMinute: 0.15,
  /** Nobody pays less than this, however little time is left. */
  minHay: '0.10',
  /** Below this many seconds remaining, just wait — the server refuses. */
  minRemainingSec: 3,
};

/* ================= CAPACITY UPGRADES (late game) ================= */

/**
 * Extra machine slots and extra animals. Both cost coins AND $HAY, so the
 * late game keeps draining the token rather than accumulating it.
 */
export const UPGRADES = {
  machineSlot: {
    /** Extra slots beyond a machine's base 3. */
    maxExtra: 3,
    /** Level required for the 1st, 2nd and 3rd extra slot. */
    levels: [11, 14, 17],
    /** Coin cost of the nth extra slot (0-indexed). */
    coins: [4_000, 12_000, 30_000],
    hay: ['4', '10', '22'],
  },
  penAnimal: {
    /** Extra animals beyond a pen's base count. */
    maxExtra: 3,
    levels: [12, 15, 18],
    coins: [3_000, 9_000, 24_000],
    hay: ['3', '8', '18'],
  },
};

/* ================= DAILY TASKS + STREAK ================= */

export type TaskKind =
  | 'plant' | 'harvest' | 'craft' | 'collect_machine'
  | 'feed' | 'collect_pen' | 'deliver' | 'sell';

export interface TaskTemplate {
  key: TaskKind;
  /** How many times the action must happen. */
  target: number;
  /** Minimum farm level before this task can be handed out. */
  lvl: number;
  coins: number;
  hay: string;
  xp: number;
}

/**
 * Three tasks a day, drawn from these. Each one is something the player was
 * going to do anyway — the point is to give the day a shape and a reason to
 * come back, not to invent busywork.
 */
export const TASK_TEMPLATES: TaskTemplate[] = [
  { key: 'plant', target: 8, lvl: 1, coins: 120, hay: '0.50', xp: 12 },
  { key: 'harvest', target: 6, lvl: 1, coins: 150, hay: '0.50', xp: 15 },
  { key: 'craft', target: 3, lvl: 1, coins: 180, hay: '0.75', xp: 18 },
  { key: 'collect_machine', target: 3, lvl: 1, coins: 160, hay: '0.60', xp: 16 },
  { key: 'feed', target: 4, lvl: 1, coins: 140, hay: '0.50', xp: 14 },
  { key: 'collect_pen', target: 4, lvl: 1, coins: 170, hay: '0.60', xp: 17 },
  { key: 'deliver', target: 2, lvl: 2, coins: 260, hay: '1.00', xp: 26 },
  { key: 'sell', target: 10, lvl: 2, coins: 130, hay: '0.40', xp: 10 },
];

export const DAILY = {
  /** Tasks handed out per day. */
  taskCount: 3,
  /** Bonus for finishing all of them. */
  allDoneBonus: { coins: 400, hay: '2.00', xp: 40 },
  /**
   * Login streak. Day 1 pays the first entry, day 7 and beyond the last —
   * a reason to open the game tomorrow rather than in a week.
   */
  streakCoins: [100, 150, 220, 300, 420, 560, 800],
  streakHay: ['0.50', '0.75', '1.00', '1.50', '2.00', '2.50', '4.00'],
  /** A streak survives one missed day; two breaks it back to day 1. */
  streakGraceHours: 48,
};

/** UTC day key, which is what the daily reset runs on. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/* ================= ORDER BOARD (HANDOFF §2.5) ================= */

export const ORDERS = {
  boardSize: 4,
  /**
   * Base seconds an order stays on the board. Without this the truck was a
   * static list with no reason to act on anything today.
   */
  ttlSec: 3600,
  /** Base seconds between auto-refills of an under-full board. */
  refillSec: 8,
  maxDistinctItems: 3,
  /** Items cheaper than this get the "cheap" quantity band. */
  cheapUnder: 12,
  cheapQty: { min: 2, max: 5 },
  pricyQty: { min: 1, max: 2 },
  coinMultiplier: 1.5,
  coinBonus: 4,
  xpBonus: 2,
  /** hay = round(coins / hayDivisor * 100) / 100, coins pre-bonus. */
  hayDivisor: 220,
  minSellPrice: 3,
};

/* ================= MARKET (HANDOFF §2.6) ================= */

export const MARKET = {
  listings: 6,
  /** Base seconds between per-user market refreshes. */
  refreshSec: 75,
  priceMin: 1.2,
  priceMax: 1.7,
  cheapUnder: 12,
  cheapQty: { min: 1, max: 8 },
  pricyQty: { min: 1, max: 4 },
  /** Fraction of an item's XP granted per unit sold. */
  sellXpFactor: 0.3,
};

/* ================= DERIVED HELPERS ================= */

export function itemDef(id: string): ItemDef | undefined {
  return Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : undefined;
}

export function requireItem(id: string): ItemDef {
  const it = itemDef(id);
  if (!it) throw new Error(`unknown item: ${id}`);
  return it;
}

export function isCrop(id: string): boolean {
  return requireItem(id).type === 'crop';
}

/** Which store an item counts against: crops → silo, goods → barn. */
export function storeOf(id: string): 'silo' | 'barn' {
  return isCrop(id) ? 'silo' : 'barn';
}

export function machineDef(id: string): MachineDef | undefined {
  return MACHINES.find((m) => m.id === id);
}

export function penDef(id: string): PenDef | undefined {
  return PENS.find((p) => p.id === id);
}

export function recipeDef(machine: MachineDef, out: string): RecipeDef | undefined {
  return machine.recipes.find((r) => r.out === out);
}

/** Grow seconds for a crop, after TIME_SCALE. */
export function growSeconds(cropId: string): number {
  const it = requireItem(cropId);
  if (it.type !== 'crop' || it.grow == null) throw new Error(`${cropId} is not a crop`);
  return scaled(it.grow);
}

/**
 * Items the player is allowed to see in orders / market listings at `level`:
 * crops they can plant, and goods they have some way to produce.
 * Mirrors the prototype's `sellables()`.
 */
export function sellables(level: number): string[] {
  const out: string[] = [];
  for (const id of Object.keys(ITEMS)) {
    const it = ITEMS[id];
    if (it.type === 'crop') {
      if (it.lvl != null && level < it.lvl) continue;
    } else {
      let reachable = false;
      for (const m of MACHINES) {
        if (level < m.lvl) continue;
        for (const r of m.recipes) if (r.out === id && level >= r.lvl) reachable = true;
      }
      for (const p of PENS) if (level >= p.lvl && p.out === id) reachable = true;
      if (!reachable) continue;
    }
    out.push(id);
  }
  return out;
}

/** A crop seed is plantable once the player reaches its unlock level. */
export function cropUnlocked(cropId: string, level: number): boolean {
  const it = itemDef(cropId);
  if (!it || it.type !== 'crop') return false;
  return it.lvl == null || level >= it.lvl;
}
