#!/usr/bin/env node
/**
 * Render the brand SVGs to the raster sizes the web needs.
 *
 *   npm i -D playwright && node frontend/scripts/build-brand-assets.mjs
 *
 * The SVGs in public/brand are the source of truth; everything here is
 * generated from them, so the PNGs are never mystery binaries that drift out
 * of step with the vectors. Re-run after touching a brand SVG.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const brand = resolve(root, 'public/brand');
const app = resolve(root, 'app');

const svg = (name) => readFileSync(resolve(brand, name), 'utf8');

/** One SVG, centred on a transparent or filled square. */
function iconPage(name, size, background = 'transparent', pad = 0) {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};
display:grid;place-items:center;overflow:hidden}
svg{width:${size - pad * 2}px;height:${size - pad * 2}px;display:block}</style>
${svg(name)}`;
}

/** The social card: the stacked lockup on the brand's own ink. */
function socialPage() {
  return `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
/* Deeper than the tile's own ink, so the mark reads as a card sitting on the
   ground rather than dissolving into it. */
body{background:#170C02;display:grid;place-items:center;font-family:system-ui,sans-serif}
body::before{content:"";position:absolute;inset:0;
background:radial-gradient(ellipse at 50% 32%, rgba(246,201,79,.22), transparent 60%)}
.card{position:relative;display:grid;place-items:center;gap:26px}
svg{width:520px;height:auto;display:block}
.tag{font-size:26px;font-weight:800;letter-spacing:7px;text-transform:uppercase;color:#F6C94F;opacity:.85}
</style>
<div class="card">${svg('sunmil-logo-stacked-light.svg')}<div class="tag">Farm &amp; Craft Tycoon</div></div>`;
}

/**
 * The X / Twitter header, 1500x500 at 2x.
 *
 * Composed for where the platform actually puts things: the profile picture
 * overlaps the bottom-left, so nothing readable goes below y=380 on that side,
 * and mobile crops the sides, so the type stays well inside. The mark is blown
 * up and used as a field rather than repeated small — the avatar right next to
 * it is already the logo at logo size.
 */
function headerPage() {
  return `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&display=swap">
<style>
html,body{margin:0;width:1500px;height:500px;overflow:hidden}
body{position:relative;background:#170C02;
  font-family:Fredoka,ui-rounded,system-ui,sans-serif}
.glow{position:absolute;inset:0;
  background:radial-gradient(64% 130% at 90% 50%, rgba(246,201,79,.22), transparent 66%)}
/* Cropped by the right edge on purpose: at this size a complete circle reads
   as a floating sticker, and the whole mark blown up is really just a big X.
   Bleeding it turns the logo into a field. */
.mark{position:absolute;left:1050px;top:-100px;width:700px;height:700px}
.type{position:absolute;left:110px;top:0;height:500px;display:flex;
  flex-direction:column;justify-content:center;padding-bottom:86px}
.wm{display:block;width:640px;height:auto}
.tag{margin-top:26px;font-size:27px;font-weight:600;letter-spacing:.34em;
  text-transform:uppercase;color:#F6C94F}
/* Above the wordmark, not below it: the profile picture sits over the header's
   bottom-left corner, and anything down there is covered on a real profile. */
.dom{margin-bottom:20px;font-size:23px;font-weight:500;letter-spacing:.08em;
  color:rgba(255,244,212,.55)}
</style>
<div class="glow"></div>
<div class="mark">${svg('sunmil-avatar.svg').replace('<rect width="512" height="512" fill="#2C1705"/>', '')}</div>
<div class="type">
  <div class="dom">sunmil.fun</div>
  <svg class="wm" viewBox="-16 -16 594 132" fill="none" stroke="#FFF4D4" stroke-width="27"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M68 28 C58 12 20 14 20 34 C20 52 68 50 68 68 C68 88 30 90 20 74"/>
    <path d="M118 14 V58 a27 27 0 0 0 54 0 V14"/>
    <path d="M220 86 V14 L274 86 V14"/>
    <path d="M322 86 V14 L362 52 L402 14 V86"/>
    <path d="M450 14 V86"/>
    <path d="M498 14 V86 H548"/>
  </svg>
  <div class="tag">Farm &amp; Craft Tycoon</div>
</div>`;
}

const JOBS = [
  { file: resolve(app, 'icon.png'), page: iconPage('sunmil-mark-simple.svg', 64), w: 64, h: 64 },
  { file: resolve(app, 'apple-icon.png'), page: iconPage('sunmil-mark.svg', 180, '#2C1705'), w: 180, h: 180 },
  { file: resolve(brand, 'icon-192.png'), page: iconPage('sunmil-mark.svg', 192), w: 192, h: 192 },
  { file: resolve(brand, 'icon-512.png'), page: iconPage('sunmil-mark.svg', 512), w: 512, h: 512 },
  { file: resolve(brand, 'icon-maskable-512.png'), page: iconPage('sunmil-mark.svg', 512, '#2C1705', 56), w: 512, h: 512 },
  { file: resolve(app, 'opengraph-image.png'), page: socialPage(), w: 1200, h: 630 },
  // Social profiles. The avatar is rendered opaque: every platform masks it to
  // a circle itself, and a transparent one would show their background through
  // the corners instead of ours.
  { file: resolve(brand, 'social/x-avatar.png'), page: iconPage('sunmil-avatar.svg', 1000), w: 1000, h: 1000, opaque: true },
  { file: resolve(brand, 'social/x-header.png'), page: headerPage(), w: 1500, h: 500, scale: 2 },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
);

for (const job of JOBS) {
  const page = await browser.newPage({
    viewport: { width: job.w, height: job.h },
    deviceScaleFactor: job.scale ?? 1,
  });
  await page.setContent(job.page, { waitUntil: 'load' });
  // Long enough for a linked webfont to arrive before the shutter.
  await page.waitForTimeout(job.scale ? 900 : 120);
  mkdirSync(dirname(job.file), { recursive: true });
  await page.screenshot({ path: job.file, omitBackground: !job.opaque });
  await page.close();
  console.log('wrote', job.file.replace(root + '/', ''));
}

// The maskable icon must be opaque, so Android does not punch a hole in it.
await browser.close();

writeFileSync(resolve(root, 'public/manifest.webmanifest'), JSON.stringify({
  name: 'SUNMIL — Farm & Craft Tycoon',
  short_name: 'SUNMIL',
  description: 'A production-chain farm on Solana.',
  start_url: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#2C1705',
  theme_color: '#F6C94F',
  icons: [
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/brand/sunmil-mark.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
}, null, 2) + '\n');
console.log('wrote public/manifest.webmanifest');
