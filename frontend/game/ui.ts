// @ts-nocheck
/**
 * SUNMIL — HUD, dock, side rail, panels and input.
 *
 * Ported from the prototype's ui.js and grown since. The markup and CSS
 * classes are unchanged where the prototype had them — that is the visual
 * identity — and everything added (tasks, upgrades, the leaderboard, the away
 * card) follows the same shapes.
 *
 * Every button calls the API and re-renders from the returned snapshot; the
 * server response always wins (HANDOFF §8). Nothing here knows a price or a
 * duration, and no string is hardcoded English — display text comes from
 * i18n.ts, and server notices arrive as codes that localise here.
 */
import { ART as A, ICON } from './art';
import { api, NetError } from './net';
import {
  apply, capK, cfg, coins, hasAll, hay, inv, item, itemName, level, machineCfg,
  machineName, machineView, penCfg, penName, penView, progress, S, sellables,
  serverNow, snap, streak, tasks, usedK,
} from './state';
import { duration, errorText, getLang, initLang, LANGS, noticeText, setLang, t } from './i18n';
import { isEnabled as soundOn, setEnabled as setSound, sfx, unlockAudio } from './audio';
import { refreshGuide, startGuide, stopGuide, taskGuideSteps } from './guide';
import { SITE_DOMAIN } from './brand';
import { setJoystickVisible } from './joystick';
import { enablePush, markPushDeclined, pushOfferText } from './push';
import { fx, sendFarmer, w2s, FIELD_POS } from './render';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/* ---- render a procedural icon into a small canvas ---- */
function iconCanvas(id, px) {
  const c = el('canvas'); c.width = px * 2; c.height = px * 2;
  const g = c.getContext('2d'); g.scale(px * 2 / 64, px * 2 / 64);
  try { (ICON[id] || function () {})(g) } catch (e) { /* unknown icon */ }
  c.style.width = px + 'px'; c.style.height = px + 'px';
  return c;
}

function coinBadge() {
  return '<circle cx="32" cy="32" r="24" fill="#F0C355" stroke="#B8801E" stroke-width="3"/>'
    + '<circle cx="32" cy="32" r="17" fill="#FFE9A8" stroke="#D9A825" stroke-width="1.5"/>'
    + '<path d="M32 22 l2.6 6 6.4.4 -5 4.2 1.7 6.2 -5.7-3.6 -5.7 3.6 1.7-6.2 -5-4.2 6.4-.4Z" fill="#C98A12"/>';
}
function hayBadge() {
  return '<path d="M32 8 L52 20 L52 44 L32 56 L12 44 L12 20 Z" fill="#9B5CF0" stroke="#5B21A8" stroke-width="3"/>'
    + '<path d="M32 20 v22 M32 26 l-6-3 M32 26 l6-3 M32 34 l-6-3 M32 34 l6-3" stroke="#FFE9A8" stroke-width="3" fill="none" stroke-linecap="round"/>';
}
const coinSvg = (px) => `<svg viewBox="0 0 64 64" style="width:${px}px;height:${px}px">${coinBadge()}</svg>`;
const haySvg = (px) => `<svg viewBox="0 0 64 64" style="width:${px}px;height:${px}px">${hayBadge()}</svg>`;

/* ================= ACTION WRAPPER ================= */

/**
 * Every mutation goes through here: one request at a time, the response is
 * applied wholesale, and anything the server wants said gets said in the
 * player's language.
 */
async function act(run, sound) {
  if (S.busy) return null;
  S.busy = true;
  try {
    const snapshot = await run();
    if (snapshot) {
      apply(snapshot);
      if (sound) sound();
      if (snapshot.notice) {
        toast(noticeText(snapshot.notice), ICON[snapshot.notice.icon] || ICON.coin, snapshot.notice.bad);
        if (snapshot.notice.bad) sfx.deny();
      }
      if (snapshot.levelsGained) for (const lvl of snapshot.levelsGained) showLevelUp(lvl);
    }
    syncHUD(); syncBadges(); refreshOpenPanel(); refreshGuide();
    return snapshot;
  } catch (err) {
    sfx.deny();
    if (err instanceof NetError) toast(errorText(err.code, err.message), ICON.coin, true);
    else toast(t('error.offline'), ICON.coin, true);
    // Re-sync so an optimistic paint never lingers after a refusal.
    try { apply(await api.farm()); syncHUD(); syncBadges(); refreshOpenPanel() } catch (e) { /* offline */ }
    return null;
  } finally {
    S.busy = false;
  }
}

/* ================= HUD ================= */

export function buildHUD() {
  const h = $('#hud'); h.innerHTML = '';
  const lvl = el('div', 'lvl');
  lvl.innerHTML = '<svg viewBox="0 0 60 60"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#F0C355"/><stop offset="1" stop-color="#B8801E"/></linearGradient></defs>'
    + '<circle cx="30" cy="30" r="26" fill="url(#lg)" stroke="#5C3618" stroke-width="3"/>'
    + '<circle cx="30" cy="30" r="20" fill="none" stroke="#FFF3CC" stroke-width="2" opacity=".5"/></svg>'
    + '<b id="lvlNum">1</b><i>LVL</i>';
  // The level badge is the way into "you": name, ranking and settings.
  lvl.style.cursor = 'pointer';
  lvl.addEventListener('pointerdown', function (e) { e.stopPropagation(); sfx.tap(); renderProfile() });
  h.appendChild(lvl);

  const chips = el('div', 'chips');
  chips.innerHTML =
    '<div class="chip cap" id="chSilo"><svg viewBox="0 0 24 24">'
    + '<path d="M5 9 A7 3 0 0 1 19 9 L19 7 A7 3 0 0 0 5 7 Z" fill="#D9A94A" stroke="#8A5410" stroke-width="1.4"/>'
    + '<rect x="5" y="8" width="14" height="13" rx="1" fill="#DCE4EA" stroke="#8090A0" stroke-width="1.4"/>'
    + '<rect x="10" y="13" width="4" height="8" fill="#8A5410"/></svg>'
    + '<div class="cap-wrap"><span class="cap-txt num" id="siloTxt">0/60</span>'
    + '<div class="cap-bar"><div class="cap-fill" id="siloFill"></div></div></div></div>'
    + '<div class="chip cap" id="chBarn"><svg viewBox="0 0 24 24">'
    + '<path d="M3 10 L12 4 L21 10 L21 21 L3 21 Z" fill="#C4402E" stroke="#7E1E12" stroke-width="1.4"/>'
    + '<path d="M3 10 L12 4 L21 10" fill="none" stroke="#F2E6CC" stroke-width="1.6"/>'
    + '<rect x="9" y="13" width="6" height="8" fill="#F2E6CC"/></svg>'
    + '<div class="cap-wrap"><span class="cap-txt num" id="barnTxt">0/60</span>'
    + '<div class="cap-bar"><div class="cap-fill" id="barnFill"></div></div></div></div>'
    + '<div class="chip" id="chCoin">' + coinSvg(22) + '<span id="coinTxt">0</span></div>'
    + '<div class="chip" id="chHay">' + haySvg(22) + '<span id="hayTxt">0</span></div>';
  h.appendChild(chips);
  $('#chSilo').addEventListener('pointerdown', function (e) { e.stopPropagation(); sfx.tap(); renderStorage() });
  $('#chBarn').addEventListener('pointerdown', function (e) { e.stopPropagation(); sfx.tap(); renderStorage() });
  syncHUD();
}

