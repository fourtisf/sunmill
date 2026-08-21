// @ts-nocheck
/**
 * SUNMIL — the sprites that were not in the prototype.
 *
 * art.ts and art2.ts are the prototype's art, ported verbatim, and CLAUDE.md
 * says not to touch them. Nothing here does: every table they export — ICON,
 * CROP, BLD — is a live object, so this file registers into them at import
 * and both files stay byte-identical. art2's own plot() looks crops up in that
 * same object, so a crop registered here grows in a field without art2 knowing
 * it exists.
 *
 * Drawn with the same helpers and the same rules as the originals: icons live
 * in a 64x64 box standing on the ground, crops take (ctx, growth 0..1, time,
 * seed) and grow upward from their anchor, buildings sit on the iso box that
 * house() lays down.
 */
import { ART as A, ICON } from './art';
import { W as WD } from './art2';

const { lg, rg, ell, rr, poly, contact, ink, mix, prng } = A;
const { HZ, house, faceR, faceL, windowPane } = WD;

/* ================= CROPS ================= *
 * p is 0..1. Nothing edible appears before the plant has grown into it — the
 * player reads ripeness off the fruit, not off a timer.                      */

/** Tomato — a staked bush that reddens from the bottom up. */
WD.CROP.tomato = function (c, p, t, k) {
  const H = 6 + p * 26, sw = Math.sin(t * 1.7 + k) * (1.2 + p * 1.8);
  // cane
  c.strokeStyle = '#9C7040'; c.lineWidth = 1.8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(1.5, 0); c.lineTo(1.5 + sw * .3, -H - 3); c.stroke();
  // stem and leaves
  c.strokeStyle = '#4E8A24'; c.lineWidth = 1.7;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(sw * .4, -H * .5, sw, -H); c.stroke();
  for (let i = 0; i < 4; i++) {
    const u = (i + 1) / 5, y = -H * u, x = sw * u;
    const s = 3.4 + p * 3.6;
    c.fillStyle = i % 2 ? '#6FB035' : '#4E8A24';
    ell(c, x - s * .9, y, s, s * .62, -.45); c.fill();
    ell(c, x + s * .9, y, s, s * .62, .45); c.fill();
  }
  // fruit, once there is a plant to hang it on
  if (p > .55) {
    const g = (p - .55) / .45;
    for (let i = 0; i < 3; i++) {
      const u = .34 + i * .2, y = -H * u, x = sw * u + (i % 2 ? 4.6 : -4.2);
      const r = (1.6 + g * 2.6) * (i === 1 ? 1.12 : 1);
      c.fillStyle = lg(c, x - r, y - r, x + r, y + r,
        [[0, mix('#FF6A4A', '#FFD08A', .45)], [.55, '#E8452C'], [1, '#8E1E12']]);
      ell(c, x, y, r, r * .94); c.fill(); ink(c, .9, .3);
      c.save(); c.globalAlpha = .5; c.fillStyle = '#FFE0C0';
      ell(c, x - r * .34, y - r * .38, r * .34, r * .26, -.5); c.fill(); c.restore();
    }
  }
};

/** Strawberry — a low crown; the berries hang under the leaves. */
WD.CROP.strawberry = function (c, p, t, k) {
  const H = 4 + p * 13, sw = Math.sin(t * 2.1 + k) * 1.3;
  c.strokeStyle = '#4E8A24'; c.lineWidth = 1.5; c.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * .42, ex = Math.sin(a) * H * .78 + sw, ey = -H * (.62 + Math.cos(a) * .34);
    c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(ex * .4, ey * .7, ex, ey); c.stroke();
    const s = 2.6 + p * 2.4;
    c.fillStyle = i % 2 ? '#6FB035' : '#3E7A1C';
    ell(c, ex, ey, s, s * .72, a * .5); c.fill();
  }
  if (p > .6) {
    const g = (p - .6) / .4;
    for (let i = 0; i < 2; i++) {
      const x = i ? 4.2 : -3.8, y = -2.4 - i * 1.6, r = 1.4 + g * 2.1;
      c.fillStyle = lg(c, x - r, y - r, x + r, y + r,
        [[0, '#FF7E6A'], [.5, '#E03A2E'], [1, '#8C1410']]);
      c.beginPath();
      c.moveTo(x, y + r * 1.32);
      c.quadraticCurveTo(x - r * 1.15, y + r * .18, x - r * .72, y - r * .72);
      c.quadraticCurveTo(x, y - r * 1.1, x + r * .72, y - r * .72);
      c.quadraticCurveTo(x + r * 1.15, y + r * .18, x, y + r * 1.32);
      c.closePath(); c.fill(); ink(c, .85, .3);
      c.fillStyle = '#3E7A1C';
      ell(c, x, y - r * .78, r * .78, r * .34); c.fill();
      c.save(); c.globalAlpha = .55; c.fillStyle = '#FFD9C4';
      ell(c, x - r * .3, y - r * .1, r * .26, r * .34, -.4); c.fill(); c.restore();
    }
  }
};

