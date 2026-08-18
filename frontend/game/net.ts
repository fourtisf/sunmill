/**
 * The API client. Every call returns the server's full farm snapshot, which
 * the caller hands to state.apply() — the server response always wins.
 */
import type { ApiError, GameConfig, MarketBoard, OrderView, Snapshot } from './types';

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
};
