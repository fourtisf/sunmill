/**
 * The "while you were away" summary.
 *
 * The satisfying moment in a farm game is opening it after a few hours and
 * being told what happened. The server already knows: readiness is derived
 * from timestamps, so anything whose ready time falls between the player's
 * last visit and now finished while they were gone. Nothing here mutates the
 * farm — it only describes it.
 */
import type { ResolvedFarm } from './types';

export interface AwayReport {
  /** Seconds the player was away. */
  awaySec: number;
  cropsReady: number;
  goodsReady: number;
  animalsReady: number;
  /** Item ids waiting, most plentiful first, for the summary card. */
  waiting: Array<{ item: string; qty: number }>;
}

/** Below this, the player has not really been away — no card is shown. */
export const AWAY_THRESHOLD_SEC = 5 * 60;

export function buildAwayReport(
  resolved: ResolvedFarm, lastSeenAt: Date, now: Date,
): AwayReport | null {
  const awaySec = Math.round((now.getTime() - lastSeenAt.getTime()) / 1000);
  if (awaySec < AWAY_THRESHOLD_SEC) return null;

  const since = lastSeenAt.getTime();
  const waiting = new Map<string, number>();
  const add = (item: string, qty: number) => waiting.set(item, (waiting.get(item) ?? 0) + qty);

  let cropsReady = 0;
  for (const tile of resolved.tiles) {
    if (!tile.crop || !tile.ready || !tile.readyAt) continue;
    // Only count what ripened during the absence, not what was already waiting.
    if (Date.parse(tile.readyAt) < since) continue;
    cropsReady += 1;
    add(tile.crop, 1);
  }

  let goodsReady = 0;
  for (const machine of resolved.machines) {
    for (const [item, qty] of Object.entries(machine.done)) {
      if (qty > 0) { goodsReady += qty; add(item, qty); }
    }
  }

  let animalsReady = 0;
  for (const pen of resolved.pens) {
    for (const animal of pen.animals) {
      if (animal.state !== 'ready') continue;
      if (animal.readyAt && Date.parse(animal.readyAt) < since) continue;
      animalsReady += 1;
    }
  }

  if (!cropsReady && !goodsReady && !animalsReady) return null;

  return {
    awaySec,
    cropsReady,
    goodsReady,
    animalsReady,
    waiting: [...waiting.entries()]
      .map(([item, qty]) => ({ item, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6),
  };
}
