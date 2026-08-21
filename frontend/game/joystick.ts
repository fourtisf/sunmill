/**
 * SUNMIL — virtual joystick.
 *
 * A thumb stick in the bottom-left that walks the farmer around the island,
 * with the camera following. It is DOM and CSS only — the canvas art engine is
 * fixed, and the farmer sprite already takes a `walk` flag, so nothing here
 * touches a sprite.
 *
 * Tapping the world still works exactly as before: the stick only claims
 * pointers that start inside its own base, so a tap anywhere else is untouched.
 */
export interface Stick {
  /** -1..1 on each axis, already dead-zoned. Zero when the stick is idle. */
  x: number;
  y: number;
  active: boolean;
}

const DEAD_ZONE = 0.16;
const RADIUS = 46;

export const stick: Stick = { x: 0, y: 0, active: false };

let root: HTMLElement | null = null;
let knob: HTMLElement | null = null;
let pointerId: number | null = null;
let originX = 0;
let originY = 0;

function place(dx: number, dy: number): void {
  if (!knob) return;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function reset(): void {
  stick.x = 0; stick.y = 0; stick.active = false;
  pointerId = null;
  place(0, 0);
  root?.classList.remove('on');
}

function onDown(e: PointerEvent): void {
  if (pointerId != null || !root) return;
  pointerId = e.pointerId;
  const rect = root.getBoundingClientRect();
  originX = rect.left + rect.width / 2;
  originY = rect.top + rect.height / 2;
  root.classList.add('on');
  stick.active = true;
  /**
   * Capture the pointer, so the release is delivered here whatever it happens
   * over. Without it, a thumb or a cursor that leaves the window between press
   * and release takes its pointerup with it — and the stick, which only ever
   * stops on a pointerup, keeps walking the farmer for as long as the tab is
   * open. That is the farmer wandering off on his own.
   */
  try { root.setPointerCapture(e.pointerId) } catch { /* not supported here */ }
  // The stick owns this pointer now — the world must not also read it as a tap.
  e.stopPropagation();
  e.preventDefault();
  move(e);
}

function move(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return;
  const dx = e.clientX - originX;
  const dy = e.clientY - originY;
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, RADIUS);
  const nx = dist ? (dx / dist) * clamped : 0;
  const ny = dist ? (dy / dist) * clamped : 0;
  place(nx, ny);

  const mag = clamped / RADIUS;
  if (mag < DEAD_ZONE) { stick.x = 0; stick.y = 0; return }
  // Rescale past the dead zone so the first responsive movement is gentle.
  const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
  stick.x = (nx / clamped) * scaled;
  stick.y = (ny / clamped) * scaled;
}

function onMove(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return;
  e.preventDefault();
  move(e);
}

function onUp(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return;
  reset();
}

/**
 * Let go whenever the pointer stream stops being trustworthy.
 *
 * Capture covers the release landing somewhere else. These cover the release
 * never happening at all: the tab going to the background, the window losing
 * focus to another app, the browser handing the pointer to something else.
 * Every one of them used to leave the farmer walking.
 */
function letGo(): void {
  if (pointerId != null) reset();
}

function onHidden(): void {
  if (document.hidden) letGo();
}

/** Build the stick into `#joystick` and start listening. */
export function mountJoystick(): void {
  root = document.getElementById('joystick');
  if (!root) return;
  root.innerHTML = '<div class="jk-base"><div class="jk-knob"></div></div>';
  knob = root.querySelector('.jk-knob');

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('lostpointercapture', letGo);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', onHidden);
  reset();
}

export function unmountJoystick(): void {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  window.removeEventListener('blur', letGo);
  document.removeEventListener('visibilitychange', onHidden);
  root?.removeEventListener('pointerdown', onDown);
  root?.removeEventListener('lostpointercapture', letGo);
  root = null; knob = null;
  reset();
}

/** Hide the stick while a modal is open — nothing to walk to behind it. */
export function setJoystickVisible(visible: boolean): void {
  if (!root) return;
  root.style.display = visible ? '' : 'none';
  if (!visible) reset();
}