export function syncHUD() {
  if (!S.snap) return;
  const silo = usedK('silo'), barn = usedK('barn');
  set('#lvlNum', level());
  set('#coinTxt', fmt(coins()));
  set('#hayTxt', String(Math.round(hay() * 100) / 100));
  set('#siloTxt', silo + '/' + capK('silo'));
  set('#barnTxt', barn + '/' + capK('barn'));
  bar('#siloFill', silo / capK('silo'));
  bar('#barnFill', barn / capK('barn'));
}
function bar(sel, f) {
  const e = $(sel); if (!e) return;
  e.style.width = Math.min(100, f * 100) + '%';
  e.className = 'cap-fill' + (f >= 1 ? ' full' : f > .8 ? ' warn' : '');
}
function set(sel, v) { const e = $(sel); if (e) e.textContent = v }
function fmt(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n) }

/* ================= DOCK (seed tray) ================= */

export function buildDock() {
  const d = $('#dockInner'); d.innerHTML = '';
  for (const id of cfg().crops) {
    const it = item(id), lk = level() < (it.lvl || 1);
    const s = el('div', 'seed' + (S.sel === id ? ' sel' : '') + (lk ? ' lock' : ''));
    s.appendChild(iconCanvas(id, 44));
    s.appendChild(el('div', 'nm', itemName(id)));
    const pr = el('div', 'pr'); pr.innerHTML = coinSvg(15) + it.seed;
    s.appendChild(pr);
    s.appendChild(el('div', 'tm', duration(it.growSeconds)));
    if (lk) s.appendChild(el('div', 'lk', t('common.locked', { n: it.lvl })));
    else {
      s.addEventListener('pointerdown', function (ev) {
        ev.stopPropagation(); sfx.tap();
        S.sel = id; S.seedChosen = true;
        buildDock(); refreshGuide();
      });
    }
    d.appendChild(s);
  }
}

/* ================= SIDE RAIL ================= */

const RAIL_ICONS = {
  orders: '<svg viewBox="0 0 40 40"><rect x="4" y="12" width="22" height="16" rx="2" fill="#E0C68E" stroke="#8A5410" stroke-width="2"/>'
    + '<path d="M26 16 h6 l4 5 v7 h-10 Z" fill="#C4402E" stroke="#7E1E12" stroke-width="2"/>'
    + '<circle cx="11" cy="30" r="3.4" fill="#3A3128" stroke="#000" stroke-width="1.5"/>'
    + '<circle cx="30" cy="30" r="3.4" fill="#3A3128" stroke="#000" stroke-width="1.5"/></svg>',
  market: '<svg viewBox="0 0 40 40"><path d="M6 14 h28 l-2 -6 h-24 Z" fill="#3A8FC4" stroke="#1B6E96" stroke-width="2"/>'
    + '<rect x="7" y="14" width="26" height="4" fill="#C4A468"/>'
    + '<rect x="8" y="18" width="24" height="14" rx="2" fill="#E0C68E" stroke="#8A5410" stroke-width="2"/>'
    + '<rect x="12" y="8" width="4" height="6" fill="#F2E6CC"/><rect x="24" y="8" width="4" height="6" fill="#F2E6CC"/></svg>',
  tasks: '<svg viewBox="0 0 40 40"><rect x="8" y="6" width="24" height="28" rx="3" fill="#F2E6CC" stroke="#8A5410" stroke-width="2"/>'
    + '<path d="M13 15 l3 3 6-6" fill="none" stroke="#3E8A1C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M13 25 l3 3 6-6" fill="none" stroke="#A98A5E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M25 16 h4 M25 26 h4" stroke="#A98A5E" stroke-width="2" stroke-linecap="round"/></svg>',
  storage: '<svg viewBox="0 0 40 40"><rect x="6" y="10" width="28" height="24" rx="3" fill="#C4A468" stroke="#7E5A1E" stroke-width="2"/>'
    + '<path d="M6 18 h28 M20 10 v24" stroke="#7E5A1E" stroke-width="2"/>'
    + '<rect x="10" y="13" width="4" height="3" fill="#8A5410"/></svg>',
  build: '<svg viewBox="0 0 40 40"><path d="M20 6 l4 4 -6 6 -4-4 Z" fill="#B8BCC0" stroke="#5E6468" stroke-width="2"/>'
    + '<path d="M18 12 L8 22 a3 3 0 0 0 0 4 l2 2 a3 3 0 0 0 4 0 l10-10 Z" fill="#C4923A" stroke="#7E5A1E" stroke-width="2"/></svg>',
};

export function buildRail() {
  const r = $('#rail'); r.innerHTML = '';
  r.appendChild(railBtn('orders', RAIL_ICONS.orders, t('rail.orders')));
  r.appendChild(railBtn('market', RAIL_ICONS.market, t('rail.market')));
  r.appendChild(railBtn('tasks', RAIL_ICONS.tasks, t('rail.tasks')));
  r.appendChild(railBtn('storage', RAIL_ICONS.storage, t('rail.storage')));
  r.appendChild(railBtn('build', RAIL_ICONS.build, t('rail.expand')));
  syncBadges();
}
function railBtn(id, svg, tag) {
  const b = el('div', 'rbtn'); b.id = 'rb_' + id; b.innerHTML = svg;
  b.appendChild(el('div', 'tag', tag));
  const bd = el('div', 'badge'); bd.id = 'bd_' + id; bd.style.display = 'none'; b.appendChild(bd);
  b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); sfx.tap(); openPanel(id) });
  return b;
}
export function syncBadges() {
  if (!S.snap) return;
  badge('orders', snap().orders.filter(function (o) { return o.canFill }).length);
  // Anything claimable, plus the streak if today's reward is still waiting.
  const claimable = tasks().filter(function (task) { return task.done && !task.claimed }).length;
  badge('tasks', claimable + (streak() && !streak().claimedToday ? 1 : 0));
}
function badge(id, n) {
  const b = $('#bd_' + id); if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = 'grid' } else b.style.display = 'none';
}

/* ================= MODAL FRAME ================= */

function openPanel(kind) {
  if (!S.snap) return;
  if (kind === 'orders') return renderOrders();
  if (kind === 'market') return openMarket();
  if (kind === 'tasks') return renderTasks();
  if (kind === 'storage') return renderStorage();
  if (kind === 'build') return openBuild();
}

function frame(title, sub, bodyFill) {
  const m = $('#modal');
  m.innerHTML = '<div class="mhead"><h2>' + title + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</h2>'
    + '<button class="mx" id="mClose">&times;</button></div><div class="mbody" id="mBody"></div>';
  $('#mClose').addEventListener('pointerdown', function () { sfx.tap(); closeModal() });
  bodyFill($('#mBody'));
  $('#scrim').classList.add('on');
  setJoystickVisible(false);
  refreshGuide();
}

function closeModal() {
  $('#scrim').classList.remove('on');
  S.openModal = null;
  setJoystickVisible(true);
  refreshGuide();
}

