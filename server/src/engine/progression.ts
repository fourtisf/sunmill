/**
 * XP and levelling. Pure — no DB, no clock.
 * Mirrors the prototype's addXP(): repeatedly spend the level threshold while
 * the player has enough XP, so a single big reward can grant several levels.
 */
import { LEVEL_UP_REWARD, xpNeed } from '../config/gamedata';

export interface XpResult {
  level: number;
  xp: number;
  /** Every level reached, in order — the client plays one card per entry. */
  levelsGained: number[];
  /** Level-up bonuses to credit alongside the action's own rewards. */
  coinsGained: bigint;
  hayGained: string;
}

const MAX_LEVEL_STEPS = 100; // guard against a pathological reward loop

export function addXp(level: number, xp: number, gained: number): XpResult {
  let lvl = level;
  let cur = xp + Math.max(0, Math.round(gained));
  const levelsGained: number[] = [];
  let coins = 0n;
  let hayHundredths = 0;

  const hayPerLevel = Math.round(Number(LEVEL_UP_REWARD.hay) * 100);

  while (cur >= xpNeed(lvl) && levelsGained.length < MAX_LEVEL_STEPS) {
    cur -= xpNeed(lvl);
    lvl += 1;
    levelsGained.push(lvl);
    coins += LEVEL_UP_REWARD.coins;
    hayHundredths += hayPerLevel;
  }

  return {
    level: lvl,
    xp: cur,
    levelsGained,
    coinsGained: coins,
    hayGained: (hayHundredths / 100).toFixed(2),
  };
}

/** XP still needed to reach the next level. */
export function xpToNext(level: number, xp: number): number {
  return Math.max(0, xpNeed(level) - xp);
}
