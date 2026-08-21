// @ts-nocheck
/**
 * SUNMIL — camera, world layout and the canvas render loop.
 *
 * Ported from the prototype's game.js render half. The drawing is unchanged;
 * what changed is where the state comes from. The prototype read its in-memory
 * `S`; this reads the server snapshot mirror, and every progress bar is derived
 * from the server's timestamps rather than a local timer (HANDOFF §8).
 *
 * Animal wander, the farmer and the particle FX are client-only decoration —
 * they carry no economic meaning, so they stay local.
 */
import { ART as A, ICON } from './art';
import { W as WD } from './art2';
import { stick } from './joystick';
import { cfg, level, penCfg, progress, ready, S, serverNow, snap } from './state';

const TW = WD.TW, TH = WD.TH;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ================= WORLD LAYOUT ================= */

/**
 * Where each field slot sits. The first sixteen fill the meadow left of the
 * path; the last eight open on the far side of it, which is where the level
 * curve past 10 puts them. Index order matches the server's tile index.
 */
export const FIELD_POS = [];
for (let r = 0; r < 4; r++) for (let cx = 0; cx < 4; cx++) FIELD_POS.push([1.6 + cx * 1.05, 1.5 + r * 1.05]);
for (let r = 0; r < 2; r++) for (let cx = 0; cx < 4; cx++) FIELD_POS.push([5.9 + cx * 1.0, 1.5 + r * 1.05]);

const ISO_W = 13, ISO_D = 13;
const DECOR = [];
function buildDecor() {
  DECOR.length = 0;
  const T = [[0.4, 0.4], [6.2, 0.35], [12.5, 0.5], [12.6, 4.4], [0.35, 4.2], [0.4, 12.4], [12.5, 12.4], [3.4, 12.5], [12.5, 8.2]];
  T.forEach(function (p, i) { DECOR.push({ k: 'tree', x: p[0], y: p[1], s: 1, i: i }) });
  const B = [[9.6, 0.4], [0.4, 2.3], [0.35, 9.6], [12.5, 2.4], [10.6, 12.4], [2.0, 12.4], [12.5, 6.4], [6.4, 12.5]];
  B.forEach(function (p, i) { DECOR.push({ k: 'bush', x: p[0], y: p[1], i: i }) });
  DECOR.push({ k: 'rock', x: 0.5, y: 6.8, i: 1 }, { k: 'rock', x: 12.5, y: 10.4, i: 2 });
  // The second bale moved off (4.9, 5.0): the field block now reaches y 4.65
  // there, and a hay bale sitting on a plot reads as a bug.
  DECOR.push({ k: 'hay', x: 0.9, y: 5.0, i: 1 }, { k: 'hay', x: 7.2, y: 4.5, i: 2 });
  DECOR.push({ k: 'pond', x: 2.3, y: 10.9 });
  DECOR.push({ k: 'barn', x: 9.5, y: 1.4 });
  DECOR.push({ k: 'silo', x: 11.2, y: 2.3 });
  DECOR.push({ k: 'stand', x: 11.3, y: 5.6 });
  DECOR.push({ k: 'truck', x: 11.4, y: 7.2 });
  for (const p of cfg().pens) DECOR.push({ k: 'trough', x: p.hx + 0.9, y: p.hy + 0.8, pen: p.id });
}

const FARMER = { x: 5.2, y: 5.4, tx: 5.2, ty: 5.4, walk: 0, flip: false, blink: 0, bt: 2 };

/** Walk the farmer over to whatever the player just touched. */
export function sendFarmer(x, y) {
  // A tap must not fight the stick: while the player is steering, ignore it.
  if (stick.active) return;
  FARMER.tx = x; FARMER.ty = y;
}

export function farmerPos() { return { x: FARMER.x, y: FARMER.y } }

/** Keep the farmer on the island rather than walking into the sea. */
const WALK_MIN = 0.4;
const WALK_MAX = 12.6;
const WALK_SPEED = 2.6;

/**
 * Turn a screen-space stick direction into a world-space one. The world is
 * isometric, so pushing the stick right is not "x + 1" — it is the inverse of
 * the iso projection, the same maths the tap picker uses in reverse.
 */
function stickToWorld(sx, sy) {
  const wx = sx / TW + sy / TH;
  const wy = sy / TH - sx / TW;
  const len = Math.hypot(wx, wy);
  return len ? { x: wx / len, y: wy / len, len } : null;
}

function truckPos() { const d = DECOR.find(function (o) { return o.k === 'truck' }); return WD.iso(d.x, d.y) }

/* ── animal wander: presentation only, keyed by pen + slot ── */
const anim = {};
function animalKey(penId, i) { return penId + ':' + i }
function animalOf(pen, i) {
  const key = animalKey(pen.id, i);
  let a = anim[key];
  if (!a) {
    const px = pen.x0 + (pen.x1 - pen.x0) * (0.2 + 0.6 * A.prng(i * 37 + pen.id.length));
    const py = pen.y0 + (pen.y1 - pen.y0) * (0.2 + 0.6 * A.prng(i * 71 + pen.id.length * 3));
    a = anim[key] = { x: px, y: py, tx: px, ty: py, ph: i * 1.7, flip: false, walk: 0, wait: 1 + i * 0.8, blink: 0 };
  }
  return a;
}

/* ================= FX ================= */