/** Re-paint whichever panel is open after a snapshot lands. */
function refreshOpenPanel() {
  const open = S.openModal;
  if (!open) return;
  if (open === 'orders') return renderOrders();
  if (open === 'market') return renderMarket();
  if (open === 'tasks') return renderTasks();
  if (open === 'storage') return renderStorage();
  if (open === 'build') return renderBuild();
  if (open === 'profile') return renderProfile();
  if (open.startsWith('machine:')) return renderMachine(open.slice(8));
  if (open.startsWith('pen:')) return renderPen(open.slice(4));
}

function reqChips(map) {
  let h = '<div class="reqs">';
  for (const k in map) {
    const have = inv(k), miss = have < map[k];
    h += '<span class="req' + (miss ? ' miss' : '') + '"><span data-ic="' + k + '"></span>' + map[k]
      + ' <span style="opacity:.6">(' + have + ')</span></span>';
  }
  return h + '</div>';
}
function hydrateIcons(root) {
  root.querySelectorAll('[data-ic]').forEach(function (sp) {
    const id = sp.getAttribute('data-ic');
    sp.appendChild(iconCanvas(id, 20));
    sp.removeAttribute('data-ic');
  });
}
function banner(big, sm) {
  const e = el('div', 'empty');
  e.innerHTML = '<div class="big">' + big + '</div><div class="sm">' + sm + '</div>';
  return e;
}

/* ================= SPEED-UP ================= */

/** Refresh the cached prices. Cheap, and only when a panel needs them. */
async function refreshSpeedUp() {
  try { S.speedUp = await api.speedUpQuote() } catch (e) { S.speedUp = null }
}

function speedQuoteFor(kind, key) {
  const q = S.speedUp;
  if (!q) return null;
  if (kind === 'tile') return q.tiles.find(function (x) { return x.index === key }) || null;
  if (kind === 'machine') return q.machines.find(function (x) { return x.machine === key }) || null;
  return q.pens.find(function (x) { return x.pen === key }) || null;
}

/** The purple "finish now" button, shared by tiles, machines and pens. */
function speedButton(kind, key, onDone) {
  const quote = speedQuoteFor(kind, key);
  if (!quote) return null;
  const b = el('button', 'speed-btn', haySvg(15) + t('speedup.cost', { hay: quote.hay }));
  const affordable = hay() >= Number(quote.hay);
  if (!affordable) { b.disabled = true; return b }
  b.addEventListener('pointerdown', async function (e) {
    e.stopPropagation();
    const call = kind === 'tile'
      ? function () { return api.speedUpTile(key) }
      : kind === 'machine'
        ? function () { return api.speedUpMachine(key) }
        : function () { return api.speedUpPen(key) };
    const done = await act(call, sfx.spend);
    if (done) { await refreshSpeedUp(); if (onDone) onDone() }
  });
  return b;
}

/* ================= ORDERS PANEL ================= */

export function renderOrders() {
  if (!S.snap) return;
  S.openModal = 'orders';
  frame(t('orders.title'), t('orders.sub'), function (body) {
    const orders = snap().orders;
    if (!orders.length) { body.appendChild(banner(t('orders.empty.big'), t('orders.empty.sm'))); return }
    orders.forEach(function (o) {
      const ticket = el('div', 'ticket');
      let items = '';
      for (const k in o.items) {
        const have = inv(k), ok = have >= o.items[k];
        items += '<div class="oitem"><span data-ic="' + k + '"></span><div class="n ' + (ok ? 'ok' : 'no') + '">'
          + have + '/' + o.items[k] + '</div></div>';
      }
      const left = o.expiresAt ? Math.max(0, (Date.parse(o.expiresAt) - serverNow()) / 1000) : null;
      ticket.innerHTML =
        '<div class="tk-top"><span data-ic="_ava"></span><span class="who">' + escape(o.who) + '</span>'
        + '<span class="xpchip">+' + o.xp + ' XP</span></div>'
        + '<div class="tk-mid">' + items + '</div>'
        + '<div class="tk-bot"><div class="rew"><span class="price">' + coinSvg(18) + o.coins + '</span>'
        + '<span class="price hay">' + haySvg(16) + o.hay + '</span></div>'
        + '<button class="btn ' + (o.canFill ? 'gold' : '') + '" ' + (o.canFill ? '' : 'disabled') + ' data-fill="' + o.id + '">'
        + (o.canFill ? t('orders.deliver') : t('orders.missing')) + '</button>'
        + '<button class="btn red" data-skip="' + o.id + '" style="padding:10px 12px">' + t('orders.skip') + '</button></div>'
        + (left != null ? '<div class="t2" style="text-align:right;margin-top:4px;font-size:11px">'
          + t('orders.expires', { time: duration(left) }) + '</div>' : '');
      body.appendChild(ticket);
    });
    body.querySelectorAll('[data-ic="_ava"]').forEach(function (s) {
      s.innerHTML = '<svg viewBox="0 0 24 24" style="width:22px;height:22px"><circle cx="12" cy="9" r="4.4" fill="#E0C68E" stroke="#8A5410" stroke-width="1.5"/><path d="M4 21 a8 7 0 0 1 16 0 Z" fill="#5E86C8" stroke="#2A4680" stroke-width="1.5"/></svg>';
      s.removeAttribute('data-ic');
    });
    hydrateIcons(body);
    body.querySelectorAll('[data-fill]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        act(function () { return api.deliverOrder(b.getAttribute('data-fill')) }, sfx.coins);
      });
    });
    body.querySelectorAll('[data-skip]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        act(function () { return api.skipOrder(b.getAttribute('data-skip')) }, sfx.tap);
      });
    });
  });
}

/* ================= MARKET PANEL ================= */

async function openMarket() {
  try { S.market = await api.market() } catch (e) { /* render whatever we have */ }
  renderMarket();
}

export function renderMarket() {
  if (!S.snap) return;
  S.openModal = 'market';
  frame(t('market.title'), t('market.sub'), function (body) {
    const tabs = el('div', '',
      '<div style="display:flex;gap:8px;margin-bottom:12px">'
      + '<button class="btn ' + (S.marketTab === 'buy' ? 'gold' : 'wood') + '" data-tab="buy" style="flex:1">' + t('market.buy') + '</button>'
      + '<button class="btn ' + (S.marketTab === 'sell' ? 'gold' : 'wood') + '" data-tab="sell" style="flex:1">' + t('market.sell') + '</button></div>');
    body.appendChild(tabs);
    tabs.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        sfx.tap(); S.marketTab = b.getAttribute('data-tab'); renderMarket();
      });
    });
    const list = el('div'); body.appendChild(list);
    if (S.marketTab === 'buy') marketBuy(list); else marketSell(list);
  });
}

