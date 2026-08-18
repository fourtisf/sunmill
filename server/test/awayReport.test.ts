import { describe, expect, it } from 'vitest';
import { AWAY_THRESHOLD_SEC, buildAwayReport } from '../src/engine/awayReport';
import type { ResolvedFarm } from '../src/engine/types';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

function farm(over: Partial<ResolvedFarm> = {}): ResolvedFarm {
  return {
    tiles: [], machines: [], pens: [], dirtyMachines: [], dirtyPens: [], ...over,
  };
}

const tile = (ready: boolean, readyAtSecAgo: number) => ({
  index: 0, crop: 'wheat', plantedAt: ago(9999).toISOString(),
  dur: 9, ready, readyAt: ago(readyAtSecAgo).toISOString(), open: true,
});

describe('buildAwayReport', () => {
  it('says nothing when the player was barely gone', () => {
    const report = buildAwayReport(
      farm({ tiles: [tile(true, 10)] }), ago(AWAY_THRESHOLD_SEC - 1), NOW,
    );
    expect(report).toBeNull();
  });

  it('says nothing when nothing finished', () => {
    expect(buildAwayReport(farm(), ago(3600), NOW)).toBeNull();
  });

  it('counts crops that ripened during the absence', () => {
    const report = buildAwayReport(farm({ tiles: [tile(true, 600), tile(true, 300)] }), ago(3600), NOW);
    expect(report?.cropsReady).toBe(2);
    expect(report?.awaySec).toBe(3600);
    expect(report?.waiting).toEqual([{ item: 'wheat', qty: 2 }]);
  });

  it('ignores crops that were already waiting before they left', () => {
    // Ripened two hours ago; the player left one hour ago.
    const report = buildAwayReport(farm({ tiles: [tile(true, 7200)] }), ago(3600), NOW);
    expect(report).toBeNull();
  });

  it('counts finished goods and ready animals', () => {
    const report = buildAwayReport(farm({
      machines: [{ machine: 'mill', jobs: [], done: { cfeed: 3 }, slots: 3, extraSlots: 0, open: true }],
      pens: [{
        pen: 'chicken',
        animals: [
          { state: 'ready', fedAt: ago(900).toISOString(), readyAt: ago(600).toISOString() },
          { state: 'full', fedAt: ago(60).toISOString(), readyAt: null },
        ],
        open: true,
      }],
    }), ago(3600), NOW);

    expect(report?.goodsReady).toBe(3);
    expect(report?.animalsReady).toBe(1);
    expect(report?.waiting).toEqual([{ item: 'cfeed', qty: 3 }]);
  });

  it('lists the most plentiful item first and keeps the list short', () => {
    const done: Record<string, number> = {};
    for (let i = 0; i < 9; i += 1) done[`item${i}`] = i + 1;
    const report = buildAwayReport(farm({
      machines: [{ machine: 'mill', jobs: [], done, slots: 3, extraSlots: 0, open: true }],
    }), ago(7200), NOW);

    expect(report?.waiting).toHaveLength(6);
    expect(report?.waiting[0]).toEqual({ item: 'item8', qty: 9 });
  });
});
