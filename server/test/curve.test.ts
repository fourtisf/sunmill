/**
 * Every level has to give the player something.
 *
 * The game shipped with all of its content unlocked by level 8: levels 5, 9,
 * 10 and 13 handed out literally nothing, and 16, 19 and 20 only widened the
 * field. A player reached the end of the game with 89% of the XP curve still
 * ahead of them, and nothing in the code said so — the curve and the content
 * tables live in different halves of the file and nothing compared them.
 *
 * This compares them. A field is not an unlock: more of the same crop is not a
 * reason to keep playing, and counting it is how three empty levels hid.
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_OPEN, ITEMS, MACHINES, MAX_LEVEL_CURVE, PENS, UPGRADES,
} from '../src/config/gamedata';

/** Everything that opens at exactly this level, named. */
function unlocksAt(level: number): string[] {
  const out: string[] = [];
  for (const item of Object.values(ITEMS)) {
    if (item.type === 'crop' && item.lvl === level) out.push(`crop:${item.id}`);
  }
  for (const m of MACHINES) {
    if (m.lvl === level) out.push(`machine:${m.id}`);
    for (const r of m.recipes) if (r.lvl === level) out.push(`recipe:${r.out}`);
  }
  for (const p of PENS) if (p.lvl === level) out.push(`pen:${p.id}`);
  UPGRADES.machineSlot.levels.forEach((l, i) => { if (l === level) out.push(`slot:${i + 1}`) });
  UPGRADES.penAnimal.levels.forEach((l, i) => { if (l === level) out.push(`animal:${i + 1}`) });
  return out;
}

describe('the level curve', () => {
  it('gives every level something new to do', () => {
    const empty: number[] = [];
    for (let level = 2; level <= MAX_LEVEL_CURVE; level++) {
      if (!unlocksAt(level).length) empty.push(level);
    }
    expect(empty, `levels with nothing in them: ${empty.join(', ')}`).toEqual([]);
  });

  it('runs content all the way to the top of the curve', () => {
    // Not just "no gaps" — the last level must be worth reaching.
    expect(unlocksAt(MAX_LEVEL_CURVE).length).toBeGreaterThan(0);
  });

  it('never gates a recipe on a crop the player cannot grow yet', () => {
    const cropLevel = new Map<string, number>();
    for (const item of Object.values(ITEMS)) {
      if (item.type === 'crop') cropLevel.set(item.id, item.lvl ?? 1);
    }
    for (const m of MACHINES) {
      for (const r of m.recipes) {
        for (const input of Object.keys(r.inp)) {
          const need = cropLevel.get(input);
          if (need == null) continue;   // a good, not a crop; chained elsewhere
          expect(r.lvl, `${m.id}/${r.out} needs ${input}`).toBeGreaterThanOrEqual(need);
        }
        // And the machine itself has to be open before its recipe is.
        expect(r.lvl, `${m.id}/${r.out}`).toBeGreaterThanOrEqual(m.lvl);
      }
    }
  });

  it('keeps the field curve in step with the level curve', () => {
    expect(FIELD_OPEN.length).toBe(MAX_LEVEL_CURVE + 1);
    for (let i = 1; i < FIELD_OPEN.length; i++) {
      expect(FIELD_OPEN[i], `level ${i}`).toBeGreaterThanOrEqual(FIELD_OPEN[i - 1]);
    }
  });
});
