import { describe, expect, it } from 'vitest';
import { DAILY, TASK_TEMPLATES, dayKey } from '../src/config/gamedata';
import {
  allTasksClaimed, pickTemplates, streakAfterClaim, streakState, taskComplete, templateFor,
} from '../src/engine/dailyTasks';
import { Prisma } from '@prisma/client';

const T = (iso: string) => new Date(iso);

describe('dayKey', () => {
  it('is the UTC date, so the reset is the same moment for everyone', () => {
    expect(dayKey(T('2026-08-18T00:00:00.000Z'))).toBe('2026-08-18');
    expect(dayKey(T('2026-08-18T23:59:59.999Z'))).toBe('2026-08-18');
    expect(dayKey(T('2026-08-19T00:00:00.000Z'))).toBe('2026-08-19');
  });
});

describe('pickTemplates', () => {
  it('hands out exactly the configured number', () => {
    expect(pickTemplates(10, '2026-08-18', 'farm-a')).toHaveLength(DAILY.taskCount);
  });

  it('is stable for a farm on a day — a refresh cannot reroll into easier tasks', () => {
    const a = pickTemplates(10, '2026-08-18', 'farm-a').map((t) => t.key);
    const b = pickTemplates(10, '2026-08-18', 'farm-a').map((t) => t.key);
    expect(a).toEqual(b);
  });

  it('differs by day and by farm', () => {
    const day1 = pickTemplates(10, '2026-08-18', 'farm-a').map((t) => t.key).join();
    const day2 = pickTemplates(10, '2026-08-19', 'farm-a').map((t) => t.key).join();
    const other = pickTemplates(10, '2026-08-18', 'farm-b').map((t) => t.key).join();
    expect(new Set([day1, day2, other]).size).toBeGreaterThan(1);
  });

  it('never picks the same task twice in a day', () => {
    for (const farm of ['a', 'b', 'c', 'd', 'e']) {
      const keys = pickTemplates(10, '2026-08-18', farm).map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('only offers tasks the player has unlocked', () => {
    for (const t of pickTemplates(1, '2026-08-18', 'farm-a')) expect(t.lvl).toBeLessThanOrEqual(1);
  });

  it('falls back to the whole pool when it is smaller than the daily count', () => {
    const lowLevel = TASK_TEMPLATES.filter((t) => t.lvl <= 1);
    const picked = pickTemplates(1, '2026-08-18', 'farm-a');
    expect(picked.length).toBeLessThanOrEqual(Math.max(DAILY.taskCount, lowLevel.length));
  });

  it('every template has a lookup', () => {
    for (const t of TASK_TEMPLATES) expect(templateFor(t.key)).toEqual(t);
    expect(templateFor('nonsense')).toBeUndefined();
  });
});

const task = (over: Partial<Parameters<typeof taskComplete>[0]> = {}) => ({
  id: 'x', day: '2026-08-18', kind: 'plant', target: 8, progress: 0, claimed: false,
  rewardCoins: 120, rewardHay: new Prisma.Decimal('0.5'), rewardXp: 12, ...over,
});

describe('task completion', () => {
  it('is done at the target, not before', () => {
    expect(taskComplete(task({ progress: 7 }))).toBe(false);
    expect(taskComplete(task({ progress: 8 }))).toBe(true);
    expect(taskComplete(task({ progress: 99 }))).toBe(true);
  });

  it('the all-done bonus needs every task claimed, not just finished', () => {
    expect(allTasksClaimed([task({ claimed: true }), task({ claimed: true })])).toBe(true);
    expect(allTasksClaimed([task({ claimed: true }), task({ progress: 8, claimed: false })])).toBe(false);
    expect(allTasksClaimed([])).toBe(false);
  });
});

describe('login streak', () => {
  const now = T('2026-08-18T09:00:00.000Z');

  it('starts at day 1 for someone who has never claimed', () => {
    const s = streakState(0, null, now, now);
    expect(s.day).toBe(1);
    expect(s.claimedToday).toBe(false);
    expect(s.coins).toBe(DAILY.streakCoins[0]);
  });

  it('advances a day when yesterday was claimed', () => {
    const yesterday = T('2026-08-17T20:00:00.000Z');
    const s = streakState(3, '2026-08-17', yesterday, now);
    expect(s.day).toBe(4);
    expect(s.coins).toBe(DAILY.streakCoins[3]);
  });

  it('reports today as claimed and counts down to the next reset', () => {
    const s = streakState(4, '2026-08-18', now, now);
    expect(s.claimedToday).toBe(true);
    expect(s.day).toBe(4);
    expect(s.nextInSec).toBe(15 * 3600);
  });

  it('survives one missed day and breaks on the second', () => {
    const oneMissed = streakState(5, '2026-08-16', T('2026-08-16T20:00:00.000Z'), now);
    expect(oneMissed.day).toBe(6);

    const twoMissed = streakState(5, '2026-08-14', T('2026-08-14T20:00:00.000Z'), now);
    expect(twoMissed.day).toBe(1);
  });

  it('caps at the end of the reward table rather than running off it', () => {
    const s = streakState(99, '2026-08-17', T('2026-08-17T20:00:00.000Z'), now);
    expect(s.coins).toBe(DAILY.streakCoins[DAILY.streakCoins.length - 1]);
    expect(s.hay).toBe(DAILY.streakHay[DAILY.streakHay.length - 1]);
  });

  it('the state written after a claim locks the day in', () => {
    const s = streakState(3, '2026-08-17', T('2026-08-17T20:00:00.000Z'), now);
    expect(streakAfterClaim(s, now)).toEqual({ streakDays: 4, streakClaimedOn: '2026-08-18' });
  });
});