function marketBuy(list) {
  const listings = (S.market && S.market.listings) || [];
  if (!listings.length) { list.appendChild(banner(t('market.quiet.big'), t('market.quiet.sm'))); return }
  listings.forEach(function (m) {
    const row = el('div', 'row' + (m.qty <= 0 ? ' dim' : ''));
    row.appendChild(iconCanvas(m.item, 46));
    const gr = el('div', 'gr');
    gr.innerHTML = '<div class="t1">' + itemName(m.item) + '</div>'
      + '<div class="t2">' + t('market.listing', { who: escape(m.who), qty: m.qty }) + '</div>';
    row.appendChild(gr);
    const rt = el('div', 'rt');
    rt.innerHTML = '<span class="price">' + coinSvg(17) + m.price + '</span>';
    const affordable = m.qty > 0 && coins() >= m.price;
    const b = el('button', 'btn' + (affordable ? ' gold' : ''), m.qty <= 0 ? t('market.soldout') : t('market.buy'));
    if (affordable) {
      b.addEventListener('pointerdown', async function () {
        const done = await act(function () { return api.buy(m.id) }, sfx.coins);
        if (done) { try { S.market = await api.market() } catch (e) { /* keep board */ } renderMarket() }
      });
    } else b.disabled = true;
    rt.appendChild(b); row.appendChild(rt);
    list.appendChild(row);
  });
}

function marketSell(list) {
  const items = sellables().filter(function (k) { return inv(k) > 0 });
  if (!items.length) { list.appendChild(banner(t('market.nothing.big'), t('market.nothing.sm'))); return }
  items.forEach(function (k) {
    const it = item(k), have = inv(k), row = el('div', 'row');
    row.appendChild(iconCanvas(k, 46));
    const gr = el('div', 'gr');
    gr.innerHTML = '<div class="t1">' + itemName(k) + '</div>'
      + '<div class="t2">' + t('market.stock', { qty: have, price: it.sell }) + '</div>';
    row.appendChild(gr);
    const rt = el('div', 'rt');
    const one = el('button', 'btn wood', t('market.sell1'));
    one.style.padding = '9px 12px';
    one.addEventListener('pointerdown', function () { act(function () { return api.sell(k, 1) }, sfx.coins) });
    const all = el('button', 'btn gold', t('market.sellAll'));
    all.style.padding = '9px 12px';
    all.addEventListener('pointerdown', function () { act(function () { return api.sell(k, have) }, sfx.coins) });
    rt.appendChild(one); rt.appendChild(all); row.appendChild(rt);
    list.appendChild(row);
  });
}

/* ================= DAILY TASKS PANEL ================= */

export function renderTasks() {
  if (!S.snap) return;
  S.openModal = 'tasks';
  frame(t('tasks.title'), t('tasks.sub'), function (body) {
    body.appendChild(streakStrip());

    const list = tasks();
    if (!list.length) { body.appendChild(banner(t('tasks.allDone'), '')); return }

    list.forEach(function (task) {
      const row = el('div', 'task' + (task.claimed ? ' claimed' : task.done ? ' done' : ''));
      const pct = Math.min(100, (task.progress / task.target) * 100);
      const bodyEl = el('div', 't-body');
      bodyEl.innerHTML =
        '<div class="t-title">' + t('task.' + task.kind, { n: task.target }) + '</div>'
        + '<div class="t-bar"><div class="t-fill" style="width:' + pct + '%"></div></div>'
        + '<div class="t-meta"><span>' + t('tasks.progress', { progress: task.progress, target: task.target }) + '</span>'
        + '<span class="price">' + coinSvg(14) + task.coins + '</span>'
        + '<span class="price hay">' + haySvg(13) + task.hay + '</span></div>';
      row.appendChild(bodyEl);

      const actions = el('div', 't-actions');
      if (task.claimed) {
        actions.appendChild(el('div', 't2', t('common.claimed')));
      } else if (task.done) {
        const claim = el('button', 'btn gold', t('common.claim'));
        claim.addEventListener('pointerdown', function () {
          act(function () { return api.claimTask(task.kind) }, sfx.reward);
        });
        actions.appendChild(claim);
      } else {
        // "Show me" hands the task to the guide, which then walks the player
        // through it until it is actually finished.
        const guide = el('button', 'btn wood', t('tasks.guideMe'));
        guide.addEventListener('pointerdown', function () {
          sfx.tap();
          closeModal();
          startGuide({
            id: 'task:' + task.kind,
            steps: taskGuideSteps(task.kind),
            onFinish: function (completed) { if (completed) renderTasks() },
          });
        });
        actions.appendChild(guide);
      }
      row.appendChild(actions);
      body.appendChild(row);
    });

    const bonus = cfg().daily.allDoneBonus;
    const note = el('div', 'bonus-note');
    note.innerHTML = t('tasks.bonus') + ' — ' + coinSvg(14) + ' ' + bonus.coins + '  ' + haySvg(13) + ' ' + bonus.hay;
    body.appendChild(note);
  });
}

/** The seven-day streak strip, with today's reward claimable inline. */
function streakStrip() {
  const wrap = el('div');
  const state = streak();
  const coinsTable = cfg().daily.streakCoins;

  const head = el('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 2px 8px';
  head.innerHTML = '<span style="font-weight:600;font-size:15px;color:#5C3618">' + t('streak.title') + '</span>'
    + '<span class="t2" style="font-size:12px">' + t('streak.sub') + '</span>';
  wrap.appendChild(head);

  const strip = el('div', 'streak-row');
  for (let i = 0; i < coinsTable.length; i++) {
    const day = i + 1;
    const got = state && (day < state.day || (day === state.day && state.claimedToday));
    const now = state && day === state.day && !state.claimedToday;
    strip.appendChild(el('div', 'streak-day' + (got ? ' got' : '') + (now ? ' now' : ''), String(day)));
  }
  wrap.appendChild(strip);

  if (state) {
    const b = el('button', 'btn' + (state.claimedToday ? '' : ' gold'),
      state.claimedToday ? t('streak.claimed') : t('streak.claim', { n: state.day }));
    b.style.cssText = 'width:100%;margin-bottom:14px;padding:12px;font-size:15px';
    if (state.claimedToday) b.disabled = true;
    else {
      b.addEventListener('pointerdown', function () {
        act(function () { return api.claimStreak() }, sfx.reward);
      });
    }
    wrap.appendChild(b);
  }
  return wrap;
}

/* ================= STORAGE PANEL ================= */

export function renderStorage() {
  if (!S.snap) return;
  S.openModal = 'storage';
  frame(t('storage.title'), t('storage.sub'), function (body) {
    const silo = [], barn = [];
    const inventory = snap().farm.inventory;
    for (const k in inventory) (item(k).type === 'crop' ? silo : barn).push(k);
    body.appendChild(sectionTitle(t('storage.silo'), usedK('silo') + '/' + capK('silo'), '#5DAE2E'));
    body.appendChild(gridOf(silo, t('storage.emptySilo')));
    body.appendChild(sectionTitle(t('storage.barn'), usedK('barn') + '/' + capK('barn'), '#C4402E'));
    body.appendChild(gridOf(barn, t('storage.emptyBarn')));
  });
}
function sectionTitle(title, right, col) {
  const d = el('div');
  d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:4px 2px 8px';
  d.innerHTML = '<span style="font-weight:600;font-size:15px;color:' + col + '">' + title + '</span>'
    + '<span class="num" style="font-weight:900;color:#7A5730">' + right + '</span>';
  return d;
}
function gridOf(keys, emptyMsg) {
  if (!keys.length) {
    const e = el('div', 'empty');
    e.innerHTML = '<div class="sm">' + emptyMsg + '</div>';
    e.style.padding = '14px';
    return e;
  }
  const g = el('div', 'grid'); g.style.marginBottom = '14px';
  keys.forEach(function (k) {
    const cell = el('div', 'cell');
    cell.appendChild(iconCanvas(k, 48));
    cell.appendChild(el('div', 'nm', itemName(k)));
    cell.appendChild(el('div', 'qty', inv(k)));
    g.appendChild(cell);
  });
  return g;
}

/* ================= BUILD PANEL (expand + upgrade) ================= */

async function openBuild() {
  try { S.upgrades = await api.upgrades() } catch (e) { S.upgrades = null }
  renderBuild();
}

export function renderBuild() {
  if (!S.snap) return;
  S.openModal = 'build';
  frame(t('expand.title'), t('expand.sub'), function (body) {
    const tabs = el('div', '',
      '<div style="display:flex;gap:8px;margin-bottom:12px">'
      + '<button class="btn ' + (S.buildTab !== 'upgrade' ? 'gold' : 'wood') + '" data-tab="expand" style="flex:1">' + t('rail.expand') + '</button>'
      + '<button class="btn ' + (S.buildTab === 'upgrade' ? 'gold' : 'wood') + '" data-tab="upgrade" style="flex:1">' + t('rail.build') + '</button></div>');
    body.appendChild(tabs);
    tabs.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        sfx.tap(); S.buildTab = b.getAttribute('data-tab'); renderBuild();
      });
    });
    const list = el('div'); body.appendChild(list);
    if (S.buildTab === 'upgrade') upgradeList(list); else expandList(list);
  });
}