const fx = { list: [] };
fx.pop = function (p, kind, text) { fx.list.push({ x: p.x, y: p.y, kind: kind, text: text, t: 0, life: 1.5, vy: -38 }) };
fx.puff = function (p, n) {
  for (let i = 0; i < (n || 6); i++) fx.list.push({ x: p.x, y: p.y, kind: 'dust', t: 0, life: .55, vx: (Math.random() - .5) * 70, vy: -20 - Math.random() * 40 });
};
fx.spark = function (p, n) {
  for (let i = 0; i < (n || 10); i++) fx.list.push({ x: p.x, y: p.y, kind: 'spark', t: 0, life: .8, vx: (Math.random() - .5) * 90, vy: -40 - Math.random() * 70, hue: Math.random() });
};
fx.step = function (dt) {
  for (const f of fx.list) {
    f.t += dt;
    if (f.vx != null) f.x += f.vx * dt;
    if (f.vy != null) { f.y += f.vy * dt; f.vy += (f.kind === 'dust' ? 150 : 210) * dt }
  }
  fx.list = fx.list.filter(function (f) { return f.t < f.life });
};
export { fx };

/* ================= CAMERA ================= */

export const cam = { x: 0, y: 0, z: .8, tz: .8 };
let cv, cx2, DPR = 1, VW = 0, VH = 0;

function resize() {
  cv = document.getElementById('world');
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
  cx2 = cv.getContext('2d');
}

export function w2s(wx, wy) { const p = WD.iso(wx, wy); return { x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y } }

/** Chrome that overlaps the canvas: the HUD along the top, the seed dock and
 *  the safe area along the bottom. The view is centred in what is left. */
const CHROME_TOP = 96;
const CHROME_BOTTOM = 168;

/**
 * The bounding box of everything the player interacts with — fields, machines,
 * pens, the barn, silo, market stand and truck. Computed from config so it
 * follows the layout instead of hardcoding a guess.
 */
