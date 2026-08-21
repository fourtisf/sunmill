/**
 * When the farm is allowed to interrupt someone.
 *
 * A notification that arrives while the player is looking at the crop it is
 * about, or twice for the same crop, is how permission gets revoked — and a
 * browser only asks once. These are the rules that stop that, so they are
 * worth pinning.
 */
import { describe, expect, it } from 'vitest';
import { NOTIFY_QUIET_SEC, nextDueAt, notifyText, shouldNotify } from '../src/engine/notify';
import type { ResolvedFarm } from '../src/engine/types';

const T0 = new Date('2026-08-21T12:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const iso = (sec: number) => at(sec).toISOString();

/** A farm with nothing on it, to add exactly one thing to. */
function farm(over: Partial<ResolvedFarm> = {}): ResolvedFarm {
  return {
    tiles: [], machines: [], pens: [],
    ...over,
  } as ResolvedFarm;
}

const tile = (o: object) => ({ index: 0, crop: 'wheat', dur: 60, open: true, plantedAt: iso(0), ...o });
const machine = (o: object) => ({ machine: 'mill', jobs: [], done: {}, open: true, slots: 3, ...o });
const pen = (o: object) => ({ pen: 'chicken', animals: [], open: true, ...o });

describe('nextDueAt', () => {
  it('finds the soonest thing still running', () => {
    const f = farm({
      tiles: [tile({ ready: false, readyAt: iso(300) })],
      machines: [machine({ jobs: [{ out: 'cfeed', endsAt: iso(120), startedAt: iso(0), dur: 120 }] })],
      pens: [pen({ animals: [{ state: 'full', fedAt: iso(0), readyAt: iso(600) }] })],
    });
    expect(nextDueAt(f, T0)?.toISOString()).toBe(iso(120));
  });

  it('ignores what has already finished', () => {
    // Ready things are not a reason to send: the player was either there when
    // it happened or has already been told.
    const f = farm({
      tiles: [tile({ ready: true, readyAt: iso(-60) })],
      pens: [pen({ animals: [{ state: 'ready', fedAt: iso(-600), readyAt: iso(-60) }] })],
    });
    expect(nextDueAt(f, T0)).toBeNull();
  });

  it('is null on an idle farm', () => {
    expect(nextDueAt(farm(), T0)).toBeNull();
    expect(nextDueAt(farm({ tiles: [tile({ crop: null, ready: false, readyAt: null })] }), T0)).toBeNull();
  });
});

describe('shouldNotify', () => {
  const base = { notifyAt: at(-1), notifiedAt: null, lastSeenAt: at(-NOTIFY_QUIET_SEC - 60) };

  it('sends once the timer is up and the player has been gone a while', () => {
    expect(shouldNotify(base, T0)).toBe(true);
  });

  it('waits for the timer', () => {
    expect(shouldNotify({ ...base, notifyAt: at(60) }, T0)).toBe(false);
    expect(shouldNotify({ ...base, notifyAt: null }, T0)).toBe(false);
  });

  it('does not interrupt someone who is playing right now', () => {
    expect(shouldNotify({ ...base, lastSeenAt: at(-30) }, T0)).toBe(false);
    // Right on the boundary counts as gone.
    expect(shouldNotify({ ...base, lastSeenAt: at(-NOTIFY_QUIET_SEC) }, T0)).toBe(true);
  });

  it('never sends twice for the same timer', () => {
    expect(shouldNotify({ ...base, notifiedAt: at(-1) }, T0)).toBe(false);
    // But a NEW timer that came due after the last send is fair game.
    expect(shouldNotify({ ...base, notifyAt: at(-1), notifiedAt: at(-120) }, T0)).toBe(true);
  });
});

describe('notifyText', () => {
  it('names what is waiting, and reads as a sentence', () => {
    const f = farm({
      tiles: [tile({ ready: true, readyAt: iso(-10) }), { ...tile({ ready: true, readyAt: iso(-10) }), index: 1 }],
      machines: [machine({ done: { cfeed: 3 } })],
      pens: [pen({ animals: [{ state: 'ready', fedAt: iso(-600), readyAt: iso(-10) }] })],
    });
    const text = notifyText(f, T0)!;
    expect(text.title).toBe('Your farm is ready');
    expect(text.body).toBe('2 crops ready to harvest, 3 goods to collect and 1 animal waiting.');
  });

  it('uses the singular when there is one of something', () => {
    const f = farm({ tiles: [tile({ ready: true, readyAt: iso(-10) })] });
    expect(notifyText(f, T0)!.body).toBe('1 crop ready to harvest.');
  });

  it('says nothing when there is nothing to say', () => {
    // The guard against a notification that opens on an empty farm.
    expect(notifyText(farm(), T0)).toBeNull();
    expect(notifyText(farm({ tiles: [tile({ ready: false, readyAt: iso(300) })] }), T0)).toBeNull();
  });
});