function expandList(body) {
  const rules = cfg().expand;
  const opts = [
    {
      title: t('expand.silo', { n: rules.silo.step }), sub: t('expand.siloSub'), target: 'silo',
      coin: Math.round(capK('silo') * rules.silo.coinsPerCap), hay: Number(rules.silo.hay),
      maxed: capK('silo') + rules.silo.step > rules.silo.max, glyph: '🧰',
    },
    {
      title: t('expand.barn', { n: rules.barn.step }), sub: t('expand.barnSub'), target: 'barn',
      coin: Math.round(capK('barn') * rules.barn.coinsPerCap), hay: Number(rules.barn.hay),
      maxed: capK('barn') + rules.barn.step > rules.barn.max, glyph: '🏚️',
    },
  ];
  if (snap().farm.fieldsOpen < cfg().maxTiles) {
    opts.unshift({
      title: t('expand.fields', { n: level() + 1 }), sub: t('expand.fieldsSub'),
      coin: 0, hay: 0, locked: true, glyph: '🌱',
    });
  }
  opts.forEach(function (o) {
    const can = !o.locked && !o.maxed && coins() >= o.coin && hay() >= o.hay;
    const row = el('div', 'row' + (o.locked || o.maxed ? ' dim' : ''));
    row.innerHTML = '<div class="ic" style="display:grid;place-items:center;font-size:30px">' + o.glyph + '</div>'
      + '<div class="gr"><div class="t1">' + o.title + '</div><div class="t2">' + o.sub + '</div>'
      + (o.locked || o.maxed ? '' : '<div class="reqs" style="margin-top:5px"><span class="req'
        + (coins() < o.coin ? ' miss' : '') + '">' + coinSvg(16) + o.coin + '</span>'
        + (o.hay ? '<span class="req' + (hay() < o.hay ? ' miss' : '') + '">' + haySvg(15) + o.hay + '</span>' : '')
        + '</div>') + '</div>';
    const rt = el('div', 'rt');
    if (!o.locked) {
      const b = el('button', 'btn' + (can ? ' gold' : ''), o.maxed ? t('expand.maxed') : t('expand.upgrade'));
      if (can) b.addEventListener('pointerdown', function () { act(function () { return api.expand(o.target) }, sfx.coins) });
      else b.disabled = true;
      rt.appendChild(b);
    }
    row.appendChild(rt);
    body.appendChild(row);
  });
}

function upgradeList(body) {
  const board = S.upgrades;
  if (!board || (!board.machineSlots.length && !board.penAnimals.length)) {
    body.appendChild(banner(t('upgrade.none.big'),
      t('upgrade.none.sm', { n: cfg().upgrades.machineSlot.levels[0] })));
    return;
  }

  board.machineSlots.forEach(function (entry) {
    body.appendChild(upgradeRow({
      icon: 'cfeed',
      title: t('upgrade.slots', { machine: machineName(entry.machine), slots: entry.slots }),
      sub: t('upgrade.slotsSub'),
      quote: entry,
      buy: function () { return api.buyMachineSlot(entry.machine) },
    }));
  });
  board.penAnimals.forEach(function (entry) {
    const def = penCfg(entry.pen);
    body.appendChild(upgradeRow({
      icon: def ? def.out : 'egg',
      title: t('upgrade.animals', { pen: penName(entry.pen), animals: entry.animals }),
      sub: t('upgrade.animalsSub'),
      quote: entry,
      buy: function () { return api.buyPenAnimal(entry.pen) },
    }));
  });
}

function upgradeRow(spec) {
  const next = spec.quote.next;
  const maxed = !next;
  const locked = next && level() < next.level;
  const can = next && !locked && coins() >= next.coins && hay() >= Number(next.hay);

  const row = el('div', 'row' + (maxed || locked ? ' dim' : ''));
  row.appendChild(iconCanvas(spec.icon, 46));
  const gr = el('div', 'gr');
  gr.innerHTML = '<div class="t1">' + spec.title + '</div>'
    + '<div class="t2">' + (maxed ? t('upgrade.maxed') : locked ? t('machine.unlocks', { n: next.level }) : spec.sub) + '</div>'
    + (maxed || locked ? '' : '<div class="reqs" style="margin-top:5px"><span class="req'
      + (coins() < next.coins ? ' miss' : '') + '">' + coinSvg(16) + next.coins + '</span>'
      + '<span class="req' + (hay() < Number(next.hay) ? ' miss' : '') + '">' + haySvg(15) + next.hay + '</span></div>');
  row.appendChild(gr);

  const rt = el('div', 'rt');
  if (!maxed) {
    const b = el('button', 'btn' + (can ? ' gold' : ''), t('upgrade.buy'));
    if (can) {
      b.addEventListener('pointerdown', async function () {
        const done = await act(spec.buy, sfx.coins);
        if (done) { try { S.upgrades = await api.upgrades() } catch (e) { /* keep */ } renderBuild() }
      });
    } else b.disabled = true;
    rt.appendChild(b);
  }
  row.appendChild(rt);
  return row;
}

/* ================= PROFILE / LEADERBOARD / SETTINGS ================= */