let CONTENT = { cx: 6, cy: 6, w: 1, h: 1 };
function measureContent() {
  const pts = [];
  for (const p of FIELD_POS) pts.push(p);
  for (const m of cfg().machines) pts.push([m.x, m.y]);
  for (const p of cfg().pens) { pts.push([p.x0, p.y0]); pts.push([p.x1, p.y1]) }
  for (const d of DECOR) if (['barn', 'silo', 'stand', 'truck'].indexOf(d.k) >= 0) pts.push([d.x, d.y]);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    const q = WD.iso(x, y);
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  // Sprites are drawn upward from their anchor, so give the top extra room.
  minY -= 150; maxY += 60;
  CONTENT = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

export function clampCam() {
  const m = 120;
  const l = WD.iso(0, ISO_D), r = WD.iso(ISO_W, 0), tp = WD.iso(0, 0), bt = WD.iso(ISO_W, ISO_D);
  cam.x = clamp(cam.x, VW - m - r.x * cam.z, m - l.x * cam.z);
  cam.y = clamp(cam.y, VH - m - (bt.y + 80) * cam.z, m - tp.y * cam.z);
}

/**
 * Frame the farm (HANDOFF §9.1).
 *
 * The prototype picked a zoom from viewport width alone and centred on a fixed
 * world point, which on a narrow screen sat the yard too high and pushed the
 * left-column machines and the market stand off the edges. This fits the
 * measured content box into the space the HUD and dock leave, then centres on
 * that box — so whatever is unlocked, it starts on screen.
 */
export function fitCamera() {
  resize();
  const usableH = Math.max(240, VH - CHROME_TOP - CHROME_BOTTOM);
  const z = clamp(Math.min(VW / (CONTENT.w + 120), usableH / (CONTENT.h + 80)), 0.5, 1.15);
  cam.z = z; cam.tz = z;
  cam.x = VW / 2 - CONTENT.cx * cam.z;
  cam.y = (CHROME_TOP + Math.max(CHROME_TOP + 120, VH - CHROME_BOTTOM)) / 2 - CONTENT.cy * cam.z;
  clampCam();
}

/* ================= ISLAND CACHE ================= */

let islandCv = null, islandOff = { x: 0, y: 0 };
const ISCALE = 2;

export function buildIsland() {
  const l = WD.iso(0, ISO_D).x, r = WD.iso(ISO_W, 0).x, t = 0, b = WD.iso(ISO_W, ISO_D).y + 96;
  const pad = 8;
  const w = Math.ceil((r - l + pad * 2) * ISCALE), h = Math.ceil((b - t + pad * 2) * ISCALE);
  islandCv = document.createElement('canvas'); islandCv.width = w; islandCv.height = h;
  const g = islandCv.getContext('2d');
  g.scale(ISCALE, ISCALE);
  islandOff.x = -(l - pad); islandOff.y = -(t - pad);
  g.translate(islandOff.x, islandOff.y);
  WD.island(g, ISO_W, ISO_D, 0);

  /**
   * Flatten it.
   *
   * island() draws a plateau: a drop shadow, two soil walls 78px deep and a
   * grass lip along their tops. That is what made the farm read as a block
   * sitting on the world rather than part of it. The art is not to be edited
   * (CLAUDE.md), so this does not edit it — it takes what island() drew and
   * keeps only the top face, cutting away everything outside the diamond.
   *
   * Before the fence goes on, because the fence rails stand above the two
   * back edges and are outside the diamond too.
   */
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const f1 = WD.iso(0, 0), f2 = WD.iso(ISO_W, 0), f3 = WD.iso(ISO_W, ISO_D), f4 = WD.iso(0, ISO_D);
  g.beginPath();
  g.rect(l - pad, t - pad, (r - l) + pad * 2, (b - t) + pad * 2);
  g.moveTo(f1.x, f1.y); g.lineTo(f2.x, f2.y); g.lineTo(f3.x, f3.y); g.lineTo(f4.x, f4.y);
  g.closePath();
  g.fill('evenodd');

  /**
   * And feather what is left.
   *
   * A hard cut leaves the field as a bright diamond laid on top of the
   * meadow — flat, but pasted on, and the two front edges have no fence to
   * explain the line. Erasing a soft rim lets the field's grass fall away into
   * the meadow's instead. The mown rows already line up across it, because
   * both surfaces are now rows of whole `y` from the same iso().
   */
  g.lineJoin = 'round';
  for (const [w, a] of [[26, 0.1], [17, 0.16], [9, 0.22], [4, 0.3]]) {
    g.globalAlpha = a;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(f1.x, f1.y); g.lineTo(f2.x, f2.y); g.lineTo(f3.x, f3.y); g.lineTo(f4.x, f4.y);
    g.closePath();
    g.stroke();
  }
  g.restore();

  /* fences along the two outer edges */
  g.save(); g.translate(WD.iso(0, 0).x, WD.iso(0, 0).y); WD.DEC.fence(g, ISO_W, 0); g.restore();
  g.save(); g.translate(WD.iso(0, 0).x, WD.iso(0, 0).y); WD.DEC.fence(g, ISO_D, 1); g.restore();
  /* dirt path linking the yard */
  g.save();
  const pts = [[5.2, 1.4], [5.2, 5.4], [6.4, 6.6], [8.8, 7.0], [11.2, 7.2]];
  g.strokeStyle = 'rgba(150,112,62,.85)'; g.lineWidth = 30; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); pts.forEach(function (p, i) { const q = WD.iso(p[0], p[1]); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y) }); g.stroke();
  g.strokeStyle = 'rgba(186,148,96,.75)'; g.lineWidth = 22;
  g.beginPath(); pts.forEach(function (p, i) { const q = WD.iso(p[0], p[1]); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y) }); g.stroke();
  g.globalAlpha = .35; g.fillStyle = '#7E5A2E';
  for (let i = 0; i < 70; i++) {
    const u = A.prng(i * 13), seg = Math.min(pts.length - 2, Math.floor(u * (pts.length - 1)));
    const f = (u * (pts.length - 1)) - seg;
    const p0 = pts[seg], p1 = pts[seg + 1];
    const q = WD.iso(p0[0] + (p1[0] - p0[0]) * f + (A.prng(i * 7) - .5) * .28, p0[1] + (p1[1] - p0[1]) * f + (A.prng(i * 29) - .5) * .28);
    A.ell(g, q.x, q.y, 2.6 + A.prng(i * 3) * 3, 1.6 + A.prng(i * 11) * 1.6); g.fill();
  }
  g.restore();
  /* pen ground tint */
  for (const p of cfg().pens) {
    g.save(); g.globalAlpha = .2; g.fillStyle = '#C9A96A';
    const a = WD.iso(p.x0, p.y0), b2 = WD.iso(p.x1, p.y0), c3 = WD.iso(p.x1, p.y1), d4 = WD.iso(p.x0, p.y1);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.lineTo(c3.x, c3.y); g.lineTo(d4.x, d4.y); g.closePath(); g.fill();
    g.restore();
    g.save(); g.translate(WD.iso(p.x0, p.y0).x, WD.iso(p.x0, p.y0).y); WD.DEC.fence(g, p.x1 - p.x0, 0); g.restore();
    g.save(); g.translate(WD.iso(p.x0, p.y0).x, WD.iso(p.x0, p.y0).y); WD.DEC.fence(g, p.y1 - p.y0, 1); g.restore();
  }
}

/* ================= GROUND ================= */

/**
 * The meadow surface, baked once into a repeating tile.
 *
 * Drawn live it was a full-screen gradient, then one long parallelogram per
 * mown row — sixty to a hundred and twenty of them — then a pattern pass, then
 * haze. On this box that took the frame rate from 38 to 15, and a phone would
 * have felt it worse than a container does. None of it is animated, so none of
 * it belongs in the frame.
 *
 * It tiles because the iso lattice contains a rectangle: (2,-2) tiles is
 * exactly 256px across with no vertical shift, (2,2) is exactly 128px down
 * with none across, and both keep the mown rows' parity. So a 256x128 bitmap
 * repeats seamlessly over the plane, and the whole surface becomes one fill.
 */
const GTW = 256, GTH = 128;
let groundPat = null;