/** Pumpkin — a sprawling vine with one gourd that swells late. */
WD.CROP.pumpkin = function (c, p, t, k) {
  const sw = Math.sin(t * 1.4 + k) * 1.5;
  c.strokeStyle = '#4E8A24'; c.lineWidth = 1.7; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const dir = i === 1 ? 0 : (i ? 1 : -1);
    const ex = dir * (7 + p * 6) + sw, ey = -3 - p * (i === 1 ? 16 : 7);
    c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(ex * .5, ey * .8, ex, ey); c.stroke();
    const s = 3.6 + p * 4.4;
    c.fillStyle = i % 2 ? '#5E9E2C' : '#3E7A1C';
    ell(c, ex, ey, s, s * .66, dir * .4); c.fill(); ink(c, .8, .22);
  }
  if (p > .45) {
    const g = (p - .45) / .55, r = 2.4 + g * 6.4;
    const x = -1.2, y = -r * .72;
    c.fillStyle = lg(c, x - r, y - r, x + r * .6, y + r,
      [[0, '#FFB84D'], [.5, '#E8801C'], [1, '#96430A']]);
    ell(c, x, y, r, r * .82); c.fill(); ink(c, 1.1, .34);
    c.save(); c.clip ? null : null;
    c.strokeStyle = 'rgba(140,64,8,.42)'; c.lineWidth = 1.1;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(x + i * r * .46, y - r * .78);
      c.quadraticCurveTo(x + i * r * .68, y, x + i * r * .46, y + r * .78);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = '#4E7A1E'; c.lineWidth = 1.9;
    c.beginPath(); c.moveTo(x, y - r * .8); c.lineTo(x + .6, y - r * .8 - 3.4 - g * 2); c.stroke();
    c.save(); c.globalAlpha = .42; c.fillStyle = '#FFE2B0';
    ell(c, x - r * .38, y - r * .34, r * .3, r * .42, -.4); c.fill(); c.restore();
  }
};

/* ================= ITEM ICONS ================= *
 * 64x64, standing on the ground at y≈52 like the originals.                  */

ICON.tomato = function (c) {
  contact(c, 32, 53, 15, 4.2, .3);
  c.fillStyle = lg(c, 16, 20, 48, 50,
    [[0, '#FF8163'], [.45, '#E8452C'], [1, '#8E1E12']]);
  ell(c, 32, 36, 17, 15.4); c.fill(); ink(c, 2.2, .42);
  c.save(); c.globalAlpha = .45; c.fillStyle = '#FFD4BE';
  ell(c, 25, 28, 6.4, 4.4, -.5); c.fill(); c.restore();
  c.save(); c.globalAlpha = .3; c.strokeStyle = '#7E1408'; c.lineWidth = 2;
  for (let i = -1; i <= 1; i += 2) {
    c.beginPath(); c.moveTo(32 + i * 7, 23); c.quadraticCurveTo(32 + i * 11, 36, 32 + i * 7, 49); c.stroke();
  }
  c.restore();
  c.fillStyle = '#3E7A1C';
  for (let i = 0; i < 5; i++) {
    const a = i * 1.256;
    ell(c, 32 + Math.cos(a) * 6.4, 21 + Math.sin(a) * 3.2, 5, 2.4, a); c.fill();
  }
  c.strokeStyle = '#4E7A1E'; c.lineWidth = 2.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(32, 20); c.lineTo(33, 13); c.stroke();
};