export async function renderProfile() {
  if (!S.snap) return;
  S.openModal = 'profile';
  if (!S.board) { try { S.board = await api.leaderboard() } catch (e) { S.board = null } }

  frame(t('profile.title'), t('profile.sub'), function (body) {
    const player = snap().player;

    const nameField = el('div', 'field');
    nameField.innerHTML = '<label>' + t('profile.name') + '</label>'
      + '<input id="pfName" maxlength="20" placeholder="' + t('profile.namePlaceholder') + '">';
    body.appendChild(nameField);

    const farmField = el('div', 'field');
    farmField.innerHTML = '<label>' + t('profile.farmName') + '</label>'
      + '<input id="pfFarm" maxlength="20" placeholder="' + t('profile.farmPlaceholder') + '">';
    body.appendChild(farmField);

    body.querySelector('#pfName').value = player.name || '';
    body.querySelector('#pfFarm').value = player.farmName || '';

    const err = el('div', 'form-err'); err.style.display = 'none';
    body.appendChild(err);

    const save = el('button', 'btn gold', t('common.save'));
    save.style.cssText = 'width:100%;padding:12px;font-size:15px;margin-bottom:14px';
    save.addEventListener('pointerdown', async function () {
      const name = body.querySelector('#pfName').value.trim();
      const farmName = body.querySelector('#pfFarm').value.trim();
      if (!name && !farmName) return;
      err.style.display = 'none';
      const done = await act(function () {
        return api.setProfile({
          ...(name ? { name } : {}),
          ...(farmName ? { farmName } : {}),
        });
      }, sfx.tap);
      if (done) { S.board = null; renderProfile() }
      else { err.textContent = t('profile.invalid'); err.style.display = '' }
    });
    body.appendChild(save);

    /* leaderboard */
    body.appendChild(sectionTitle(t('board.title'), t('board.sub'), '#5C3618'));
    const board = S.board;
    if (!board || !board.top.length) {
      body.appendChild(banner(t('board.empty.big'), t('board.empty.sm')));
    } else {
      board.top.forEach(function (row) {
        const line = el('div', 'lb-row' + (row.you ? ' you' : ''));
        line.innerHTML = '<div class="lb-rank">' + t('board.rank', { n: row.rank }) + '</div>'
          + '<div class="lb-name">' + escape(row.name || '—')
          + (row.farmName ? ' <span class="lb-farm">' + escape(row.farmName) + '</span>' : '') + '</div>'
          + '<div class="lb-lvl">' + t('common.level', { n: row.level }) + '</div>';
        body.appendChild(line);
      });
      if (board.you && !board.top.some(function (r) { return r.you })) {
        const line = el('div', 'lb-row you');
        line.innerHTML = '<div class="lb-rank">' + t('board.rank', { n: board.you.rank }) + '</div>'
          + '<div class="lb-name">' + t('board.you') + '</div>'
          + '<div class="lb-lvl">' + t('common.level', { n: board.you.level }) + '</div>';
        body.appendChild(line);
      }
    }

    /* settings */
    const settings = el('div', 'settings');
    const sound = el('button', 'btn ' + (soundOn() ? 'gold' : 'wood'),
      t('common.sound') + ': ' + (soundOn() ? 'ON' : 'OFF'));
    sound.addEventListener('pointerdown', function () {
      setSound(!soundOn());
      if (soundOn()) { unlockAudio(); sfx.tap() }
      renderProfile();
    });
    settings.appendChild(sound);

    const next = LANGS[(LANGS.findIndex(function (l) { return l.code === getLang() }) + 1) % LANGS.length];
    const lang = el('button', 'btn wood', t('common.language') + ': ' + next.label);
    lang.addEventListener('pointerdown', function () {
      sfx.tap();
      setLang(next.code);
      buildDock(); buildRail(); renderProfile();
    });
    settings.appendChild(lang);
    body.appendChild(settings);

    // The official address, in the one panel a player opens deliberately.
    // A fake front-end can copy every pixel of this game; it cannot copy the
    // address bar, so the player needs to know what to compare it against.
    const site = el('div', 'official-note');
    site.innerHTML = '<b>' + SITE_DOMAIN + '</b><span>' + t('brand.officialWarn') + '</span>';
    body.appendChild(site);
  });
}

/* ================= MACHINE PANEL ================= */

export async function renderMachine(machineId) {
  if (!S.snap) return;
  const def = machineCfg(machineId), view = machineView(machineId);
  if (!def || !view) return;
  if (view.jobs.length && !speedQuoteFor('machine', machineId)) await refreshSpeedUp();

  S.openModal = 'machine:' + machineId;
  frame(machineName(machineId), t('machine.sub', { n: view.slots }), function (body) {
    /* queue strip */
    const q = el('div'); q.style.cssText = 'display:flex;gap:7px;margin-bottom:12px';
    for (let i = 0; i < view.slots; i++) {
      const slot = el('div');
      slot.style.cssText = 'flex:1;aspect-ratio:1;border-radius:12px;border:2.5px dashed rgba(132,81,42,.4);display:grid;place-items:center;position:relative;background:rgba(255,255,255,.4)';
      const j = view.jobs[i];
      if (j) {
        slot.style.border = '2.5px solid rgba(132,81,42,.6)';
        slot.appendChild(iconCanvas(j.out, 40));
        if (i === 0) {
          const pr = el('div');
          pr.style.cssText = 'position:absolute;bottom:3px;left:4px;right:4px;height:5px;border-radius:3px;background:rgba(0,0,0,.2);overflow:hidden';
          const f = el('div');
          f.style.cssText = 'height:100%;background:linear-gradient(#9BE05F,#3E8A1C);width:' + (progress(j.startsAt, j.endsAt) * 100) + '%';
          f.setAttribute('data-qbar', machineId);
          pr.appendChild(f); slot.appendChild(pr);
        }
      } else slot.innerHTML = '<span style="color:rgba(132,81,42,.4);font-size:22px">+</span>';
      q.appendChild(slot);
    }
    body.appendChild(q);

    /* finish the queue early */
    if (view.jobs.length) {
      const speed = speedButton('machine', machineId, function () { renderMachine(machineId) });
      if (speed) {
        const wrap = el('div');
        wrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:12px';
        wrap.appendChild(speed);
        body.appendChild(wrap);
      }
    }

    /* collect button */
    if (Object.keys(view.done).length) {
      const cbtn = el('button', 'btn gold', t('machine.collect'));
      cbtn.style.cssText = 'width:100%;margin-bottom:12px;font-size:16px;padding:12px';
      cbtn.addEventListener('pointerdown', function () {
        act(function () { return api.collectMachine(machineId) }, sfx.collect);
      });
      body.appendChild(cbtn);
    }

    /* recipes */
    def.recipes.forEach(function (r) {
      const lk = level() < r.lvl;
      const row = el('div', 'row' + (lk ? ' dim' : ''));
      row.appendChild(iconCanvas(r.out, 46));
      const gr = el('div', 'gr');
      gr.innerHTML = '<div class="t1">' + itemName(r.out)
        + ' <span style="font-weight:400;color:#A98A5E;font-size:12px">· ' + duration(r.seconds) + '</span></div>'
        + (lk ? '<div class="t2">' + t('machine.unlocks', { n: r.lvl }) + '</div>' : reqChips(r.inp));
      row.appendChild(gr);
      const rt = el('div', 'rt');
      if (!lk) {
        const can = hasAll(r.inp) && view.jobs.length < view.slots;
        const b = el('button', 'btn' + (can ? ' gold' : ''), t('machine.make'));
        if (!can) b.disabled = true;
        else {
          b.addEventListener('pointerdown', function () {
            act(function () { return api.queueJob(machineId, r.out) }, sfx.craft);
          });
        }
        rt.appendChild(b);
      }
      row.appendChild(rt);
      body.appendChild(row);
    });
    hydrateIcons(body);
  });
}

/* ================= ANIMAL PEN PANEL ================= */

