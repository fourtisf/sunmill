/** The shapes the API sends. The client renders these — it decides nothing. */

export interface ItemConfig {
  id: string;
  name: string;
  type: 'crop' | 'good';
  sell: number;
  xp: number;
  grow?: number;
  seed?: number;
  yield?: number;
  lvl?: number;
  /** Real seconds after TIME_SCALE — crops only. */
  growSeconds: number | null;
}

export interface RecipeConfig {
  out: string;
  inp: Record<string, number>;
  sec: number;
  lvl: number;
  /** Real seconds after TIME_SCALE. */
  seconds: number;
}

export interface MachineConfig {
  id: string;
  name: string;
  art: string;
  lvl: number;
  x: number;
  y: number;
  slots: number;
  recipes: RecipeConfig[];
}

export interface PenConfig {
  id: string;
  name: string;
  art: string;
  lvl: number;
  feed: string;
  out: string;
  sec: number;
  seconds: number;
  count: number;
  hx: number; hy: number;
  x0: number; y0: number; x1: number; y1: number;
  scale: number;
  roof?: string;
}

export interface GameConfig {
  timeScale: number;
  items: Record<string, ItemConfig>;
  crops: string[];
  machines: MachineConfig[];
  pens: PenConfig[];
  fieldOpen: number[];
  maxTiles: number;
  levelUpText: string[];
  xpCurve: number[];
  expand: {
    silo: { coinsPerCap: number; hay: string; step: number; max: number };
    barn: { coinsPerCap: number; hay: string; step: number; max: number };
  };
  orders: { boardSize: number };
  market: { refreshSeconds: number };
  features: { hayOnChain: boolean; devLogin: boolean };
}

export interface TileView {
  index: number;
  crop: string | null;
  plantedAt: string | null;
  dur: number;
  ready: boolean;
  readyAt: string | null;
  open: boolean;
}

export interface JobView {
  out: string;
  sec: number;
  startedAt: string | null;
  startsAt: string;
  endsAt: string;
}

export interface MachineView {
  machine: string;
  jobs: JobView[];
  done: Record<string, number>;
  slots: number;
  open: boolean;
}

export interface AnimalView {
  state: 'hungry' | 'full' | 'ready';
  fedAt: string | null;
  readyAt: string | null;
}

export interface PenView {
  pen: string;
  animals: AnimalView[];
  open: boolean;
}

export interface OrderView {
  id: string;
  who: string;
  items: Record<string, number>;
  coins: number;
  xp: number;
  hay: string;
  canFill: boolean;
}

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
    inventory: Record<string, number>;
    tiles: TileView[];
    machines: MachineView[];
    pens: PenView[];
  };
  orders: OrderView[];
  levelsGained?: number[];
  notice?: { message: string; icon?: string; bad?: boolean };
}

export interface Listing {
  id: string;
  item: string;
  qty: number;
  price: number;
  who: string;
}

export interface MarketBoard {
  listings: Listing[];
  rolledAt: string;
  refreshSeconds: number;
  serverTime: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