ICON.strawberry = function (c) {
  contact(c, 32, 53, 13, 4, .3);
  c.fillStyle = lg(c, 18, 20, 46, 52, [[0, '#FF7E6A'], [.48, '#E03A2E'], [1, '#8C1410']]);
  c.beginPath();
  c.moveTo(32, 52);
  c.quadraticCurveTo(14, 40, 17, 27);
  c.quadraticCurveTo(22, 18, 32, 20);
  c.quadraticCurveTo(42, 18, 47, 27);
  c.quadraticCurveTo(50, 40, 32, 52);
  c.closePath(); c.fill(); ink(c, 2.2, .42);
  c.fillStyle = 'rgba(255,232,190,.85)';
  for (let i = 0; i < 11; i++) {
    const s = prng(i * 17);
    ell(c, 21 + s * 22, 25 + prng(i * 7) * 21, 1.7, 2.4, s * 3); c.fill();
  }
  c.save(); c.globalAlpha = .4; c.fillStyle = '#FFD9C4';
  c.beginPath(); c.moveTo(22, 38); c.quadraticCurveTo(19, 28, 27, 22);
  c.quadraticCurveTo(23, 31, 25, 40); c.closePath(); c.fill(); c.restore();
  c.fillStyle = '#3E7A1C';
  for (let i = 0; i < 5; i++) {
    const a = -1.1 + i * .55;
    ell(c, 32 + Math.cos(a) * 9, 19 + Math.sin(a) * 3.4, 7, 3, a * .6); c.fill();
  }
  ink(c, 1.3, .28);
  c.strokeStyle = '#4E7A1E'; c.lineWidth = 2.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(32, 18); c.lineTo(34, 11); c.stroke();
};

ICON.pumpkin = function (c) {
  contact(c, 32, 53, 17, 4.6, .32);
  c.fillStyle = lg(c, 15, 22, 49, 52, [[0, '#FFB84D'], [.48, '#E8801C'], [1, '#96430A']]);
  ell(c, 32, 37, 19, 15.6); c.fill(); ink(c, 2.2, .42);
  c.save(); c.globalAlpha = .34; c.strokeStyle = '#8C3F06'; c.lineWidth = 2.2;
  for (const dx of [-9, 0, 9]) {
    c.beginPath();
    c.moveTo(32 + dx * .72, 22.4);
    c.quadraticCurveTo(32 + dx * 1.24, 37, 32 + dx * .72, 51.4);
    c.stroke();
  }
  c.restore();
  c.save(); c.globalAlpha = .42; c.fillStyle = '#FFE7BE';
  ell(c, 24, 29, 6.6, 4.6, -.45); c.fill(); c.restore();
  c.fillStyle = lg(c, 28, 12, 38, 24, [[0, '#6FB035'], [1, '#3A6E18']]);
  rr(c, 29, 13, 6.4, 11, 2.4); c.fill(); ink(c, 1.6, .34);
  c.strokeStyle = '#4E7A1E'; c.lineWidth = 2.2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(35, 16); c.quadraticCurveTo(44, 12, 41, 21); c.stroke();
};

ICON.cheese = function (c) {
  contact(c, 32, 51, 16, 4.2, .3);
  // wedge: a triangle with a rind and a lit top face
  c.fillStyle = lg(c, 12, 30, 52, 50, [[0, '#FFD866'], [.5, '#F0B428'], [1, '#B37A0A']]);
  poly(c, [[12, 48], [52, 40], [46, 24], [12, 34]]); c.fill(); ink(c, 2.2, .42);
  c.fillStyle = lg(c, 12, 24, 50, 40, [[0, '#FFF0B4'], [1, '#FFD154']]);
  poly(c, [[12, 34], [46, 24], [40, 20], [12, 30]]); c.fill(); ink(c, 1.6, .3);
  c.fillStyle = 'rgba(150,96,6,.42)';
  for (let i = 0; i < 6; i++) {
    const s = prng(i * 19);
    ell(c, 19 + s * 26, 33 + prng(i * 11) * 11, 2.6 + s * 1.8, 2.2 + s * 1.4); c.fill();
  }
  c.save(); c.globalAlpha = .45; c.fillStyle = '#FFF6D6';
  poly(c, [[14, 33], [30, 28], [30, 31], [14, 36]]); c.fill(); c.restore();
};