function groundPattern(c) {
  if (groundPat) return groundPat;
  const tile = document.createElement('canvas');
  tile.width = GTW; tile.height = GTH;
  const g = tile.getContext('2d');

  // Cooler and a shade deeper than the farm's own grass, so the fenced field
  // stays the brightest thing on screen and the eye still goes there first.
  g.fillStyle = '#427A26';
  g.fillRect(0, 0, GTW, GTH);

  // The mown rows the farm is mown in, carried outward. Drawn past the tile's
  // edges; the lattice makes what spills over land on itself.
  g.globalAlpha = 0.07;
  for (let y = -6; y <= 6; y++) {
    g.fillStyle = ((y % 2) + 2) % 2 ? '#CDEE94' : '#224C0C';
    const p0 = WD.iso(-6, y), p1 = WD.iso(10, y), p2 = WD.iso(10, y + 1), p3 = WD.iso(-6, y + 1);
    g.beginPath();
    g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y);
    g.closePath(); g.fill();
  }
  g.globalAlpha = 1;

  // Blades, and a few soft patches so the field has weather in it rather than
  // being an even carpet. Wrapped by hand: anything drawn near an edge is
  // drawn again on the far side, or the repeat shows as a grid.
  const blade = (x, y, i) => {
    const h = 2 + A.prng(i * 13) * 3.4;
    g.strokeStyle = i % 3 ? 'rgba(28,62,12,.34)' : 'rgba(178,222,112,.30)';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (A.prng(i * 7) - 0.5) * 2.2, y - h);
    g.stroke();
  };
  g.lineWidth = 1;
  for (let i = 0; i < 340; i++) {
    const x = A.prng(i * 37) * GTW, y = A.prng(i * 61) * GTH;
    for (const ox of [0, -GTW, GTW]) for (const oy of [0, -GTH, GTH]) blade(x + ox, y + oy, i);
  }
  for (let i = 0; i < 9; i++) {
    const x = A.prng(i * 91) * GTW, y = A.prng(i * 43) * GTH;
    const rx = 16 + A.prng(i * 17) * 24, ry = 9 + A.prng(i * 29) * 13;
    g.globalAlpha = 0.05;
    g.fillStyle = i % 2 ? '#1E4A0C' : '#B7E070';
    for (const ox of [0, -GTW, GTW]) for (const oy of [0, -GTH, GTH]) { A.ell(g, x + ox, y + oy, rx, ry); g.fill() }
  }
  groundPat = c.createPattern(tile, 'repeat');
  return groundPat;
}

/**
 * What is out there.
 *
 * An empty meadow is a backdrop; a meadow with trees in it is a country the
 * farm is part of, and that is the whole difference being asked for. A sparse
 * deterministic scatter on a coarse grid — one candidate cell every few tiles,
 * most of them empty — so it is the same country on every device and every
 * reload, and costs a couple of dozen sprites a frame rather than a thousand.
 *
 * Cleared well back from the fence: these are drawn before the island, so
 * anything close enough to overlap it would be swallowed by it.
 */
const MEADOW_STEP = 4;
const MEADOW_CLEAR = 4;

/**
 * A cap on the grid, not on the sprites drawn.
 *
 * The visible tile range grows as the square of zooming out, and the ambient
 * camera behind the login card goes to 0.34 — which on a desktop is a couple
 * of thousand candidate cells a frame. Bounding the grid around the view
 * centre thins the decor at the very edge of an extreme zoom-out, where the
 * haze has almost taken it anyway, and leaves normal play untouched: at
 * gameplay zoom the visible range is well inside this.
 */
const MEADOW_CELLS = 26;

/**
 * Meadow decor, baked once per variant.
 *
 * Forty trees and bushes redrawn from paths and gradients every frame is most
 * of what the ground cost: they are the same six pictures over and over. Baked
 * at 2x and blitted, they cost a bitmap copy each. The sway goes with it,
 * which is the right trade — swaying scenery a hundred metres out only pulls
 * the eye away from the farm.
 *
 * The box fits the largest of them: a tree reaches 124px above its root and
 * 52px to its left, and its contact shadow 21px below.
 */
const DS_W = 128, DS_H = 168, DS_OX = 64, DS_OY = 140, DS_SCALE = 2;
const decorSprites = {};

function decorSprite(kind, k) {
  const key = kind + k;
  if (decorSprites[key]) return decorSprites[key];
  const cv = document.createElement('canvas');
  cv.width = DS_W * DS_SCALE; cv.height = DS_H * DS_SCALE;
  const g = cv.getContext('2d');
  g.scale(DS_SCALE, DS_SCALE);
  g.translate(DS_OX, DS_OY);
  if (kind === 'tree') WD.DEC.tree(g, 0, k);
  else if (kind === 'bush') WD.DEC.bush(g, 0, k);
  else WD.DEC.rock(g, 0, k);
  decorSprites[key] = cv;
  return cv;
}

function meadowSeed(gx, gy) {
  return (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) | 0;
}

function boundCells(lo, hi) {
  const a = Math.floor(lo / MEADOW_STEP), b = Math.ceil(hi / MEADOW_STEP);
  if (b - a <= MEADOW_CELLS) return [a, b];
  const mid = Math.round((a + b) / 2), half = MEADOW_CELLS >> 1;
  return [mid - half, mid + half];
}

function drawMeadowDecor(c, x0, x1, y0, y1) {
  const [gxa, gxb] = boundCells(x0, x1);
  const [gya, gyb] = boundCells(y0, y1);
  for (let gy = gya; gy <= gyb; gy++) {
    for (let gx = gxa; gx <= gxb; gx++) {
      const seed = meadowSeed(gx, gy);
      const roll = A.prng(seed);
      if (roll > 0.5) continue;   // most of the field is field
      const x = gx * MEADOW_STEP + (A.prng(seed + 1) - 0.5) * MEADOW_STEP * 0.85;
      const y = gy * MEADOW_STEP + (A.prng(seed + 2) - 0.5) * MEADOW_STEP * 0.85;
      if (x > -MEADOW_CLEAR && x < ISO_W + MEADOW_CLEAR
        && y > -MEADOW_CLEAR && y < ISO_D + MEADOW_CLEAR) continue;
      const q = WD.iso(x, y);
      const k = (seed >>> 3) & 3;
      const kind = roll < 0.2 ? 'tree' : roll < 0.42 ? 'bush' : 'rock';
      c.drawImage(decorSprite(kind, k), q.x - DS_OX, q.y - DS_OY, DS_W, DS_H);
    }
  }
}

