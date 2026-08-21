/**
 * The sweep that actually sends.
 *
 * One query for every farm, not one timer per farm: `Farm.notifyAt` was
 * written by whatever action last touched that farm (routes/_context.ts), so
 * finding who is owed a notification is an index scan on a column, not a
 * resolve. Nothing here mutates game state — it reads a resolved farm to
 * decide what the message says and writes only `notifiedAt`.
 *
 * That is the line CLAUDE.md draws: no background worker advances the game.
 * This one advances nothing; a player who never opens the tab has exactly the
 * farm they would have had anyway, they just know about it.
 */
import { prisma } from '../lib/db';
import { pushEnabled, pushToUser } from '../lib/push';
import { env } from '../env';
import { asAnimals, asDone, asJobs } from './farm';
import { resolveFarm } from './resolve';
import { NOTIFY_QUIET_SEC, notifyText, shouldNotify } from './notify';

/** Never send to more than this many farms in one sweep. */
const BATCH = 200;

/**
 * Send to everyone whose soonest timer has come due since the last sweep.
 * Returns how many players were notified — the number the log line carries.
 */
export async function sweepNotifications(now = new Date()): Promise<number> {
  if (!pushEnabled()) return 0;

  const quietBefore = new Date(now.getTime() - NOTIFY_QUIET_SEC * 1000);
  const candidates = await prisma.farm.findMany({
    where: {
      notifyAt: { not: null, lte: now },
      lastSeenAt: { lte: quietBefore },
      user: { push: { some: {} } },
    },
    select: {
      id: true, userId: true, level: true, notifyAt: true, notifiedAt: true, lastSeenAt: true,
      tiles: true, machines: true, pens: true,
    },
    orderBy: { notifyAt: 'asc' },
    take: BATCH,
  });

  let sent = 0;
  for (const farm of candidates) {
    if (!shouldNotify(farm, now)) continue;

    // Same shaping loadFarm does — the columns are JSON and resolveFarm wants
    // them typed. Read-only: nothing below writes a tile, a job or an animal.
    const resolved = resolveFarm({
      level: farm.level,
      tiles: farm.tiles.map((t) => ({ index: t.index, crop: t.crop, plantedAt: t.plantedAt })),
      machines: farm.machines.map((m) => ({
        machine: m.machine, jobs: asJobs(m.jobs), done: asDone(m.done), extraSlots: m.extraSlots,
      })),
      pens: farm.pens.map((p) => ({ pen: p.pen, animals: asAnimals(p.animals) })),
    }, now);
    const text = notifyText(resolved, now);
    // Marked either way. Nothing came due after all — a resolve disagreeing
    // with the stored due time — and retrying it every minute forever is how
    // a quiet bug becomes a loop.
    await prisma.farm.update({
      where: { id: farm.id },
      data: { notifiedAt: now },
    }).catch(() => undefined);
    if (!text) continue;

    const landed = await pushToUser(farm.userId, {
      ...text, url: '/', tag: 'sunmil-ready',
    });
    if (landed) sent += 1;
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;

/** Start sweeping. No-op when push is not configured. */
export function startNotifier(log: { info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void }): void {
  if (timer || !pushEnabled()) return;
  const every = env.NOTIFY_SWEEP_SECONDS * 1000;
  timer = setInterval(() => {
    void sweepNotifications()
      .then((n) => { if (n) log.info({ sent: n }, 'notified farms that came due') })
      .catch((err) => log.warn({ err }, 'notification sweep failed'));
  }, every);
  // Never hold the process open on this alone.
  timer.unref?.();
}

export function stopNotifier(): void {
  if (timer) { clearInterval(timer); timer = null }
}
