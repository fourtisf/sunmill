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

export interface TaskTemplate {
  key: string;
  target: number;
  lvl: number;
  coins: number;
  hay: string;
  xp: number;
}

export interface UpgradeRules {
  maxExtra: number;
  levels: number[];
  coins: number[];
  hay: string[];
}

export interface GameConfig {
  timeScale: number;
  items: Record<string, ItemConfig>;
  crops: string[];
  machines: MachineConfig[];
  pens: PenConfig[];
  fieldOpen: number[];
  maxTiles: number;
  maxLevelCurve: number;
  levelUpText: string[];
  xpCurve: number[];
  speedup: { hayPerMinute: number; minHay: string; minRemainingSec: number };
  upgrades: { machineSlot: UpgradeRules; penAnimal: UpgradeRules };
  tasks: TaskTemplate[];
  daily: {
    taskCount: number;
    allDoneBonus: { coins: number; hay: string; xp: number };
    streakCoins: number[];
    streakHay: string[];
  };
  expand: {
    silo: { coinsPerCap: number; hay: string; step: number; max: number };
    barn: { coinsPerCap: number; hay: string; step: number; max: number };
  };
  orders: { boardSize: number; ttlSeconds: number };
  market: { refreshSeconds: number };
  features: { hayOnChain: boolean; walletLogin: boolean; guestLogin: boolean; push: boolean };
  /** Public half of the VAPID pair; absent when the server cannot send push. */
  vapidPublicKey?: string;
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
  extraSlots: number;
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
  expiresAt: string | null;
}

export interface TaskView {
  kind: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  coins: number;
  hay: string;
  xp: number;
}

export interface StreakView {
  day: number;
  claimedToday: boolean;
  coins: number;
  hay: string;
  nextInSec: number;
}

export interface AwayReport {
  awaySec: number;
  cropsReady: number;
  goodsReady: number;
  animalsReady: number;
  waiting: Array<{ item: string; qty: number }>;
}

export interface SpeedUpQuote {
  serverTime: string;
  tiles: Array<{ index: number; remainingSec: number; hay: string }>;
  machines: Array<{ machine: string; remainingSec: number; hay: string }>;
  pens: Array<{ pen: string; remainingSec: number; hay: string }>;
}

export interface UpgradeQuote {
  bought: number;
  max: number;
  next: { level: number; coins: number; hay: string } | null;
}

export interface UpgradeBoard {
  level: number;
  machineSlots: Array<{ machine: string; slots: number } & UpgradeQuote>;
  penAnimals: Array<{ pen: string; animals: number } & UpgradeQuote>;
}

export interface LeaderboardRow {
  /** Present on other players' rows: what /api/visit takes. */
  id?: string;
  rank: number;
  name: string | null;
  farmName: string | null;
  level: number;
  xp: number;
  you?: boolean;
}

export interface Leaderboard {
  top: LeaderboardRow[];
  you: LeaderboardRow | null;
}

export interface Snapshot {
  serverTime: string;
  timeScale: number;
  player: { name: string | null; farmName: string | null };
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
  tasks: TaskView[];
  streak: StreakView;
  tutorial: { step: number; done: boolean };
  levelsGained?: number[];
  away?: AwayReport;
  notice?: {
    code?: string;
    message: string;
    params?: Record<string, string | number>;
    icon?: string;
    bad?: boolean;
  };
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

/** Somebody else's farm, as a visitor is allowed to see it. */
export interface VisitView {
  serverTime: string;
  host: { id: string; name: string | null; farmName: string | null };
  farm: {
    level: number;
    fieldsOpen: number;
    tiles: Snapshot['farm']['tiles'];
    machines: Snapshot['farm']['machines'];
    pens: Snapshot['farm']['pens'];
  };
}

/** One thing waiting in the mailbox. */
export interface GiftView {
  id: string;
  item: string;
  qty: number;
  note: string | null;
  createdAt: string;
  from: { id: string; name: string | null };
}