export async function renderPen(penId) {
  if (!S.snap) return;
  const def = penCfg(penId), view = penView(penId);
  if (!def || !view) return;
  const working = view.animals.filter(function (a) { return a.state === 'full' }).length;
  if (working && !speedQuoteFor('pen', penId)) await refreshSpeedUp();

  S.openModal = 'pen:' + penId;
  frame(penName(penId), t('pen.sub', { feed: itemName(def.feed), out: itemName(def.out) }), function (body) {
    const ready = view.animals.filter(function (a) { return a.state === 'ready' }).length;
    const hungry = view.animals.filter(function (a) { return a.state === 'hungry' }).length;

    const info = el('div', 'row');
    const ic = el('div', 'ic'); ic.appendChild(iconCanvas(def.out, 46));
    info.appendChild(ic);
    const gr = el('div', 'gr');
    const kind = def.id === 'chicken' ? t('pen.hens') : def.id === 'cow' ? t('pen.cows') : t('pen.sheep');
    gr.innerHTML = '<div class="t1">' + t('pen.animals', { n: view.animals.length, kind }) + '</div>'
      + '<div class="t2">' + t('pen.counts', {
        ready, hungry, feed: itemName(def.feed), have: inv(def.feed),
      }) + '</div>';
    info.appendChild(gr);
    body.appendChild(info);

    const b = el('button', 'btn gold', t('pen.tend'));
    b.style.cssText = 'width:100%;margin:12px 0;font-size:16px;padding:13px';
    b.addEventListener('pointerdown', async function () {
      // Collect first so the freed animals can be fed in the same tap, exactly
      // like the prototype's "tend the pen".
      let did = false;
      if (ready > 0) did = Boolean(await act(function () { return api.collectPen(penId) }, sfx.collect));
      if (hungry > 0 || did) await act(function () { return api.feedPen(penId) }, sfx.feed);
    });
    body.appendChild(b);

    if (working) {
      const speed = speedButton('pen', penId, function () { renderPen(penId) });
      if (speed) {
        const wrap = el('div');
        wrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:12px';
        wrap.appendChild(speed);
        body.appendChild(wrap);
      }
    }

    const note = el('div', 'empty');
    note.innerHTML = '<div class="sm">' + t('pen.hint') + '</div>';
    body.appendChild(note);
  });
}

/* ================= GROWING CROP SHEET ================= */

/** Tapping a crop that is still growing offers to finish it for $HAY. */
async function renderTileSpeedUp(index) {
  await refreshSpeedUp();
  const quote = speedQuoteFor('tile', index);
  const tile = snap().farm.tiles[index];
  if (!quote || !tile || !tile.crop) {
    toast(t('error.not_ready'), ICON[tile && tile.crop ? tile.crop : 'coin']);
    return;
  }
  S.openModal = 'tile:' + index;
  frame(itemName(tile.crop), duration(quote.remainingSec), function (body) {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;padding:8px 0 4px';
    wrap.appendChild(iconCanvas(tile.crop, 72));
    const line = el('div', 't2');
    line.style.cssText = 'font-size:15px;text-align:center';
    line.textContent = t('speedup.confirm', { hay: quote.hay });
    wrap.appendChild(line);
    const speed = speedButton('tile', index, function () { closeModal() });
    if (speed) wrap.appendChild(speed);
    body.appendChild(wrap);
  });
}

/* ================= AWAY SUMMARY ================= */

/**
 * The card shown once, on the first read back after a real absence.
 * `onClose` lets the caller hold anything else back until it is dismissed.
 */
export function showAwayCard(onClose) {
  const report = S.away;
  if (!report) return false;
  S.away = null;

  let host = document.getElementById('away');
  if (!host) {
    host = document.createElement('div');
    host.id = 'away';
    document.body.appendChild(host);
  }

  const lines = [];
  if (report.cropsReady) lines.push(t('away.crops', { n: report.cropsReady }));
  if (report.goodsReady) lines.push(t('away.goods', { n: report.goodsReady }));
  if (report.animalsReady) lines.push(t('away.animals', { n: report.animalsReady }));

  host.innerHTML = '<div class="aw panel">'
    + '<h3>' + t('away.title') + '</h3>'
    + '<div class="sub">' + t('away.sub', { time: duration(report.awaySec) }) + '</div>'
    + '<div class="aw-lines">' + lines.map(function (l) { return '<div class="aw-line">' + l + '</div>' }).join('') + '</div>'
    + '<div class="aw-items">' + report.waiting.map(function (w) {
      return '<span class="aw-item" data-ic="' + w.item + '">×' + w.qty + '</span>';
    }).join('') + '</div>'
    + '<button class="btn gold" id="awGo" style="width:100%;padding:12px;font-size:15px">' + t('away.go') + '</button>'
    + '</div>';

  host.querySelectorAll('[data-ic]').forEach(function (sp) {
    const id = sp.getAttribute('data-ic');
    sp.insertBefore(iconCanvas(id, 22), sp.firstChild);
    sp.removeAttribute('data-ic');
  });
  host.classList.add('on');
  sfx.reward();
  host.querySelector('#awGo').addEventListener('pointerdown', function () {
    sfx.tap();
    host.classList.remove('on');
    if (onClose) onClose();
  });
  return true;
}

/** True while the away card is up — other overlays should wait their turn. */
export function awayCardOpen() {
  const host = document.getElementById('away');
  return Boolean(host && host.classList.contains('on'));
}

/* ================= TOASTS ================= */

/**
 * The one time the game asks to be allowed to notify.
 *
 * Deliberately not a permission prompt: the browser's own dialog is fired only
 * after the player says yes to this, because a prompt nobody expected is
 * answered "block" and there is no second chance. It sits in the toast rail
 * rather than over the farm, and it does not come back — enablePush() marks
 * the ask whichever way it goes.
 */
let offerOpen = false;
export function pushOffer() {
  if (offerOpen) return;
  offerOpen = true;
  const text = pushOfferText();
  const box = el('div', 'toast offer');
  box.appendChild(el('div', 'offer-t', escape(text.title)));
  box.appendChild(el('div', 'offer-b', escape(text.body)));
  const row = el('div', 'offer-row');
  const yes = el('button', 'btn gold', escape(text.yes));
  const no = el('button', 'linkish', escape(text.no));
  row.appendChild(yes); row.appendChild(no);
  box.appendChild(row);
  $('#toasts').appendChild(box);

  const close = () => {
    offerOpen = false;
    box.classList.add('out');
    setTimeout(() => box.remove(), 300);
  };
  no.addEventListener('pointerdown', function () { markPushDeclined(); close() });
  yes.addEventListener('pointerdown', async function () {
    yes.disabled = true;
    const on = await enablePush();
    close();
    if (on) toast(t('push.on'), null, false);
  });
}

export function toast(msg, icon, bad) {
  const el2 = el('div', 'toast' + (bad ? ' bad' : ''));
  const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
  const g = cv.getContext('2d'); g.scale(40 / 64, 40 / 64);
  try { (icon || ICON.coin)(g) } catch (e) { /* unknown icon */ }
  cv.style.width = '20px'; cv.style.height = '20px';
  el2.appendChild(cv); el2.appendChild(el('span', null, msg));
  $('#toasts').appendChild(el2);
  setTimeout(function () { el2.classList.add('out'); setTimeout(function () { el2.remove() }, 300) }, 2200);
}

