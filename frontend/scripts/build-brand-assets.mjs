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

const JOBS = [
  { file: resolve(app, 'icon.png'), page: iconPage('sunmil-mark-simple.svg', 64), w: 64, h: 64 },
  { file: resolve(app, 'apple-icon.png'), page: iconPage('sunmil-mark.svg', 180, '#2C1705'), w: 180, h: 180 },
  { file: resolve(brand, 'icon-192.png'), page: iconPage('sunmil-mark.svg', 192), w: 192, h: 192 },
  { file: resolve(brand, 'icon-512.png'), page: iconPage('sunmil-mark.svg', 512), w: 512, h: 512 },
  { file: resolve(brand, 'icon-maskable-512.png'), page: iconPage('sunmil-mark.svg', 512, '#2C1705', 56), w: 512, h: 512 },
  { file: resolve(app, 'opengraph-image.png'), page: socialPage(), w: 1200, h: 630 },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
);

for (const job of JOBS) {
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  await page.setContent(job.page, { waitUntil: 'load' });
  await page.waitForTimeout(120);
  mkdirSync(dirname(job.file), { recursive: true });
  await page.screenshot({ path: job.file, omitBackground: true });
  await page.close();
  console.log('wrote', job.file.replace(root + '/', ''));
}

// The maskable icon must be opaque, so Android does not punch a hole in it.
await browser.close();

writeFileSync(resolve(root, 'public/manifest.webmanifest'), JSON.stringify({
  name: 'SUNMIL — Farm & Craft Tycoon',
  short_name: 'SUNMIL',
  description: 'A production-chain farm on Robinhood Chain.',
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
