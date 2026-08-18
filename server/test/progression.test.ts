import { describe, expect, it } from 'vitest';
import { addXp, xpToNext } from '../src/engine/progression';
import { LEVEL_UP_REWARD, xpNeed } from '../src/config/gamedata';

describe('addXp', () => {
  it('accumulates without levelling below the threshold', () => {
    const r = addXp(1, 0, xpNeed(1) - 1);
    expect(r.level).toBe(1);
    expect(r.xp).toBe(xpNeed(1) - 1);
    expect(r.levelsGained).toEqual([]);
    expect(r.coinsGained).toBe(0n);
  });

  it('levels exactly on the threshold and carries the remainder', () => {
    const r = addXp(1, 0, xpNeed(1) + 3);
    expect(r.level).toBe(2);
    expect(r.xp).toBe(3);
    expect(r.levelsGained).toEqual([2]);
    expect(r.coinsGained).toBe(LEVEL_UP_REWARD.coins);
    expect(r.hayGained).toBe('2.00');
  });

  it('handles multiple levels from one reward', () => {
    const gain = xpNeed(1) + xpNeed(2) + xpNeed(3);
    const r = addXp(1, 0, gain);
    expect(r.level).toBe(4);
    expect(r.xp).toBe(0);
    expect(r.levelsGained).toEqual([2, 3, 4]);
    expect(r.coinsGained).toBe(LEVEL_UP_REWARD.coins * 3n);
    expect(r.hayGained).toBe('6.00');
  });

  it('ignores negative gains', () => {
    const r = addXp(3, 10, -50);
    expect(r.level).toBe(3);
    expect(r.xp).toBe(10);
  });

  it('reports the gap to the next level', () => {
    expect(xpToNext(1, 0)).toBe(xpNeed(1));
    expect(xpToNext(1, xpNeed(1))).toBe(0);
  });
});
