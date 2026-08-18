/**
 * SUNMILL — the guide.
 *
 * One engine drives both the onboarding tutorial and the "show me" button on a
 * daily task. A guide is a list of steps; each step points at something on
 * screen, says what to do, and then waits for the game state to prove it was
 * done. Nothing is faked — a step only advances when the server snapshot says
 * the action actually happened, so following the guide IS playing the game.
 *
 * The spotlight is a DOM overlay with a hole cut in it. It never blocks the
 * thing it is pointing at, so the player performs the real interaction rather
 * than a scripted stand-in.
 */
import { t } from './i18n';
import { S, snap, tasks } from './state';
import { sfx } from './audio';

export interface GuideStep {
  /**
   * Instruction shown in the coach mark. A function is re-read on every poll,
   * which is how a task step can show live progress ("3 / 8 planted").
   */
  text: string | (() => string);
  /**
   * CSS selector, or a function returning screen coordinates, for the thing to
   * spotlight. Omit for a step with no particular target.
   */
  target?: string | (() => { x: number; y: number; w: number; h: number } | null);
  /** True once the player has done it. Polled against the live snapshot. */
  done: () => boolean;
  /** Optional: skip this step entirely when it is already satisfied. */
  skipIf?: () => boolean;
}

export interface GuideRun {
  id: string;
  steps: GuideStep[];
  /** Called when every step is finished, or the player stops. */
  onFinish?: (completed: boolean) => void;
}

let run: GuideRun | null = null;
let index = 0;
let poll: number | null = null;
let layer: HTMLElement | null = null;

export function isGuiding(): boolean {
  return run != null;
}

export function guideId(): string | null {
  return run?.id ?? null;
}

function ensureLayer(): HTMLElement {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement('div');
  layer.id = 'guide';
  layer.innerHTML = `
    <div class="g-hole"></div>
    <div class="g-card panel">
      <div class="g-step"></div>
      <div class="g-text"></div>
      <button class="btn wood g-stop"></button>
    </div>`;
  document.body.appendChild(layer);
  layer.querySelector('.g-stop')?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    stopGuide(false);
  });
  return layer;
}

