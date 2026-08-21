/**
 * Telling a player their farm is ready.
 *
 * The game's whole promise is that the farm runs while you are away, and until
 * now nothing ever said so: a crop ripened, a job finished, a hen laid, and the
 * only way to find out was to remember to look. On the web, with no icon on a
 * home screen and no badge, that is the difference between a player who comes
 * back and one who does not.
 *
 * This does NOT resolve farms on a timer — HANDOFF §4 and CLAUDE.md are clear
 * that game state is resolved lazily, on read, from the server clock, and none
 * of that changes. Every action already resolves the farm it touched, so the
 * action writes down when that farm's soonest timer comes due. The sweep then
 * reads an index and sends; it never loads a tile, never advances a state, and
 * never writes anything a player could see.
 */
import type { ResolvedFarm } from './types';

/** How long after a player's last visit before it is worth pinging them. */
export const NOTIFY_QUIET_SEC = 15 * 60;

/**
 * The soonest moment something on this farm finishes, or null if nothing is
 * running. Anything already ready is not a reason to send — the player has
 * been told about it, or was there when it happened.
 */
export function nextDueAt(farm: ResolvedFarm, now: Date): Date | null {
  let soonest = Infinity;
  const consider = (iso: string | null | undefined) => {
    if (!iso) return;
    const at = Date.parse(iso);
    if (at > now.getTime() && at < soonest) soonest = at;
  };

  for (const tile of farm.tiles) if (tile.crop && !tile.ready) consider(tile.readyAt);
  for (const machine of farm.machines) for (const job of machine.jobs) consider(job.endsAt);
  for (const pen of farm.pens) {
    for (const animal of pen.animals) if (animal.state === 'full') consider(animal.readyAt);
  }

  return soonest === Infinity ? null : new Date(soonest);
}

export interface NotifyText {
  title: string;
  body: string;
}

/**
 * What the notification says. Counts come from the resolved farm, so it can
 * name what is actually waiting rather than saying "something happened".
 */
export function notifyText(farm: ResolvedFarm, now: Date): NotifyText | null {
  const at = now.getTime();
  const crops = farm.tiles.filter((t) => t.crop && (t.ready || (t.readyAt && Date.parse(t.readyAt) <= at))).length;
  const goods = farm.machines.reduce(
    (n, m) => n + Object.values(m.done ?? {}).reduce((a: number, b) => a + (b as number), 0), 0,
  );
  const animals = farm.pens.reduce(
    (n, p) => n + p.animals.filter((a) => a.state === 'ready'
      || (a.state === 'full' && a.readyAt && Date.parse(a.readyAt) <= at)).length, 0,
  );
  if (!crops && !goods && !animals) return null;

  const parts: string[] = [];
  if (crops) parts.push(`${crops} ${crops === 1 ? 'crop' : 'crops'} ready to harvest`);
  if (goods) parts.push(`${goods} ${goods === 1 ? 'good' : 'goods'} to collect`);
  if (animals) parts.push(`${animals} ${animals === 1 ? 'animal' : 'animals'} waiting`);

  return {
    title: 'Your farm is ready',
    // "a, b and c" — a list a person reads, not a log line.
    body: parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`
      : `${parts[0]}.`,
  };
}

/**
 * Is this farm worth pinging right now?
 *
 * Not if the timer has not come due, not twice for the same one, and not while
 * the player is sitting there watching it happen — a notification for the crop
 * someone is looking at is noise, and noise is how permission gets revoked.
 */
export function shouldNotify(
  farm: { notifyAt: Date | null; notifiedAt: Date | null; lastSeenAt: Date },
  now: Date,
  quietSec: number = NOTIFY_QUIET_SEC,
): boolean {
  if (!farm.notifyAt || farm.notifyAt > now) return false;
  if (farm.notifiedAt && farm.notifiedAt >= farm.notifyAt) return false;
  return now.getTime() - farm.lastSeenAt.getTime() >= quietSec * 1000;
}