ICON.soup = function (c) {
  contact(c, 32, 53, 17, 4.4, .3);
  // broth first, then the bowl in front of it
  c.fillStyle = lg(c, 18, 26, 46, 36, [[0, '#FFB24D'], [1, '#D9631A']]);
  ell(c, 32, 32, 16.4, 5.4); c.fill();
  c.fillStyle = 'rgba(90,168,40,.75)';
  for (let i = 0; i < 5; i++) {
    const s = prng(i * 23);
    ell(c, 22 + s * 20, 30 + prng(i * 9) * 4, 2.4, 1.5, s * 3); c.fill();
  }
  c.fillStyle = lg(c, 14, 30, 50, 50, [[0, '#F4F0E6'], [.5, '#D8D0BE'], [1, '#8E8472']]);
  c.beginPath();
  c.moveTo(15, 31); c.quadraticCurveTo(18, 50, 32, 50);
  c.quadraticCurveTo(46, 50, 49, 31);
  c.quadraticCurveTo(32, 38, 15, 31);
  c.closePath(); c.fill(); ink(c, 2.2, .42);
  c.fillStyle = '#C4402E'; rr(c, 13, 28, 38, 4.6, 2.2); c.fill(); ink(c, 1.4, .3);
  c.save(); c.globalAlpha = .4; c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(20, 34); c.quadraticCurveTo(21, 45, 28, 48);
  c.quadraticCurveTo(21, 45, 19, 34); c.closePath(); c.fill(); c.restore();
  // steam
  c.save(); c.globalAlpha = .32; c.strokeStyle = '#fff'; c.lineWidth = 2.4; c.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.moveTo(32 + i * 8, 24);
    c.quadraticCurveTo(32 + i * 8 + 4, 17, 32 + i * 8, 11);
    c.stroke();
  }
  c.restore();
};

ICON.jam = function (c) {
  contact(c, 32, 53, 13, 4, .3);
  // jar
  c.fillStyle = lg(c, 19, 22, 45, 50, [[0, '#E8F2F6'], [.45, '#BBD6E2'], [1, '#7C9EAC']]);
  rr(c, 19, 22, 26, 29, 5); c.fill(); ink(c, 2.2, .42);
  // preserve inside
  c.save();
  rr(c, 21, 28, 22, 21, 3.6); c.clip();
  c.fillStyle = lg(c, 21, 28, 43, 49, [[0, '#E8452C'], [1, '#7E1010']]);
  c.fillRect(21, 28, 22, 21);
  c.fillStyle = 'rgba(255,190,170,.4)';
  for (let i = 0; i < 7; i++) {
    const s = prng(i * 29);
    ell(c, 23 + s * 18, 31 + prng(i * 13) * 15, 2.2, 1.7, s * 3); c.fill();
  }
  c.restore();
  // lid and its cloth
  c.fillStyle = lg(c, 17, 14, 47, 24, [[0, '#F0C271'], [1, '#A8722A']]);
  rr(c, 17, 15, 30, 9, 3); c.fill(); ink(c, 1.8, .38);
  c.strokeStyle = 'rgba(90,54,10,.5)'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(19, 24); c.lineTo(45, 24); c.stroke();
  c.save(); c.globalAlpha = .45; c.fillStyle = '#fff';
  poly(c, [[22, 48], [22, 30], [26, 27], [26, 46]]); c.fill(); c.restore();
};

ICON.pie = function (c) {
  contact(c, 32, 52, 18, 4.6, .32);
  // dish
  c.fillStyle = lg(c, 12, 38, 52, 50, [[0, '#E4DACA'], [1, '#9A8E78']]);
  c.beginPath();
  c.moveTo(12, 38); c.quadraticCurveTo(15, 50, 32, 50);
  c.quadraticCurveTo(49, 50, 52, 38); c.closePath(); c.fill(); ink(c, 2, .4);
  // crust
  c.fillStyle = lg(c, 14, 24, 50, 42, [[0, '#F2C97E'], [.5, '#D99942'], [1, '#96591B']]);
  ell(c, 32, 36, 20, 9.4); c.fill(); ink(c, 2.2, .42);
  // filling through the lattice
  c.save(); ell(c, 32, 35, 15.6, 6.6); c.clip();
  c.fillStyle = lg(c, 18, 28, 46, 42, [[0, '#FFA43C'], [1, '#C25A0C']]);
  c.fillRect(14, 26, 36, 18);
  c.strokeStyle = '#E8C07A'; c.lineWidth = 3.2; c.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    c.beginPath(); c.moveTo(32 + i * 7 - 7, 26); c.lineTo(32 + i * 7 + 7, 44); c.stroke();
    c.beginPath(); c.moveTo(32 + i * 7 + 7, 26); c.lineTo(32 + i * 7 - 7, 44); c.stroke();
  }
  c.restore();
  // crimped rim
  c.strokeStyle = 'rgba(120,66,14,.5)'; c.lineWidth = 1.6;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + i * (Math.PI / 11);
    c.beginPath();
    c.moveTo(32 + Math.cos(a) * 20, 36 + Math.sin(a) * 9.4);
    c.lineTo(32 + Math.cos(a) * 15.4, 36 + Math.sin(a) * 7.2);
    c.stroke();
  }
  c.save(); c.globalAlpha = .35; c.fillStyle = '#FFF0CE';
  ell(c, 24, 31, 6.6, 2.6, -.28); c.fill(); c.restore();
};

