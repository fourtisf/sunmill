/**
 * SUNMILL — game balance. THE single source of truth for every number the
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
};

export const CROPS = ['wheat', 'corn', 'carrot', 'soybean', 'sugarcane'] as const;

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

/** Fields open, indexed by level, capped at index 10. */
export const FIELD_OPEN = [4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 12];
export const MAX_TILES = 12;

export function fieldsOpen(level: number): number {
  return FIELD_OPEN[Math.min(Math.max(level, 0), 10)];
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
  'Master farmer. The whole chain is yours.',
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

/* ================= ORDER BOARD (HANDOFF §2.5) ================= */

export const ORDERS = {
  boardSize: 4,
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