/**
 * The land the farm stands on.
 *
 * art2.ts draws the farm as an island: a grass top, two soil walls 78px deep,
 * and a shadow under it. On a sky gradient that reads as a rock floating in
 * the air, which is not the game this is. The art is the product's identity
 * and is not to be edited (CLAUDE.md), so nothing here touches it — instead
 * the world gets a meadow at the depth those soil walls reach, and the island
 * becomes what it always looked like up close: a raised field standing on
 * ground that carries on past it.
 *
 * Sized from the viewport every frame rather than baked whole. A plane big
 * enough to cover the most zoomed-out camera is ~7000x3500px, which is 100MB
 * of canvas at the island's 2x cache scale — and a fixed plane that is merely
 * large still shows an edge on a screen wider than whoever chose the number.
 * This covers exactly what can be seen, at any zoom, and has no edge to find.
 */

/**
 * Screen pixel -> tile coordinate.
 *
 * The meadow shares the field's plane exactly, so the two are one surface and
 * the mown rows run straight through the fence instead of stopping at it —
 * both are rows of whole `y`, drawn from the same iso().
 */
function screenToGround(sx, sy) {
  const wx = (sx - cam.x) / cam.z;
  const wy = (sy - cam.y) / cam.z;
  // iso(x,y) = ((x-y)*TW/2, (x+y)*TH/2), inverted.
  const sum = 2 * wy / TH, diff = 2 * wx / TW;
  return { x: (sum + diff) / 2, y: (sum - diff) / 2 };
}

function drawGround(c, sx0, sy0, sx1, sy1) {
  // The visible parallelogram in tile space, as a bounding box. iso() is
  // affine, so the box's image contains the rect — one tile of slack keeps
  // the seam off the edge.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[sx0, sy0], [sx1, sy0], [sx0, sy1], [sx1, sy1]]) {
    const p = screenToGround(sx, sy);
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  x0 = Math.floor(x0) - 1; x1 = Math.ceil(x1) + 1;
  y0 = Math.floor(y0) - 1; y1 = Math.ceil(y1) + 1;

  const q = (x, y) => WD.iso(x, y);

  // The rect itself, in the coordinates below — the pattern repeats forever,
  // so there is nothing to gain by covering the bounding diamond of the view,
  // which is about four times the pixels.
  const left = (sx0 - cam.x) / cam.z;
  const top = (sy0 - cam.y) / cam.z;
  const wide = (sx1 - sx0) / cam.z, tall = (sy1 - sy0) / cam.z;

  c.save();

  // Grass, mown rows and blades, in one fill. No clip: the bounding box
  // already covers the viewport and the canvas clips what runs past it.
  c.fillStyle = groundPattern(c);
  c.fillRect(left, top, wide, tall);

  // Before the haze, so the far ones fade into it the way the ground does.
  drawMeadowDecor(c, x0, x1, y0, y1);

  // Distance. Flat colour to the edge of the screen reads as a backdrop;
  // losing the meadow gently reads as land going on.
  const mid = q(ISO_W / 2, ISO_D / 2);
  const reach = Math.max(wide, tall) * 0.6;
  const far = c.createRadialGradient(mid.x, mid.y, reach * 0.16, mid.x, mid.y, reach);
  far.addColorStop(0, 'rgba(126,168,150,0)');
  far.addColorStop(0.55, 'rgba(130,170,154,.26)');
  far.addColorStop(1, 'rgba(138,176,164,.72)');
  c.fillStyle = far;
  c.fillRect(left, top, wide, tall);
  c.restore();
}

/**
 * The ground, cached.
 *
 * None of it animates and none of it depends on the farm — it changes only
 * when the camera does, and during play the camera is still most of the time.
 * Redrawn every frame it cost more than half the frame rate on a software
 * rasterizer (40fps -> 19), almost all of it the one full-screen pattern fill.
 * Cached, a still camera pays a single untransformed blit, and a moving one
 * pays what it always did.
 */
/**
 * Ground past the edges of the screen, so panning re-blits instead of
 * redrawing. Keyed to the camera it was drawn for; a move within the margin
 * only shifts where it lands. Without it, a still camera ran at 43fps and a
 * dragged one at 18, and the login card — whose camera drifts every frame —
 * never left 13.
 */
/**
 * How much slack to keep. Rebuilds happen every `m` pixels of pan and each one
 * costs (VW+2m)(VH+2m), so the amortised cost falls as m grows — the optimum
 * for this viewport is around 500px, which is 60MB of canvas on a retina
 * screen. Clamped well under that: most of the win, a fraction of the memory,
 * and on a phone it lands back at the floor where the viewport is small
 * anyway.
 */
function groundMargin() {
  return Math.max(96, Math.min(160, Math.round(Math.min(VW, VH) * 0.2)));
}

let groundCv = null;
let groundAt = null;

