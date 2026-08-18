/**
 * The API client. Every call returns the server's full farm snapshot, which
 * the caller hands to state.apply() — the server response always wins.
 */
import type {
  ApiError, GameConfig, Leaderboard, MarketBoard, OrderView, Snapshot,
  SpeedUpQuote, UpgradeBoard,
} from './types';

const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class NetError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, payload: ApiError) {
    super(payload.message || 'Something went wrong');
    this.name = 'NetError';
    this.status = status;
    this.code = payload.error || 'server_error';
    this.details = payload.details;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: 'server_error', message: text }; }
  }

  if (!res.ok) throw new NetError(res.status, (payload ?? {}) as ApiError);
  return payload as T;
}

export const api = {
  config: () => request<GameConfig>('GET', '/api/config'),
  me: () => request<{ authenticated: boolean }>('GET', '/api/auth/me'),

  invite: () => request<{ required: boolean; ok: boolean }>('GET', '/api/invite'),
  redeemInvite: (code: string) =>
    request<{ ok: true; required: boolean }>('POST', '/api/invite', { code }),

  nonce: (address: string) =>
    request<{ nonce: string; message: string }>('POST', '/api/auth/nonce', { address }),
  loginWallet: (address: string, signature: string) =>
    request<{ ok: true }>('POST', '/api/auth/wallet', { address, signature }),
  loginDev: (handle: string) => request<{ ok: true }>('POST', '/api/auth/dev', { handle }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  farm: () => request<Snapshot>('GET', '/api/farm'),
  plant: (tiles: number[], crop: string) => request<Snapshot>('POST', '/api/plant', { tiles, crop }),
  harvest: (tile: number) => request<Snapshot>('POST', '/api/harvest', { tile }),

  queueJob: (machine: string, recipeOut: string) =>
    request<Snapshot>('POST', '/api/machine/queue', { machine, recipeOut }),
  collectMachine: (machine: string) =>
    request<Snapshot>('POST', '/api/machine/collect', { machine }),

  feedPen: (pen: string, index?: number) =>
    request<Snapshot>('POST', '/api/pen/feed', index == null ? { pen } : { pen, index }),
  collectPen: (pen: string, index?: number) =>
    request<Snapshot>('POST', '/api/pen/collect', index == null ? { pen } : { pen, index }),

  orders: () => request<{ orders: OrderView[]; serverTime: string; cached: boolean }>('GET', '/api/orders'),
  deliverOrder: (orderId: string) => request<Snapshot>('POST', '/api/orders/deliver', { orderId }),
  skipOrder: (orderId: string) => request<Snapshot>('POST', '/api/orders/skip', { orderId }),

  market: () => request<MarketBoard>('GET', '/api/market'),
  buy: (listingId: string) => request<Snapshot>('POST', '/api/market/buy', { listingId }),
  sell: (item: string, qty: number) => request<Snapshot>('POST', '/api/market/sell', { item, qty }),

  expand: (target: 'silo' | 'barn') => request<Snapshot>('POST', '/api/expand', { target }),

  /* the $HAY sink */
  speedUpQuote: () => request<SpeedUpQuote>('GET', '/api/speedup/quote'),
  speedUpTile: (index: number) => request<Snapshot>('POST', '/api/speedup', { target: 'tile', index }),
  speedUpMachine: (machine: string) => request<Snapshot>('POST', '/api/speedup', { target: 'machine', machine }),
  speedUpPen: (pen: string) => request<Snapshot>('POST', '/api/speedup', { target: 'pen', pen }),

  /* late-game capacity */
  upgrades: () => request<UpgradeBoard>('GET', '/api/upgrade'),
  buyMachineSlot: (machine: string) =>
    request<Snapshot>('POST', '/api/upgrade', { target: 'machineSlot', machine }),
  buyPenAnimal: (pen: string) => request<Snapshot>('POST', '/api/upgrade', { target: 'penAnimal', pen }),

  /* daily loop */
  claimTask: (kind: string) => request<Snapshot>('POST', '/api/tasks/claim', { kind }),
  claimStreak: () => request<Snapshot>('POST', '/api/daily/claim', {}),

  /* identity */
  setProfile: (body: { name?: string; farmName?: string }) =>
    request<Snapshot>('POST', '/api/profile', body),
  leaderboard: () => request<Leaderboard>('GET', '/api/leaderboard'),
  setTutorial: (body: { step?: number; done?: boolean }) =>
    request<Snapshot>('POST', '/api/tutorial', body),
};