/* ================= BUILDING ================= */

/**
 * The Kitchen. A cottage with a stove pipe, a window over the sink and a
 * chalkboard by the door — built from the same house() the bakery and dairy
 * stand on, so it belongs to the same row of workshops.
 */
WD.BLD.kitchen = function (c, t) {
  const w = 1.2, d = 1.1, h = .74, rise = .36;
  c.save();
  // Green: the barn and cow shelter are red, the bakery terracotta, the dairy
  // blue and the sugar mill grey. A player picks a building out of the yard by
  // its colour before its shape, so the fifth one cannot borrow a fourth's.
  const an = house(c, w, d, h, '#EDE0CE', '#3F7A34', rise, .1);

  /* gable end: window over a sill, with a pot on it */
  c.save(); faceR(c, w, d);
  windowPane(c, -13, -h * HZ * .82, 26, 19);
  c.fillStyle = '#A8763E'; rr(c, -16, -h * HZ * .82 + 19, 32, 4.4, 1.6); c.fill(); ink(c, 1.4, .32);
  c.fillStyle = lg(c, -6, -h * HZ * .82 + 12, 6, -h * HZ * .82 + 19, [[0, '#C4402E'], [1, '#7E2114']]);
  rr(c, -5.5, -h * HZ * .82 + 12, 11, 7.4, 2); c.fill();
  c.fillStyle = '#5E9E2C';
  for (let i = -1; i <= 1; i++) ell(c, i * 3.4, -h * HZ * .82 + 11, 3.4, 2.2, i * .5), c.fill();
  /* chalkboard menu in the gable */
  c.fillStyle = '#3A2A16'; rr(c, -14, -h * HZ - rise * HZ * .62, 28, 12, 2.6); c.fill(); ink(c, 1.4, .34);
  c.strokeStyle = 'rgba(240,236,222,.75)'; c.lineWidth = 1.5; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const y = -h * HZ - rise * HZ * .62 + 4 + i * 3;
    c.beginPath(); c.moveTo(-10, y); c.lineTo(-10 + (i === 2 ? 12 : 20), y); c.stroke();
  }
  c.restore();

  /* long wall: door, and a crate of vegetables beside it */
  c.save(); faceL(c, w, d);
  c.fillStyle = lg(c, -12, -46, 12, 0, [[0, '#B8814A'], [1, '#6E4520']]);
  rr(c, -13, -44, 26, 44, 3); c.fill(); ink(c, 1.8, .42);
  c.fillStyle = 'rgba(255,240,210,.16)'; rr(c, -9, -40, 18, 17, 2); c.fill();
  c.fillStyle = '#F0C271'; ell(c, 8, -21, 2.4, 2.4); c.fill();
  c.fillStyle = lg(c, 20, -18, 44, 0, [[0, '#C89A5E'], [1, '#7E5426']]);
  rr(c, 21, -17, 24, 17, 2.2); c.fill(); ink(c, 1.5, .34);
  c.fillStyle = '#E8452C'; ell(c, 27, -18, 4, 3.6); c.fill();
  c.fillStyle = '#E8801C'; ell(c, 34, -19, 4.4, 3.8); c.fill();
  c.fillStyle = '#5E9E2C'; ell(c, 40, -18, 4, 3.4); c.fill();
  c.restore();

  /* stove pipe on the ridge, drawing steadily */
  c.save(); c.translate(an.ridgeMid[0] - 20, an.ridgeMid[1] + 6);
  c.fillStyle = lg(c, -7, 0, 7, 0, [[0, '#6E6A62'], [.4, '#A6A29A'], [1, '#4A463E']]);
  rr(c, -7, -30, 14, 34, 2); c.fill(); ink(c, 1.6, .36);
  c.fillStyle = '#57534B'; rr(c, -9.5, -34, 19, 6, 2); c.fill(); ink(c, 1.4, .34);
  for (let i = 0; i < 4; i++) {
    const ph = (t * .34 + i * .25) % 1;
    c.save(); c.globalAlpha = (1 - ph) * .4; c.fillStyle = '#EFEAE0';
    ell(c, Math.sin(ph * 3.4 + i) * 10, -38 - ph * 52, 5.4 + ph * 12, 4.6 + ph * 10); c.fill();
    c.restore();
  }
  c.restore();
  c.restore();
};

export const EXTRA_ART_LOADED = true;