function buildGroundLayer() {
  const m = groundMargin();
  const w = Math.max(1, Math.round((VW + m * 2) * DPR));
  const h = Math.max(1, Math.round((VH + m * 2) * DPR));
  if (!groundCv || groundCv.width !== w || groundCv.height !== h) {
    groundCv = document.createElement('canvas');
    groundCv.width = w; groundCv.height = h;
  }
  const g = groundCv.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  // Sky underneath, so a corner the meadow somehow failed to reach is painted
  // rather than showing whatever was left in the buffer.
  const sky = g.createLinearGradient(0, -m, 0, VH + m);
  sky.addColorStop(0, '#5AA8D8'); sky.addColorStop(.42, '#8FCBE8'); sky.addColorStop(1, '#3E7A2A');
  g.fillStyle = sky; g.fillRect(0, 0, VW + m * 2, VH + m * 2);
  // Put the layer's own origin where the viewport's is, so everything below
  // reads in ordinary screen coordinates and the margin is just slack.
  g.translate(m, m);
  g.translate(cam.x, cam.y); g.scale(cam.z, cam.z);
  drawGround(g, -m, -m, VW + m, VH + m);
  groundAt = { x: cam.x, y: cam.y, z: cam.z, vw: VW, vh: VH, dpr: DPR, m };
}

/** Blit position, in device pixels, for the layer as it stands. */
function groundLayerAt() {
  if (!groundAt || groundAt.z !== cam.z || groundAt.vw !== VW || groundAt.vh !== VH
    || groundAt.dpr !== DPR
    || Math.abs(cam.x - groundAt.x) > groundAt.m
    || Math.abs(cam.y - groundAt.y) > groundAt.m) {
    buildGroundLayer();
  }
  return {
    cv: groundCv,
    x: (cam.x - groundAt.x - groundAt.m) * DPR,
    y: (cam.y - groundAt.y - groundAt.m) * DPR,
  };
}

/* ================= RENDER ================= */

let HIT = [];
export function getHIT() { return HIT }
function hit(kind, ref, x, y, w, h) { HIT.push({ kind: kind, ref: ref, x: x, y: y, w: w, h: h }) }

function drawEntities(t) {
  const sn = snap();
  const c = cx2;
  const lvl = level();
  const list = [];

  sn.farm.tiles.forEach(function (tile) {
    if (!tile.open) return;
    const pos = FIELD_POS[tile.index];
    if (!pos) return;
    list.push({ d: pos[0] + pos[1], k: 'plot', o: tile, x: pos[0], y: pos[1] });
  });

  for (const def of cfg().machines) {
    const view = sn.farm.machines.find(function (m) { return m.machine === def.id });
    if (!view || !view.open) continue;
    list.push({ d: def.x + def.y, k: 'machine', o: view, def: def, x: def.x, y: def.y });
  }

  for (const def of cfg().pens) {
    const view = sn.farm.pens.find(function (p) { return p.pen === def.id });
    if (!view || !view.open) continue;
    list.push({ d: def.hx + def.hy, k: 'pen', o: view, def: def, x: def.hx, y: def.hy });
    view.animals.forEach(function (state, i) {
      const a = animalOf(def, i);
      list.push({ d: a.x + a.y, k: 'animal', o: a, state: state, def: def, idx: i, x: a.x, y: a.y });
    });
  }

  DECOR.forEach(function (o) {
    if (o.pen) { const pd = penCfg(o.pen); if (!pd || lvl < pd.lvl) return }
    list.push({ d: o.x + o.y, k: o.k, o: o, x: o.x, y: o.y });
  });

  list.push({ d: FARMER.x + FARMER.y, k: 'farmer', o: FARMER, x: FARMER.x, y: FARMER.y });
  list.sort(function (a, b) { return a.d - b.d });

  for (const e of list) {
    const p = WD.iso(e.x, e.y);
    c.save(); c.translate(p.x, p.y);
    switch (e.k) {
      case 'plot': {
        const tile = e.o;
        const pr = tile.crop ? progress(tile.plantedAt, tile.readyAt) : 0;
        WD.plot(c, tile.crop, pr, t, tile.index + 1, tile.crop && tile.ready);
        if (tile.crop && !tile.ready) { c.save(); c.translate(0, -46); WD.progressBar(c, pr, 44); c.restore() }
        const s = w2s(e.x, e.y); hit('plot', tile, s.x, s.y, 54 * cam.z, 34 * cam.z);
        break;
      }
      case 'machine': {
        const view = e.o, def = e.def;
        WD.BLD[def.art](c, t);
        const doneKeys = Object.keys(view.done);
        const j = view.jobs[0];
        if (j) {
          const pr = progress(j.startsAt, j.endsAt);
          c.save(); c.translate(0, -118); WD.progressBar(c, pr, 52);
          c.save(); c.translate(-40, 2); c.scale(.34, .34); ICON[j.out] && ICON[j.out](c); c.restore();
          c.restore();
        }
        if (doneKeys.length) { c.save(); c.translate(6, -132); WD.bubble(c, t, ICON[doneKeys[0]]); c.restore() }
        if (view.jobs.length > 1) {
          c.save(); c.translate(46, -108);
          c.fillStyle = 'rgba(92,54,24,.9)'; A.rr(c, -13, -11, 26, 22, 8); c.fill();
          c.fillStyle = '#FFEFC0'; c.font = '700 13px Nunito, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('+' + (view.jobs.length - 1), 0, 1); c.restore();
        }
        const s = w2s(def.x, def.y); hit('machine', def.id, s.x, s.y - 40 * cam.z, 110 * cam.z, 110 * cam.z);
        break;
      }
      case 'pen': {
        const def = e.def;
        if (def.art === 'coop') WD.BLD.coop(c, t); else WD.BLD.shelter(c, t, def.roof);
        const s = w2s(def.hx, def.hy); hit('pen', def.id, s.x, s.y - 26 * cam.z, 86 * cam.z, 80 * cam.z);
        break;
      }
      case 'animal': {
        const a = e.o, def = e.def, st = e.state;
        WD.AN[def.id](c, { t: t, ph: a.ph, walk: a.walk, flip: a.flip, s: def.scale, blink: a.blink > 0 });
        if (st.state === 'ready') { c.save(); c.translate(0, -46); WD.bubble(c, t, ICON[def.out]); c.restore() }
        else if (st.state === 'hungry') {
          c.save(); c.translate(0, -44);
          const bob = Math.sin(t * 3 + a.ph) * 2; c.translate(0, bob);
          c.fillStyle = 'rgba(255,255,255,.95)'; A.ell(c, 0, -14, 14, 12); c.fill();
          c.strokeStyle = 'rgba(120,86,40,.35)'; c.lineWidth = 1.8; A.ell(c, 0, -14, 14, 12); c.stroke();
          c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.moveTo(0, 2); c.lineTo(-4, -4); c.lineTo(4, -4); c.closePath(); c.fill();
          c.save(); c.translate(-9, -24); c.scale(.28, .28); ICON[def.feed] && ICON[def.feed](c); c.restore();
          c.restore();
        } else {
          const pr = progress(st.fedAt, st.readyAt);
          c.save(); c.translate(0, -44); WD.progressRing(c, pr, 9, '#F0C355'); c.restore();
        }
        const s = w2s(a.x, a.y);
        hit('animal', { pen: def.id, index: e.idx, state: st.state }, s.x, s.y - 22 * cam.z, 50 * cam.z, 58 * cam.z);
        break;
      }
      case 'tree': WD.DEC.tree(c, t, e.o.i); break;
      case 'bush': WD.DEC.bush(c, t, e.o.i); break;
      case 'rock': WD.DEC.rock(c, t, e.o.i); break;
      case 'hay': WD.DEC.hay(c, t, e.o.i); break;
      case 'trough': WD.DEC.trough(c, t); break;
      case 'pond': WD.DEC.pond(c, t, 1.9, 1.7); break;
      case 'barn': { WD.BLD.barn(c, t); const s = w2s(e.x, e.y); hit('barn', null, s.x, s.y - 46 * cam.z, 130 * cam.z, 120 * cam.z); break }
      case 'silo': { WD.BLD.silo(c, t); const s = w2s(e.x, e.y); hit('silo', null, s.x, s.y - 60 * cam.z, 80 * cam.z, 150 * cam.z); break }
      case 'stand': { WD.BLD.stand(c, t); const s = w2s(e.x, e.y); hit('market', null, s.x, s.y - 30 * cam.z, 110 * cam.z, 80 * cam.z); break }
      case 'truck': {
        WD.BLD.truck(c, t, sn.orders.filter(function (o) { return o.canFill }).length);
        const s = w2s(e.x, e.y); hit('orders', null, s.x, s.y - 24 * cam.z, 150 * cam.z, 90 * cam.z); break;
      }
      case 'farmer': WD.farmer(c, { t: t, walk: e.o.walk, flip: e.o.flip, s: 1, blink: e.o.blink > 0 }); break;
    }
    c.restore();
  }
}