/** Screen rect of a DOM element, or null when it is not on screen. */
function domRect(selector: string): { x: number; y: number; w: number; h: number } | null {
  const node = document.querySelector(selector);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

function targetRect(step: GuideStep): { x: number; y: number; w: number; h: number } | null {
  if (!step.target) return null;
  if (typeof step.target === 'function') return step.target();
  return domRect(step.target);
}

function paint(): void {
  if (!run) return;
  const step = run.steps[index];
  if (!step) return;
  const el = ensureLayer();
  const hole = el.querySelector('.g-hole') as HTMLElement;
  const card = el.querySelector('.g-card') as HTMLElement;

  (el.querySelector('.g-step') as HTMLElement).textContent =
    t('tutorial.step', { n: index + 1, total: run.steps.length });
  (el.querySelector('.g-text') as HTMLElement).textContent =
    typeof step.text === 'function' ? step.text() : step.text;
  (el.querySelector('.g-stop') as HTMLElement).textContent = t('guide.stop');

  const rect = targetRect(step);
  if (rect) {
    const pad = 14;
    const w = Math.max(56, rect.w + pad * 2);
    const h = Math.max(56, rect.h + pad * 2);
    hole.style.display = '';
    hole.style.width = `${w}px`;
    hole.style.height = `${h}px`;
    hole.style.left = `${rect.x - w / 2}px`;
    hole.style.top = `${rect.y - h / 2}px`;

    // Put the card wherever the spotlight is not.
    const below = rect.y + h / 2 + 16;
    card.style.top = below + card.offsetHeight > window.innerHeight - 20
      ? `${Math.max(16, rect.y - h / 2 - card.offsetHeight - 16)}px`
      : `${below}px`;
  } else {
    hole.style.display = 'none';
    card.style.top = `${Math.round(window.innerHeight * 0.28)}px`;
  }
}

function advance(): void {
  if (!run) return;
  // Skip anything already true — a returning player should not be told to do
  // something they did five minutes ago.
  while (index < run.steps.length) {
    const step = run.steps[index];
    if (step.skipIf?.() || step.done()) { index += 1; continue }
    break;
  }
  if (index >= run.steps.length) { stopGuide(true); return }
  paint();
}

function tick(): void {
  if (!run) return;
  const step = run.steps[index];
  if (step && step.done()) {
    sfx.collect();
    index += 1;
    advance();
    return;
  }
  paint();
}

export function startGuide(next: GuideRun): void {
  stopGuide(false);
  if (!next.steps.length) return;
  run = next;
  index = 0;
  ensureLayer().classList.add('on');
  advance();
  poll = window.setInterval(tick, 400);
  window.addEventListener('resize', paint);
}

export function stopGuide(completed: boolean): void {
  const finished = run;
  run = null;
  index = 0;
  if (poll != null) { window.clearInterval(poll); poll = null }
  window.removeEventListener('resize', paint);
  layer?.classList.remove('on');
  if (finished?.onFinish) finished.onFinish(completed);
}

/** Nudge the overlay after the UI moved underneath it (a panel opened, say). */
export function refreshGuide(): void {
  if (run) paint();
}

/* ================= POINTING AT THE WORLD ================= */

interface Hit { kind: string; ref: any; x: number; y: number; w: number; h: number }

/**
 * Spotlight something in the world rather than the whole canvas.
 *
 * The renderer publishes a hit box per interactive object every frame, so a
 * guide step can point at the actual machine or ripe crop the player needs to
 * touch. Highlighting `#world` would dim the entire screen and say nothing.
 */
function worldTarget(match: (hit: Hit) => boolean) {
  return () => {
    const hits: Hit[] = (window as unknown as { __HITS?: Hit[] }).__HITS ?? [];
    const hit = hits.find(match);
    if (!hit) return null;
    return { x: hit.x, y: hit.y, w: Math.max(64, hit.w), h: Math.max(64, hit.h) };
  };
}

const pointAt = {
  emptyPlot: worldTarget((h) => h.kind === 'plot' && !h.ref.crop && h.ref.open),
  ripePlot: worldTarget((h) => h.kind === 'plot' && Boolean(h.ref.crop) && h.ref.ready),
  growingPlot: worldTarget((h) => h.kind === 'plot' && Boolean(h.ref.crop) && !h.ref.ready),
  machine: worldTarget((h) => h.kind === 'machine'),
  pen: worldTarget((h) => h.kind === 'pen'),
  readyAnimal: worldTarget((h) => h.kind === 'animal' && h.ref.state === 'ready'),
  truck: worldTarget((h) => h.kind === 'orders'),
  /** A machine with goods waiting, so "collect" points somewhere worth tapping. */
  machineWithGoods: worldTarget((h) => {
    if (h.kind !== 'machine') return false;
    const view = (S.snap?.farm.machines ?? []).find((m) => m.machine === h.ref);
    return Boolean(view && Object.keys(view.done).length);
  }),
};

/* ================= THE TUTORIAL ================= */

function inv(id: string): number {
  return S.snap?.farm.inventory[id] ?? 0;
}

function anyTile(predicate: (t: { crop: string | null; ready: boolean }) => boolean): boolean {
  return (S.snap?.farm.tiles ?? []).some(predicate);
}

/**
 * First-run onboarding. Every step waits on real state, so a player who wanders
 * off and does it their own way still progresses.
 */
export function tutorialSteps(): GuideStep[] {
  const started = { seeds: inv('wheat'), harvests: 0 };
  return [
    {
      text: t('tutorial.selectSeed'),
      target: '#dockInner .seed',
      // A seed is pre-selected so the game works on the first tap, so this
      // waits on the player actually choosing one rather than on `sel`.
      done: () => S.seedChosen,
    },
    {
      text: t('tutorial.plant'),
      target: pointAt.emptyPlot,
      done: () => anyTile((tile) => Boolean(tile.crop)),
    },
    {
      // Optional: clears the moment anything is ripe, whether they paid or waited.
      text: t('tutorial.speedup'),
      target: pointAt.growingPlot,
      done: () => anyTile((tile) => Boolean(tile.crop) && tile.ready),
    },
    {
      text: t('tutorial.harvest'),
      target: pointAt.ripePlot,
      done: () => inv('wheat') > started.seeds || started.harvests > 0,
    },
    {
      text: t('tutorial.machine'),
      target: pointAt.machine,
      done: () => S.openModal?.startsWith('machine:') === true,
    },
    {
      text: t('tutorial.queue'),
      done: () => (S.snap?.farm.machines ?? []).some((m) => m.jobs.length > 0 || Object.keys(m.done).length > 0),
    },
    {
      text: t('tutorial.tasks'),
      target: '#rb_tasks',
      done: () => S.openModal === 'tasks',
    },
  ];
}

/* ================= GUIDED DAILY TASKS ================= */

/**
 * Where to point for each task kind. World targets resolve against the live
 * hit boxes, so the spotlight lands on the actual crop or machine.
 */
const TASK_TARGET: Record<string, GuideStep['target']> = {
  plant: '#dockInner .seed',
  harvest: pointAt.ripePlot,
  craft: pointAt.machine,
  collect_machine: pointAt.machineWithGoods,
  feed: pointAt.pen,
  collect_pen: pointAt.readyAnimal,
  deliver: '#rb_orders',
  sell: '#rb_market',
};

/**
 * When the thing to point at does not exist yet — no ripe crop, no machine
 * with goods — point at what gets them there instead.
 */
const TASK_FALLBACK: Record<string, string> = {
  harvest: '#dockInner .seed',
  collect_machine: '#rb_tasks',
  collect_pen: '#rb_tasks',
};

/**
 * Guide the player through a daily task, all the way to done. The step repeats
 * with a live count rather than ticking off once — "3 / 8 planted" is the
 * useful thing to see, and it keeps guiding until the task is actually
 * complete, which is what was asked for.
 */
export function taskGuideSteps(kind: string): GuideStep[] {
  const progressOf = () => tasks().find((task) => task.kind === kind);
  const primary = TASK_TARGET[kind];
  const target: GuideStep['target'] = typeof primary === 'function'
    ? () => primary() ?? (TASK_FALLBACK[kind] ? domRect(TASK_FALLBACK[kind]) : null)
    : primary;

  return [
    {
      // Live count, so the player can see the task filling up as they work.
      text: () => `${t(`guide.${kind}`)}  ${taskProgressLabel(kind)}`,
      target,
      done: () => Boolean(progressOf()?.done),
    },
    {
      text: t('guide.taskDone'),
      target: '#rb_tasks',
      done: () => Boolean(progressOf()?.claimed),
    },
  ];
}

/** Live progress text for the coach mark, refreshed on every poll. */
export function taskProgressLabel(kind: string): string {
  const task = tasks().find((entry) => entry.kind === kind);
  if (!task) return '';
  return t('tasks.progress', { progress: task.progress, target: task.target });
}
