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

/** The social card: the stacked lockup on the game's own sky. */
function socialPage() {
  return `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:linear-gradient(#5AA8D8,#8FCBE8 46%,#3E7A2A);
display:grid;place-items:center;font-family:system-ui,sans-serif}
.card{display:grid;place-items:center;gap:22px}
svg{width:520px;height:auto;display:block;filter:drop-shadow(0 10px 26px rgba(30,20,8,.28))}
.tag{font-size:26px;font-weight:800;letter-spacing:7px;text-transform:uppercase;color:#FFF4D4;
text-shadow:0 2px 0 rgba(60,36,10,.35)}
</style>
<div class="card">${svg('sunmill-logo-stacked-light.svg')}<div class="tag">Farm &amp; Craft Tycoon</div></div>`;
}

const JOBS = [
  { file: resolve(app, 'icon.png'), page: iconPage('sunmill-mark-simple.svg', 64), w: 64, h: 64 },
  { file: resolve(app, 'apple-icon.png'), page: iconPage('sunmill-mark.svg', 180, '#F6C94F'), w: 180, h: 180 },
  { file: resolve(brand, 'icon-192.png'), page: iconPage('sunmill-mark.svg', 192), w: 192, h: 192 },
  { file: resolve(brand, 'icon-512.png'), page: iconPage('sunmill-mark.svg', 512), w: 512, h: 512 },
  { file: resolve(brand, 'icon-maskable-512.png'), page: iconPage('sunmill-mark.svg', 512, '#F6C94F', 56), w: 512, h: 512 },
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
  name: 'SUNMILL — Farm & Craft Tycoon',
  short_name: 'SUNMILL',
  description: 'A production-chain farm on Robinhood Chain.',
  start_url: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#8FCBE8',
  theme_color: '#F6C94F',
  icons: [
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/brand/sunmill-mark.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
}, null, 2) + '\n');
console.log('wrote public/manifest.webmanifest');
