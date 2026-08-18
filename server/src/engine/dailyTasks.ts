/**
 * Daily tasks (three a day) and the login streak.
 *
 * Progress is only ever bumped from inside an action route, in the same
 * transaction as the action itself — a task cannot be advanced by asking for
 * it, only by actually farming. Rewards are read from gamedata at claim time,
 * so a tampered row cannot pay out more than config allows, the same rule the
 * order board follows.
 */
import { Prisma } from '@prisma/client';
import { DAILY, TASK_TEMPLATES, dayKey } from '../config/gamedata';
import type { TaskKind, TaskTemplate } from '../config/gamedata';
import { decimal } from '../lib/money';
import type { Tx } from '../lib/db';

export interface TaskRow {
  id: string;
  day: string;
  kind: string;
  target: number;
  progress: number;
  claimed: boolean;
  rewardCoins: number;
  rewardHay: Prisma.Decimal;
  rewardXp: number;
}

export function templateFor(kind: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.key === kind);
}

/** Pick today's three tasks for a farm at `level`, deterministically per day. */
export function pickTemplates(level: number, day: string, farmId: string): TaskTemplate[] {
  const pool = TASK_TEMPLATES.filter((t) => level >= t.lvl);
  if (pool.length <= DAILY.taskCount) return pool.slice();

  // Seeded by farm + day so a refresh cannot reroll into easier tasks.
  let seed = 0;
  for (const ch of `${farmId}:${day}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const remaining = pool.slice();
  const chosen: TaskTemplate[] = [];
  while (chosen.length < DAILY.taskCount && remaining.length) {
    chosen.push(remaining.splice(Math.floor(rand() * remaining.length), 1)[0]);
  }
  return chosen;
}

/**
 * Make sure today's tasks exist. Yesterday's rows are left alone — they are
 * the record of what was done, and the unique key is (farm, day, kind).
 */
export async function ensureTasks(
  tx: Tx, farmId: string, level: number, now: Date,
): Promise<TaskRow[]> {
  const day = dayKey(now);
  const existing = await tx.dailyTask.findMany({ where: { farmId, day } });
  if (existing.length) return existing;

  const templates = pickTemplates(level, day, farmId);
  await tx.dailyTask.createMany({
    data: templates.map((t) => ({
      farmId,
      day,
      kind: t.key,
      target: t.target,
      rewardCoins: t.coins,
      rewardHay: decimal(t.hay),
      rewardXp: t.xp,
    })),
    skipDuplicates: true,
  });
  return tx.dailyTask.findMany({ where: { farmId, day } });
}

/**
 * Record that the player did something, and advance any matching task.
 * Called from the action routes; a no-op when nothing matches.
 */
export async function progressTask(
  tx: Tx, farmId: string, kind: TaskKind, amount: number, now: Date,
): Promise<void> {
  if (amount <= 0) return;
  const day = dayKey(now);
  const task = await tx.dailyTask.findUnique({
    where: { farmId_day_kind: { farmId, day, kind } },
  });
  if (!task || task.claimed || task.progress >= task.target) return;

  await tx.dailyTask.update({
    where: { id: task.id },
    data: { progress: Math.min(task.target, task.progress + amount) },
  });
}

export function taskComplete(task: TaskRow): boolean {
  return task.progress >= task.target;
}

/** True once every task for the day is claimed — the all-done bonus trigger. */
export function allTasksClaimed(tasks: TaskRow[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.claimed);
}

/* ================= LOGIN STREAK ================= */

export interface StreakState {
  /** Day number, 1-based; caps at the length of the reward table. */
  day: number;
  claimedToday: boolean;
  coins: number;
  hay: string;
  /** Seconds until the next reward can be claimed. */
  nextInSec: number;
}

function streakReward(day: number): { coins: number; hay: string } {
  const i = Math.min(Math.max(day, 1), DAILY.streakCoins.length) - 1;
  return { coins: DAILY.streakCoins[i], hay: DAILY.streakHay[i] };
}

/**
 * What the streak looks like right now. A streak survives one missed day and
 * breaks on the second, so someone who plays most days is not punished for a
 * single gap.
 */
export function streakState(
  streakDays: number, claimedOn: string | null, lastSeenAt: Date, now: Date,
): StreakState {
  const today = dayKey(now);
  const claimedToday = claimedOn === today;

  let day: number;
  if (claimedToday) {
    day = Math.max(1, streakDays);
  } else {
    const graceMs = DAILY.streakGraceHours * 3600 * 1000;
    const lapsed = !claimedOn || now.getTime() - lastSeenAt.getTime() > graceMs;
    day = lapsed ? 1 : Math.max(1, streakDays) + 1;
  }

  const reward = streakReward(day);
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return {
    day,
    claimedToday,
    coins: reward.coins,
    hay: reward.hay,
    nextInSec: claimedToday ? Math.round((tomorrow - now.getTime()) / 1000) : 0,
  };
}

/** The streak state that should be written after a successful claim. */
export function streakAfterClaim(state: StreakState, now: Date) {
  return { streakDays: state.day, streakClaimedOn: dayKey(now) };
}
