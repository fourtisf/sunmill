/**
 * The client's mirror of the server snapshot.
 *
 * The prototype's in-memory `S` was the source of truth. Here it is a mirror:
 * every action calls the API and re-renders from the response, and the server
 * response always wins (HANDOFF §8). Nothing in this file decides a price, a
 * duration or a level gate — those all arrive in `config` from /api/config.
 */
import type { GameConfig, ItemConfig, MarketBoard, Snapshot } from './types';

type Listener = () => void;

export const S = {
  config: null as GameConfig | null,
  snap: null as Snapshot | null,
  /** serverTime − client clock, so clock skew never affects a progress bar. */
  serverOffsetMs: 0,
  /** Client-only view state. */
  sel: 'wheat' as string,
  marketTab: 'buy' as 'buy' | 'sell',
  market: null as MarketBoard | null,
  openModal: null as string | null,
  /** True while an action is in flight, to keep double taps from stacking. */
  busy: false,
};

const listeners: Record<string, Listener[]> = {};

export function on(event: 'snapshot' | 'config', fn: Listener): void {
  (listeners[event] ??= []).push(fn);
}

function emit(event: string): void {
  for (const fn of listeners[event] ?? []) fn();
}

/** Server time in ms, corrected for the client's clock. */
export function serverNow(): number {
  return Date.now() + S.serverOffsetMs;
}

export function setConfig(config: GameConfig): void {
  S.config = config;
  emit('config');
}

export function apply(snapshot: Snapshot): Snapshot {
  S.snap = snapshot;
  S.serverOffsetMs = Date.parse(snapshot.serverTime) - Date.now();
  emit('snapshot');
  return snapshot;
}

/* ================= READ HELPERS ================= */

export function cfg(): GameConfig {
  if (!S.config) throw new Error('config not loaded');
  return S.config;
}

export function snap(): Snapshot {
  if (!S.snap) throw new Error('snapshot not loaded');
  return S.snap;
}

export function ready(): boolean {
  return Boolean(S.config && S.snap);
}

export function item(id: string): ItemConfig {
  return cfg().items[id];
}

export function itemName(id: string): string {
  return cfg().items[id]?.name ?? id;
}

export function inv(id: string): number {
  return S.snap?.farm.inventory[id] ?? 0;
}

export function level(): number {
  return S.snap?.farm.level ?? 1;
}

export function coins(): number {
  return Number(S.snap?.farm.coins ?? 0);
}

export function hay(): number {
  return Number(S.snap?.farm.hay ?? 0);
}

export function usedK(kind: 'silo' | 'barn'): number {
  return kind === 'silo' ? (S.snap?.farm.siloUsed ?? 0) : (S.snap?.farm.barnUsed ?? 0);
}

export function capK(kind: 'silo' | 'barn'): number {
  return kind === 'silo' ? (S.snap?.farm.siloCap ?? 0) : (S.snap?.farm.barnCap ?? 0);
}

export function hasAll(need: Record<string, number>): boolean {
  return Object.keys(need).every((k) => inv(k) >= need[k]);
}

export function machineCfg(id: string) {
  return cfg().machines.find((m) => m.id === id);
}

export function penCfg(id: string) {
  return cfg().pens.find((p) => p.id === id);
}

export function machineView(id: string) {
  return S.snap?.farm.machines.find((m) => m.machine === id);
}

export function penView(id: string) {
  return S.snap?.farm.pens.find((p) => p.pen === id);
}

/** Which items the player could sell — mirrors the server's `sellables`. */
export function sellables(): string[] {
  const c = cfg();
  const lvl = level();
  const out: string[] = [];
  for (const id of Object.keys(c.items)) {
    const it = c.items[id];
    if (it.type === 'crop') {
      if (it.lvl != null && lvl < it.lvl) continue;
    } else {
      let reachable = false;
      for (const m of c.machines) {
        if (lvl < m.lvl) continue;
        for (const r of m.recipes) if (r.out === id && lvl >= r.lvl) reachable = true;
      }
      for (const p of c.pens) if (lvl >= p.lvl && p.out === id) reachable = true;
      if (!reachable) continue;
    }
    out.push(id);
  }
  return out;
}

/** 0..1 progress of a timer described by two ISO timestamps. */
export function progress(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!(end > start)) return 1;
  const p = (serverNow() - start) / (end - start);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
