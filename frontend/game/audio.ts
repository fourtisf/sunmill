/**
 * SUNMILL — sound.
 *
 * Synthesised with WebAudio rather than shipped as files, for the same reason
 * the art is procedural: no assets to load, nothing to cache-bust, and the
 * whole soundscape is a few hundred bytes of code instead of a few megabytes
 * of samples.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * lazily on the first interaction and every call is a no-op until then.
 */
const STORAGE_KEY = 'sunmill.sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let ambientTimer: number | null = null;

export function isEnabled(): boolean {
  return enabled;
}

export function initAudio(): void {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'off') enabled = false;
  } catch { /* private mode */ }
}

export function setEnabled(on: boolean): void {
  enabled = on;
  try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  if (master) master.gain.value = on ? 0.35 : 0;
  if (!on) stopAmbient();
  else if (ctx) startAmbient();
}

/** Called from the first pointer event; before that, everything is silent. */
export function unlockAudio(): void {
  if (ctx || !enabled) return;
  try {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.35 : 0;
    master.connect(ctx.destination);
    startAmbient();
  } catch {
    ctx = null;
  }
}

function ready(): boolean {
  if (!enabled || !ctx || !master) return false;
  if (ctx.state === 'suspended') void ctx.resume();
  return true;
}

/** One shaped sine/triangle blip. Everything below is built from these. */
function tone(opts: {
  freq: number; to?: number; dur: number; delay?: number;
  type?: OscillatorType; gain?: number;
}): void {
  if (!ready() || !ctx || !master) return;
  const start = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, start);
  if (opts.to && opts.to !== opts.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), start + opts.dur);
  }
  const peak = opts.gain ?? 0.25;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + opts.dur + 0.02);
}

/** Filtered noise — soil, rustle, the dusty half of the farm. */
function noise(opts: { dur: number; freq: number; q?: number; gain?: number; delay?: number }): void {
  if (!ready() || !ctx || !master) return;
  const start = ctx.currentTime + (opts.delay ?? 0);
  const frames = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.value = opts.gain ?? 0.2;
  src.connect(filter).connect(gain).connect(master);
  src.start(start);
}

/* ================= THE SOUNDS ================= */

export const sfx = {
  /** Any button or panel tap. */
  tap: () => tone({ freq: 520, to: 620, dur: 0.07, type: 'triangle', gain: 0.16 }),
  /** Seed into soil. */
  plant: () => { noise({ dur: 0.18, freq: 420, q: 0.8, gain: 0.16 }); tone({ freq: 300, to: 380, dur: 0.1, gain: 0.1 }) },
  /** Pulling a ripe crop. */
  harvest: () => {
    noise({ dur: 0.14, freq: 900, q: 1.4, gain: 0.14 });
    tone({ freq: 640, to: 880, dur: 0.14, type: 'triangle', gain: 0.2 });
  },
  /** A machine takes a job. */
  craft: () => { tone({ freq: 220, to: 180, dur: 0.16, type: 'sawtooth', gain: 0.12 }); tone({ freq: 440, dur: 0.1, delay: 0.05, gain: 0.1 }) },
  /** Goods into the barn, product from an animal. */
  collect: () => {
    tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.18 });
    tone({ freq: 880, dur: 0.11, delay: 0.07, type: 'triangle', gain: 0.16 });
  },
  /** Coins in. */
  coins: () => {
    tone({ freq: 980, dur: 0.08, gain: 0.16 });
    tone({ freq: 1240, dur: 0.1, delay: 0.06, gain: 0.14 });
    tone({ freq: 1560, dur: 0.12, delay: 0.12, gain: 0.12 });
  },
  /** $HAY leaving on a speed-up: a short downward whoosh. */
  spend: () => { tone({ freq: 720, to: 300, dur: 0.22, type: 'triangle', gain: 0.16 }); noise({ dur: 0.2, freq: 1600, q: 2, gain: 0.08 }) },
  /** Level up. */
  levelUp: () => {
    [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, dur: 0.22, delay: i * 0.09, type: 'triangle', gain: 0.2 }));
  },
  /** Task or streak reward. */
  reward: () => {
    [659, 880].forEach((freq, i) => tone({ freq, dur: 0.24, delay: i * 0.1, type: 'triangle', gain: 0.2 }));
    tone({ freq: 1320, dur: 0.3, delay: 0.2, gain: 0.12 });
  },
  /** Anything refused. */
  deny: () => tone({ freq: 220, to: 160, dur: 0.16, type: 'square', gain: 0.1 }),
  /** Feeding an animal. */
  feed: () => { noise({ dur: 0.12, freq: 700, q: 1, gain: 0.14 }); tone({ freq: 380, to: 460, dur: 0.1, gain: 0.1 }) },
};

/* ================= AMBIENCE ================= */

/**
 * An occasional bird or breeze, spaced far enough apart to sit under the game
 * rather than on top of it. Deliberately sparse — a loop would wear out fast.
 */
function chirp(): void {
  if (!ready()) return;
  const base = 1400 + Math.random() * 900;
  tone({ freq: base, to: base * 1.4, dur: 0.09, type: 'sine', gain: 0.05 });
  tone({ freq: base * 1.3, to: base, dur: 0.08, delay: 0.11, type: 'sine', gain: 0.04 });
}

function breeze(): void {
  noise({ dur: 1.6, freq: 500, q: 0.4, gain: 0.025 });
}

function startAmbient(): void {
  stopAmbient();
  const tick = () => {
    if (!enabled) return;
    if (document.visibilityState === 'visible') (Math.random() < 0.65 ? chirp : breeze)();
    ambientTimer = window.setTimeout(tick, 5000 + Math.random() * 9000);
  };
  ambientTimer = window.setTimeout(tick, 3000);
}

function stopAmbient(): void {
  if (ambientTimer != null) { window.clearTimeout(ambientTimer); ambientTimer = null }
}