/** Minimal escaping for anything a player typed — names reach other screens. */
function escape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ================= LEVEL UP ================= */

let luQueue = [];
export function showLevelUp(lvl) { luQueue.push(lvl); if (luQueue.length === 1) playLU() }
function playLU() {
  const lvl = luQueue[0];
  const box = $('#luBody');
  const text = cfg().levelUpText;
  box.innerHTML = '<div class="k">Level Up</div><div class="v num">' + lvl + '</div>'
    + '<div class="u">' + (text[Math.min(lvl, text.length - 1)] || '') + '</div>';
  $('#lvlup').classList.add('on');
  sfx.levelUp();
  buildDock(); buildRail();
  setTimeout(function () {
    $('#lvlup').classList.remove('on');
    luQueue.shift();
    if (luQueue.length) setTimeout(playLU, 250);
  }, 1900);
}

/* ================= INPUT ================= */

let px0 = 0, py0 = 0, moved = 0, dragging = false, pinchD = 0, painted = null, camDrag = false;

function evPos(e) { const r = $('#world').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

function pickHit(x, y) {
  const hits = window.__HITS || [];
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x >= h.x - h.w / 2 && x <= h.x + h.w / 2 && y >= h.y - h.h / 2 && y <= h.y + h.h / 2) return h;
  }
  return null;
}

function onDown(e) {
  unlockAudio();
  if (S.openModal) return;
  const p = evPos(e);
  px0 = p.x; py0 = p.y; moved = 0; dragging = true; camDrag = false; painted = {};
}

function onMove(e) {
  if (!dragging || S.openModal) return;
  const p = evPos(e);
  const dx = p.x - px0, dy = p.y - py0;
  moved = Math.max(moved, Math.hypot(dx, dy));

  /* Sweep-to-plant: collect the tiles the drag crosses. One request goes out
     on release, so a twelve-tile sweep is one transaction, not twelve. */
  const painting = painted && Object.keys(painted).length > 0;
  if (S.sel && !camDrag && S.snap) {
    const h = pickHit(p.x, p.y);
    if (h && h.kind === 'plot' && !h.ref.crop && h.ref.open) {
      if (!painted[h.ref.index]) {
        painted[h.ref.index] = 1;
        const pos = fieldPos(h.ref.index);
        fx.puff(w2s(pos[0], pos[1]), 5);
      }
      px0 = p.x; py0 = p.y;
      return;
    }
    // Once the sweep has started, the gesture stays a sweep. Crossing the gap
    // between two plots must not turn it into a camera pan half way through.
    if (painting) { px0 = p.x; py0 = p.y; return }
  }

  if (moved > 8) {
    camDrag = true;
    window.__CAM.x += p.x - px0; window.__CAM.y += p.y - py0;
    window.__clampCam();
    px0 = p.x; py0 = p.y;
  }
}

function fieldPos(index) {
  return FIELD_POS[index] || [1.6, 1.5];
}

function onUp(e) {
  if (!dragging || S.openModal) { dragging = false; return }
  dragging = false;

  const swept = painted ? Object.keys(painted).map(Number) : [];
  if (swept.length) {
    const pos = fieldPos(swept[swept.length - 1]);
    sendFarmer(pos[0], pos[1] + 0.6);
    act(function () { return api.plant(swept, S.sel) }, sfx.plant);
    return;
  }

  const p = evPos(e);
  if (camDrag || moved > 10) return;
  const h = pickHit(p.x, p.y);
  if (!h) return;
  tapHit(h);
}

function tapHit(h) {
  switch (h.kind) {
    case 'plot': {
      const tile = h.ref;
      const pos = fieldPos(tile.index);
      sendFarmer(pos[0], pos[1] + 0.6);
      if (tile.crop) {
        if (tile.ready) {
          fx.spark(w2s(pos[0], pos[1]), 8);
          act(function () { return api.harvest(tile.index) }, sfx.harvest);
        } else {
          // Still growing: offer to finish it for $HAY rather than just saying no.
          renderTileSpeedUp(tile.index);
        }
      } else {
        act(function () { return api.plant([tile.index], S.sel) }, sfx.plant);
      }
      break;
    }
    case 'machine': {
      const def = machineCfg(h.ref);
      if (def) sendFarmer(def.x, def.y + 0.9);
      const view = machineView(h.ref);
      if (view && Object.keys(view.done).length) {
        act(function () { return api.collectMachine(h.ref) }, sfx.collect)
          .then(function () { renderMachine(h.ref) });
      } else renderMachine(h.ref);
      break;
    }
    case 'pen': renderPen(h.ref); break;
    case 'animal': {
      const ref = h.ref;
      const def = penCfg(ref.pen);
      if (def) sendFarmer(def.hx, def.hy + 1);
      if (ref.state === 'ready') act(function () { return api.collectPen(ref.pen, ref.index) }, sfx.collect);
      else if (ref.state === 'hungry') act(function () { return api.feedPen(ref.pen, ref.index) }, sfx.feed);
      else renderPen(ref.pen);
      break;
    }
    case 'orders': renderOrders(); break;
    case 'market': openMarket(); break;
    case 'silo': case 'barn': renderStorage(); break;
  }
}

function dist2(t2) { return Math.hypot(t2[0].clientX - t2[1].clientX, t2[0].clientY - t2[1].clientY) }

function bindInput() {
  const w = $('#world');
  w.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', function () { dragging = false });

  w.addEventListener('wheel', function (e) {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0012);
    const c = window.__CAM, p = evPos(e);
    const wx = (p.x - c.x) / c.z, wy = (p.y - c.y) / c.z;
    c.z = Math.max(0.5, Math.min(1.4, c.z * f));
    c.x = p.x - wx * c.z; c.y = p.y - wy * c.z;
    window.__clampCam();
  }, { passive: false });

  w.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { dragging = false; pinchD = dist2(e.touches) }
  }, { passive: true });
  w.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2) {
      const d = dist2(e.touches);
      if (pinchD) {
        const c = window.__CAM;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const wx = (mx - c.x) / c.z, wy = (my - c.y) / c.z;
        c.z = Math.max(0.5, Math.min(1.4, c.z * d / pinchD));
        c.x = mx - wx * c.z; c.y = my - wy * c.z;
        window.__clampCam();
      }
      pinchD = d;
      e.preventDefault();
    }
  }, { passive: false });
  w.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinchD = 0 });

  $('#scrim').addEventListener('pointerdown', function (e) { if (e.target === $('#scrim')) closeModal() });
}

/** Keep the open machine panel's progress bar live without re-rendering it. */
export function tickPanels() {
  if (!S.openModal || !S.openModal.startsWith('machine:')) return;
  const id = S.openModal.slice(8);
  const view = machineView(id);
  const bar2 = document.querySelector('[data-qbar="' + id + '"]');
  if (!bar2 || !view || !view.jobs[0]) return;
  const j = view.jobs[0];
  bar2.style.width = (progress(j.startsAt, j.endsAt) * 100) + '%';
}

export function bootUI() {
  initLang();
  buildHUD(); buildDock(); buildRail(); bindInput();
  syncHUD(); syncBadges();
}

export { closeModal, refreshOpenPanel };
