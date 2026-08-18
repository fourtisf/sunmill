import { describe, expect, it } from 'vitest';
import { SPEEDUP } from '../src/config/gamedata';
import { speedUpCost } from '../src/routes/speedup';
import { hayToUnits } from '../src/lib/money';

describe('speedUpCost', () => {
  it('scales with the time left', () => {
    const oneMinute = hayToUnits(speedUpCost(60));
    const tenMinutes = hayToUnits(speedUpCost(600));
    expect(tenMinutes).toBeGreaterThan(oneMinute);
    expect(speedUpCost(600)).toBe('1.50');
  });

  it('never charges less than the floor, however little is left', () => {
    for (const sec of [4, 10, 30]) {
      expect(hayToUnits(speedUpCost(sec))).toBeGreaterThanOrEqual(hayToUnits(SPEEDUP.minHay));
    }
  });

  it('always returns two decimal places, so no fraction of a cent is lost', () => {
    for (const sec of [7, 61, 137, 999, 12345]) {
      expect(speedUpCost(sec)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('is monotonic — waiting longer never gets cheaper', () => {
    let previous = 0n;
    for (let sec = 60; sec <= 3600; sec += 60) {
      const cost = hayToUnits(speedUpCost(sec));
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
  });
});