function drawFX() {
  const c = cx2;
  for (const f of fx.list) {
    const k = 1 - f.t / f.life;
    c.save(); c.translate(f.x, f.y); c.globalAlpha = clamp(k * 1.6, 0, 1);
    if (f.kind === 'dust') { c.fillStyle = '#B08A54'; A.ell(c, 0, 0, 6 * (1.4 - k * .5), 4 * (1.4 - k * .5)); c.fill() }
    else if (f.kind === 'spark') {
      c.fillStyle = f.hue > .5 ? '#FFF3B0' : '#FFD166';
      c.beginPath();
      for (let s = 0; s < 8; s++) {
        const a = s / 8 * 6.2832, r = s % 2 ? 1.6 : 5 * k + 1.5;
        const x = Math.cos(a) * r, y = Math.sin(a) * r; s ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
    } else {
      c.save(); c.scale(.5, .5); (ICON[f.kind] || ICON.coin)(c); c.restore();
      if (f.text) {
        c.font = '900 17px Nunito, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.lineWidth = 4; c.strokeStyle = 'rgba(60,36,10,.85)'; c.strokeText(f.text, 34, 16);
        c.fillStyle = '#FFE9A8'; c.fillText(f.text, 34, 16);
      }
    }
    c.restore();
  }
}

export function render(t) {
  if (!cx2) return;
  const c = cx2;
  const ground = groundLayerAt();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(ground.cv, ground.x, ground.y);
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.save(); c.translate(cam.x, cam.y); c.scale(cam.z, cam.z);

  if (islandCv) c.drawImage(islandCv, -islandOff.x, -islandOff.y, islandCv.width / ISCALE, islandCv.height / ISCALE);
  HIT = [];
  if (ready()) drawEntities(t);
  c.restore();
  drawFX();
  /* warm light + vignette */
  const v = c.createRadialGradient(VW * .42, VH * .34, Math.min(VW, VH) * .2, VW * .5, VH * .55, Math.max(VW, VH) * .78);
  v.addColorStop(0, 'rgba(255,238,190,.14)'); v.addColorStop(.55, 'rgba(255,220,150,0)');
  v.addColorStop(1, 'rgba(28,44,12,.42)');
  c.fillStyle = v; c.fillRect(0, 0, VW, VH);
}

/**
 * Cosmetic simulation only — animals wandering, the farmer walking, particles.
 * No timer here decides anything; readiness comes from the server snapshot.
 */
/**
 * Slow drift across the island, used behind the login card. The landing page
 * is the farm itself rather than a flat colour, and a still frame reads as a
 * screenshot — this keeps it breathing without costing anything, since the
 * loop is already running.
 */
let ambient = 0;

/** Frame the whole island rather than the playable content box. */
function fitAmbient() {
  resize();
  const l = WD.iso(0, ISO_D).x, r = WD.iso(ISO_W, 0).x;
  const tp = WD.iso(0, 0).y, bt = WD.iso(ISO_W, ISO_D).y + 96;
  // Pull back past a snug fit: the login card covers the middle of a phone
  // screen, so the farm has to read from whatever shows around its edges.
  const zw = VW / (r - l), zh = VH / (bt - tp);
  // Landscape can hold the whole island, and seeing all of it at once is the
  // better picture. A phone cannot: fitting it by width leaves two empty bands
  // of sky and grass, so there we fill the screen and show a slice instead.
  const z = VH > VW
    ? clamp(zh * 0.95, 0.5, 1.7)
    : clamp(Math.min(zw, zh) * 1.12, 0.34, 0.9);
  cam.z = z; cam.tz = z;
}

export function setAmbient(on) {
  ambient = on ? (ambient || 0.0001) : 0;
  if (on) fitAmbient();
}

export function step(dt) {
  if (ambient) {
    ambient += dt;
    const midX = (WD.iso(0, ISO_D).x + WD.iso(ISO_W, 0).x) / 2;
    const midY = (WD.iso(0, 0).y + WD.iso(ISO_W, ISO_D).y + 96) / 2;
    cam.x = VW / 2 - midX * cam.z + Math.sin(ambient * 0.10) * VW * 0.10;
    // Landscape sits the island low, so the yard reads under the card. Portrait
    // is already filled edge to edge, so it just centres.
    const anchor = VH > VW ? 0.5 : 0.7;
    cam.y = VH * anchor - midY * cam.z + Math.sin(ambient * 0.065 + 1.4) * VH * 0.03;
    clampCam();
  }
  if (ready()) {
    for (const def of cfg().pens) {
      const view = S.snap.farm.pens.find(function (p) { return p.pen === def.id });
      if (!view || !view.open) continue;
      view.animals.forEach(function (_state, i) {
        const a = animalOf(def, i);
        a.blink -= dt; if (a.blink < -3 + Math.random() * 2) a.blink = .14;
        a.wait -= dt;
        if (a.wait <= 0) {
          a.tx = def.x0 + .25 + (def.x1 - def.x0 - .5) * Math.random();
          a.ty = def.y0 + .25 + (def.y1 - def.y0 - .5) * Math.random();
          a.wait = 2.5 + Math.random() * 4.5;
        }
        const dx = a.tx - a.x, dy = a.ty - a.y, dd = Math.hypot(dx, dy);
        if (dd > .04) {
          const sp = (def.id === 'chicken' ? .55 : .32) * dt;
          a.x += dx / dd * Math.min(sp, dd); a.y += dy / dd * Math.min(sp, dd);
          a.walk = 1; a.flip = (dx - dy) < 0;
        } else a.walk = 0;
      });
    }
  }
  const push = stick.x || stick.y ? stickToWorld(stick.x, stick.y) : null;
  if (push) {
    // Steering wins over any walk-to target left over from a tap.
    const throttle = Math.min(1, Math.hypot(stick.x, stick.y));
    const step = WALK_SPEED * throttle * dt;
    FARMER.x = clamp(FARMER.x + push.x * step, WALK_MIN, WALK_MAX);
    FARMER.y = clamp(FARMER.y + push.y * step, WALK_MIN, WALK_MAX);
    FARMER.tx = FARMER.x; FARMER.ty = FARMER.y;
    FARMER.walk = 1;
    FARMER.flip = (push.x - push.y) < 0;
    followFarmer();
  } else {
    const fdx = FARMER.tx - FARMER.x, fdy = FARMER.ty - FARMER.y, fd = Math.hypot(fdx, fdy);
    if (fd > .05) {
      const sp = 1.9 * dt;
      FARMER.x += fdx / fd * Math.min(sp, fd); FARMER.y += fdy / fd * Math.min(sp, fd);
      FARMER.walk = 1; FARMER.flip = (fdx - fdy) < 0;
    } else FARMER.walk = 0;
  }
  FARMER.blink -= dt; if (FARMER.blink < -3 + Math.random() * 2) FARMER.blink = .14;
  fx.step(dt);
}

/**
 * Ease the camera towards the farmer while the stick is being used, so walking
 * off the edge of the screen is not possible. Only nudges when the farmer
 * drifts out of the comfortable middle of the view.
 */
function followFarmer() {
  const p = WD.iso(FARMER.x, FARMER.y);
  const targetX = VW / 2 - p.x * cam.z;
  const targetY = (CHROME_TOP + Math.max(CHROME_TOP + 120, VH - CHROME_BOTTOM)) / 2 - p.y * cam.z;
  const slack = Math.min(VW, VH) * 0.16;
  if (Math.abs(targetX - cam.x) > slack) cam.x += (targetX - cam.x) * 0.08;
  if (Math.abs(targetY - cam.y) > slack) cam.y += (targetY - cam.y) * 0.08;
  clampCam();
}

export function onResize() {
  fitCamera();
  buildIsland();
}

export function initWorld() {
  buildDecor();
  measureContent();
  fitCamera();
  buildIsland();
}

export { truckPos, DECOR };
