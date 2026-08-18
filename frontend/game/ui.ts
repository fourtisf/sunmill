// @ts-nocheck
/**
 * SUNMILL — HUD, dock, side rail, panels and input.
 *
 * Ported from the prototype's ui.js. The markup and CSS classes are unchanged
 * — that is the visual identity. What changed is that every button now calls
 * the API and re-renders from the returned snapshot instead of mutating local
 * state (HANDOFF §8). Nothing here knows a price or a duration; it reads them
 * from the config the server sent.
 */
import { ART as A, ICON } from './art';
import { api, NetError } from './net';
import {
  apply, cfg, coins, hasAll, hay, inv, item, itemName, level, machineCfg,
  machineView, penCfg, penView, progress, S, sellables, serverNow, snap, usedK, capK,
} from './state';
import { fx, sendFarmer, w2s } from './render';

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

/* ================= ACTION WRAPPER ================= */

/**
 * Every mutation goes through here: one request at a time, the response is
 * applied wholesale, and anything the server wants said gets said.
 */
async function act(run) {
  if (S.busy) return null;
  S.busy = true;
  try {
    const snapshot = await run();
    if (snapshot) {
      apply(snapshot);
      if (snapshot.notice) toast(snapshot.notice.message, ICON[snapshot.notice.icon] || ICON.coin, snapshot.notice.bad);
      if (snapshot.levelsGained) for (const lvl of snapshot.levelsGained) showLevelUp(lvl);
    }
    syncHUD(); syncBadges(); refreshOpenPanel();
    return snapshot;
  } catch (err) {
    if (err instanceof NetError) toast(err.message, ICON.coin, true);
    else toast('Lost the connection to the farm', ICON.coin, true);
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
    + '<div class="chip" id="chCoin"><svg viewBox="0 0 64 64">' + coinBadge() + '</svg><span id="coinTxt">0</span></div>'
    + '<div class="chip" id="chHay"><svg viewBox="0 0 64 64">' + hayBadge() + '</svg><span id="hayTxt">0</span></div>';
  h.appendChild(chips);
  $('#chSilo').addEventListener('pointerdown', function (e) { e.stopPropagation(); renderStorage() });
  $('#chBarn').addEventListener('pointerdown', function (e) { e.stopPropagation(); renderStorage() });
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
    s.appendChild(el('div', 'nm', it.name));
    const pr = el('div', 'pr'); pr.innerHTML = '<svg viewBox="0 0 64 64">' + coinBadge() + '</svg>' + it.seed;
    s.appendChild(pr);
    s.appendChild(el('div', 'tm', dur(it.growSeconds)));
    if (lk) s.appendChild(el('div', 'lk', 'Lvl ' + it.lvl));
    else s.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); S.sel = id; buildDock() });
    d.appendChild(s);
  }
}

/** Format a real duration, whatever TIME_SCALE the server is running. */
function dur(sec) {
  if (sec == null) return '';
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.round(sec / 60) + 'm';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? h + 'h ' + m + 'm' : h + 'h';
}

/* ================= SIDE RAIL ================= */

export function buildRail() {
  const r = $('#rail'); r.innerHTML = '';
  r.appendChild(railBtn('orders',
    '<svg viewBox="0 0 40 40"><rect x="4" y="12" width="22" height="16" rx="2" fill="#E0C68E" stroke="#8A5410" stroke-width="2"/>'
    + '<path d="M26 16 h6 l4 5 v7 h-10 Z" fill="#C4402E" stroke="#7E1E12" stroke-width="2"/>'
    + '<circle cx="11" cy="30" r="3.4" fill="#3A3128" stroke="#000" stroke-width="1.5"/>'
    + '<circle cx="30" cy="30" r="3.4" fill="#3A3128" stroke="#000" stroke-width="1.5"/></svg>', 'Orders'));
  r.appendChild(railBtn('market',
    '<svg viewBox="0 0 40 40"><path d="M6 14 h28 l-2 -6 h-24 Z" fill="#3A8FC4" stroke="#1B6E96" stroke-width="2"/>'
    + '<rect x="7" y="14" width="26" height="4" fill="#C4A468"/>'
    + '<rect x="8" y="18" width="24" height="14" rx="2" fill="#E0C68E" stroke="#8A5410" stroke-width="2"/>'
    + '<rect x="12" y="8" width="4" height="6" fill="#F2E6CC"/><rect x="24" y="8" width="4" height="6" fill="#F2E6CC"/></svg>', 'Market'));
  r.appendChild(railBtn('storage',
    '<svg viewBox="0 0 40 40"><rect x="6" y="10" width="28" height="24" rx="3" fill="#C4A468" stroke="#7E5A1E" stroke-width="2"/>'
    + '<path d="M6 18 h28 M20 10 v24" stroke="#7E5A1E" stroke-width="2"/>'
    + '<rect x="10" y="13" width="4" height="3" fill="#8A5410"/></svg>', 'Storage'));
  r.appendChild(railBtn('build',
    '<svg viewBox="0 0 40 40"><path d="M20 6 l4 4 -6 6 -4-4 Z" fill="#B8BCC0" stroke="#5E6468" stroke-width="2"/>'
    + '<path d="M18 12 L8 22 a3 3 0 0 0 0 4 l2 2 a3 3 0 0 0 4 0 l10-10 Z" fill="#C4923A" stroke="#7E5A1E" stroke-width="2"/></svg>', 'Expand'));
  syncBadges();
}
function railBtn(id, svg, tag) {
  const b = el('div', 'rbtn'); b.id = 'rb_' + id; b.innerHTML = svg;
  b.appendChild(el('div', 'tag', tag));
  const bd = el('div', 'badge'); bd.id = 'bd_' + id; bd.style.display = 'none'; b.appendChild(bd);
  b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); openPanel(id) });
  return b;
}
export function syncBadges() {
  if (!S.snap) return;
  badge('orders', snap().orders.filter(function (o) { return o.canFill }).length);
}
function badge(id, n) {
  const b = $('#bd_' + id); if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = 'grid' } else b.style.display = 'none';
}

/* ================= MODAL FRAME ================= */

function openPanel(kind) {
  // Nothing to show before the first snapshot lands.
  if (!S.snap) return;
  if (kind === 'orders') return renderOrders();
  if (kind === 'market') return openMarket();
  if (kind === 'storage') return renderStorage();
  if (kind === 'build') return renderExpand();
}

function frame(title, sub, bodyFill) {
  const m = $('#modal');
  m.innerHTML = '<div class="mhead"><h2>' + title + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</h2>'
    + '<button class="mx" id="mClose">&times;</button></div><div class="mbody" id="mBody"></div>';
  $('#mClose').addEventListener('pointerdown', closeModal);
  bodyFill($('#mBody'));
  $('#scrim').classList.add('on');
}

function closeModal() { $('#scrim').classList.remove('on'); S.openModal = null }

/** Re-paint whichever panel is open after a snapshot lands. */
function refreshOpenPanel() {
  const open = S.openModal;
  if (!open) return;
  if (open === 'orders') return renderOrders();
  if (open === 'market') return renderMarket();
  if (open === 'storage') return renderStorage();
  if (open === 'build') return renderExpand();
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

/* ================= ORDERS PANEL ================= */

export function renderOrders() {
  if (!S.snap) return;
  S.openModal = 'orders';
  frame('Delivery Orders', 'Fill the truck for coins, XP and $HAY', function (body) {
    const orders = snap().orders;
    if (!orders.length) { body.appendChild(banner('The board is empty', 'New orders arrive as you play.')); return }
    orders.forEach(function (o) {
      const t = el('div', 'ticket');
      let items = '';
      for (const k in o.items) {
        const have = inv(k), ok = have >= o.items[k];
        items += '<div class="oitem"><span data-ic="' + k + '"></span><div class="n ' + (ok ? 'ok' : 'no') + '">'
          + have + '/' + o.items[k] + '</div></div>';
      }
      t.innerHTML =
        '<div class="tk-top"><span data-ic="_ava"></span><span class="who">' + o.who + '</span>'
        + '<span class="xpchip">+' + o.xp + ' XP</span></div>'
        + '<div class="tk-mid">' + items + '</div>'
        + '<div class="tk-bot"><div class="rew"><span class="price"><svg viewBox="0 0 64 64" style="width:18px;height:18px">'
        + coinBadge() + '</svg>' + o.coins + '</span>'
        + '<span class="price hay"><svg viewBox="0 0 64 64" style="width:16px;height:16px">' + hayBadge() + '</svg>' + o.hay + '</span></div>'
        + '<button class="btn ' + (o.canFill ? 'gold' : '') + '" ' + (o.canFill ? '' : 'disabled') + ' data-fill="' + o.id + '">'
        + (o.canFill ? 'Deliver' : 'Missing items') + '</button>'
        + '<button class="btn red" data-skip="' + o.id + '" style="padding:10px 12px">Skip</button></div>';
      body.appendChild(t);
    });
    body.querySelectorAll('[data-ic="_ava"]').forEach(function (s) {
      s.innerHTML = '<svg viewBox="0 0 24 24" style="width:22px;height:22px"><circle cx="12" cy="9" r="4.4" fill="#E0C68E" stroke="#8A5410" stroke-width="1.5"/><path d="M4 21 a8 7 0 0 1 16 0 Z" fill="#5E86C8" stroke="#2A4680" stroke-width="1.5"/></svg>';
      s.removeAttribute('data-ic');
    });
    hydrateIcons(body);
    body.querySelectorAll('[data-fill]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        const id = b.getAttribute('data-fill');
        act(function () { return api.deliverOrder(id) });
      });
    });
    body.querySelectorAll('[data-skip]').forEach(function (b) {
      b.addEventListener('pointerdown', function () {
        const id = b.getAttribute('data-skip');
        act(function () { return api.skipOrder(id) });
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
  frame('Roadside Market', 'Buy from neighbours or sell your surplus', function (body) {
    const tabs = el('div', '',
      '<div style="display:flex;gap:8px;margin-bottom:12px">'
      + '<button class="btn ' + (S.marketTab === 'buy' ? 'gold' : 'wood') + '" data-tab="buy" style="flex:1">Buy</button>'
      + '<button class="btn ' + (S.marketTab === 'sell' ? 'gold' : 'wood') + '" data-tab="sell" style="flex:1">Sell</button></div>');
    body.appendChild(tabs);
    tabs.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('pointerdown', function () { S.marketTab = b.getAttribute('data-tab'); renderMarket() });
    });
    const list = el('div'); body.appendChild(list);
    if (S.marketTab === 'buy') marketBuy(list); else marketSell(list);
  });
}

function marketBuy(list) {
  const listings = (S.market && S.market.listings) || [];
  if (!listings.length) { list.appendChild(banner('Market is quiet', 'Fresh listings show up every few minutes.')); return }
  listings.forEach(function (m) {
    const it = item(m.item), row = el('div', 'row' + (m.qty <= 0 ? ' dim' : ''));
    row.appendChild(iconCanvas(m.item, 46));
    const gr = el('div', 'gr');
    gr.innerHTML = '<div class="t1">' + it.name + '</div><div class="t2">from ' + m.who + ' · ' + m.qty + ' left</div>';
    row.appendChild(gr);
    const rt = el('div', 'rt');
    rt.innerHTML = '<span class="price"><svg viewBox="0 0 64 64" style="width:17px;height:17px">' + coinBadge() + '</svg>' + m.price + '</span>';
    const affordable = m.qty > 0 && coins() >= m.price;
    const b = el('button', 'btn' + (affordable ? ' gold' : ''), m.qty <= 0 ? 'Sold out' : 'Buy');
    if (affordable) {
      b.addEventListener('pointerdown', async function () {
        const done = await act(function () { return api.buy(m.id) });
        if (done) { try { S.market = await api.market() } catch (e) { /* keep board */ } renderMarket() }
      });
    } else b.disabled = true;
    rt.appendChild(b); row.appendChild(rt);
    list.appendChild(row);
  });
}

function marketSell(list) {
  const items = sellables().filter(function (k) { return inv(k) > 0 });
  if (!items.length) { list.appendChild(banner('Nothing to sell yet', 'Harvest crops and craft goods, then come back.')); return }
  items.forEach(function (k) {
    const it = item(k), have = inv(k), row = el('div', 'row');
    row.appendChild(iconCanvas(k, 46));
    const gr = el('div', 'gr');
    gr.innerHTML = '<div class="t1">' + it.name + '</div><div class="t2">You have ' + have + ' · ' + it.sell + ' each</div>';
    row.appendChild(gr);
    const rt = el('div', 'rt');
    const one = el('button', 'btn wood', 'Sell 1');
    one.style.padding = '9px 12px';
    one.addEventListener('pointerdown', function () { act(function () { return api.sell(k, 1) }) });
    const all = el('button', 'btn gold', 'Sell all');
    all.style.padding = '9px 12px';
    all.addEventListener('pointerdown', function () { act(function () { return api.sell(k, have) }) });
    rt.appendChild(one); rt.appendChild(all); row.appendChild(rt);
    list.appendChild(row);
  });
}

/* ================= STORAGE PANEL ================= */

export function renderStorage() {
  if (!S.snap) return;
  S.openModal = 'storage';
  frame('Storage', 'Silo holds crops · Barn holds goods', function (body) {
    const silo = [], barn = [];
    const inventory = snap().farm.inventory;
    for (const k in inventory) (item(k).type === 'crop' ? silo : barn).push(k);
    body.appendChild(sectionTitle('Silo', usedK('silo') + '/' + capK('silo'), '#5DAE2E'));
    body.appendChild(gridOf(silo, 'crops in your silo'));
    body.appendChild(sectionTitle('Barn', usedK('barn') + '/' + capK('barn'), '#C4402E'));
    body.appendChild(gridOf(barn, 'goods in your barn'));
  });
}
function sectionTitle(t, r, col) {
  const d = el('div');
  d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:4px 2px 8px';
  d.innerHTML = '<span style="font-weight:600;font-size:15px;color:' + col + '">' + t + '</span>'
    + '<span class="num" style="font-weight:900;color:#7A5730">' + r + '</span>';
  return d;
}
function gridOf(keys, emptyMsg) {
  if (!keys.length) {
    const e = el('div', 'empty');
    e.innerHTML = '<div class="sm">No ' + emptyMsg + ' right now.</div>';
    e.style.padding = '14px';
    return e;
  }
  const g = el('div', 'grid'); g.style.marginBottom = '14px';
  keys.forEach(function (k) {
    const cell = el('div', 'cell');
    cell.appendChild(iconCanvas(k, 48));
    cell.appendChild(el('div', 'nm', item(k).name));
    cell.appendChild(el('div', 'qty', inv(k)));
    g.appendChild(cell);
  });
  return g;
}

/* ================= EXPAND PANEL ================= */

export function renderExpand() {
  if (!S.snap) return;
  S.openModal = 'build';
  frame('Expand the Farm', 'Spend coins and $HAY to grow', function (body) {
    const rules = cfg().expand;
    const opts = [
      {
        t: 'Silo +' + rules.silo.step + ' capacity', d: 'More room for crops', target: 'silo',
        coin: Math.round(capK('silo') * rules.silo.coinsPerCap), hay: Number(rules.silo.hay),
      },
      {
        t: 'Barn +' + rules.barn.step + ' capacity', d: 'More room for goods', target: 'barn',
        coin: Math.round(capK('barn') * rules.barn.coinsPerCap), hay: Number(rules.barn.hay),
      },
    ];
    if (snap().farm.fieldsOpen < cfg().maxTiles) {
      opts.unshift({
        t: 'More fields at Level ' + (level() + 1),
        d: 'Reach the next level to clear new plots',
        coin: 0, hay: 0, locked: true,
      });
    }
    opts.forEach(function (o, idx) {
      const can = !o.locked && coins() >= o.coin && hay() >= o.hay;
      const row = el('div', 'row' + (o.locked ? ' dim' : ''));
      row.innerHTML = '<div class="ic" style="display:grid;place-items:center;font-size:30px">'
        + (o.locked ? '🌱' : idx === opts.length - 1 ? '🏚️' : '🧰') + '</div>'
        + '<div class="gr"><div class="t1">' + o.t + '</div><div class="t2">' + o.d + '</div>'
        + (o.locked ? '' : '<div class="reqs" style="margin-top:5px"><span class="req' + (coins() < o.coin ? ' miss' : '')
          + '"><svg viewBox="0 0 64 64" style="width:16px;height:16px">' + coinBadge() + '</svg>' + o.coin + '</span>'
          + (o.hay ? '<span class="req' + (hay() < o.hay ? ' miss' : '') + '"><svg viewBox="0 0 64 64" style="width:15px;height:15px">'
            + hayBadge() + '</svg>' + o.hay + '</span>' : '') + '</div>') + '</div>';
      const rt = el('div', 'rt');
      if (!o.locked) {
        const b = el('button', 'btn' + (can ? ' gold' : ''), 'Upgrade');
        if (can) b.addEventListener('pointerdown', function () { act(function () { return api.expand(o.target) }) });
        else b.disabled = true;
        rt.appendChild(b);
      }
      row.appendChild(rt);
      body.appendChild(row);
    });
  });
}

/* ================= MACHINE PANEL ================= */

export function renderMachine(machineId) {
  if (!S.snap) return;
  const def = machineCfg(machineId), view = machineView(machineId);
  if (!def || !view) return;
  S.openModal = 'machine:' + machineId;
  frame(def.name, 'Queue up to ' + def.slots + ' jobs', function (body) {
    /* queue strip */
    const q = el('div'); q.style.cssText = 'display:flex;gap:7px;margin-bottom:12px';
    for (let i = 0; i < def.slots; i++) {
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

    /* collect button */
    if (Object.keys(view.done).length) {
      const cbtn = el('button', 'btn gold', 'Collect ready goods');
      cbtn.style.cssText = 'width:100%;margin-bottom:12px;font-size:16px;padding:12px';
      cbtn.addEventListener('pointerdown', function () { act(function () { return api.collectMachine(machineId) }) });
      body.appendChild(cbtn);
    }

    /* recipes */
    def.recipes.forEach(function (r) {
      const lk = level() < r.lvl;
      const row = el('div', 'row' + (lk ? ' dim' : ''));
      row.appendChild(iconCanvas(r.out, 46));
      const gr = el('div', 'gr');
      gr.innerHTML = '<div class="t1">' + itemName(r.out)
        + ' <span style="font-weight:400;color:#A98A5E;font-size:12px">· ' + dur(r.seconds) + '</span></div>'
        + (lk ? '<div class="t2">Unlocks at Level ' + r.lvl + '</div>' : reqChips(r.inp));
      row.appendChild(gr);
      const rt = el('div', 'rt');
      if (!lk) {
        const can = hasAll(r.inp) && view.jobs.length < def.slots;
        const b = el('button', 'btn' + (can ? ' gold' : ''), 'Make');
        if (!can) b.disabled = true;
        else b.addEventListener('pointerdown', function () { act(function () { return api.queueJob(machineId, r.out) }) });
        rt.appendChild(b);
      }
      row.appendChild(rt);
      body.appendChild(row);
    });
    hydrateIcons(body);
  });
}

/* ================= ANIMAL PEN PANEL ================= */

export function renderPen(penId) {
  if (!S.snap) return;
  const def = penCfg(penId), view = penView(penId);
  if (!def || !view) return;
  S.openModal = 'pen:' + penId;
  frame(def.name, 'Feed with ' + itemName(def.feed) + ', collect ' + itemName(def.out), function (body) {
    const ready = view.animals.filter(function (a) { return a.state === 'ready' }).length;
    const hungry = view.animals.filter(function (a) { return a.state === 'hungry' }).length;
    const info = el('div', 'row');
    const ic = el('div', 'ic'); ic.appendChild(iconCanvas(def.out, 46));
    info.appendChild(ic);
    const gr = el('div', 'gr');
    gr.innerHTML = '<div class="t1">' + view.animals.length + ' '
      + (def.id === 'chicken' ? 'hens' : def.id === 'cow' ? 'cows' : 'sheep') + '</div>'
      + '<div class="t2">' + ready + ' ready · ' + hungry + ' hungry · ' + itemName(def.feed) + ' in barn: ' + inv(def.feed) + '</div>';
    info.appendChild(gr);
    body.appendChild(info);

    const b = el('button', 'btn gold', 'Feed all &amp; collect all');
    b.style.cssText = 'width:100%;margin:12px 0;font-size:16px;padding:13px';
    b.addEventListener('pointerdown', async function () {
      // Collect first so the freed animals can be fed in the same tap, exactly
      // like the prototype's "tend the pen".
      let did = false;
      if (ready > 0) did = Boolean(await act(function () { return api.collectPen(penId) }));
      if (hungry > 0 || did) await act(function () { return api.feedPen(penId) });
    });
    body.appendChild(b);

    const note = el('div', 'empty');
    note.innerHTML = '<div class="sm">You can also tap animals directly out in the field — tap a feed bubble to feed, tap a product bubble to collect.</div>';
    body.appendChild(note);
  });
}

/* ================= BANNERS / TOASTS ================= */

function banner(big, sm) {
  const e = el('div', 'empty');
  e.innerHTML = '<div class="big">' + big + '</div><div class="sm">' + sm + '</div>';
  return e;
}

export function toast(msg, icon, bad) {
  const t = el('div', 'toast' + (bad ? ' bad' : ''));
  const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
  const g = cv.getContext('2d'); g.scale(40 / 64, 40 / 64);
  try { (icon || ICON.coin)(g) } catch (e) { /* unknown icon */ }
  cv.style.width = '20px'; cv.style.height = '20px';
  t.appendChild(cv); t.appendChild(el('span', null, msg));
  $('#toasts').appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove() }, 300) }, 2200);
}

/* ================= LEVEL UP ================= */

let luQueue = [];
export function showLevelUp(lvl) { luQueue.push(lvl); if (luQueue.length === 1) playLU() }
function playLU() {
  const lvl = luQueue[0];
  const box = $('#luBody');
  const text = cfg().levelUpText;
  box.innerHTML = '<div class="k">Level Up</div><div class="v num">' + lvl + '</div>'
    + '<div class="u">' + (text[Math.min(lvl, text.length - 1)] || 'New things unlocked!') + '</div>';
  $('#lvlup').classList.add('on');
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
        const pos = FIELD_POS_SAFE(h.ref.index);
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

function FIELD_POS_SAFE(index) {
  const r = Math.floor(index / 4), c = index % 4;
  return [1.6 + c * 1.05, 1.5 + r * 1.05];
}

function onUp(e) {
  if (!dragging || S.openModal) { dragging = false; return }
  dragging = false;

  const swept = painted ? Object.keys(painted).map(Number) : [];
  if (swept.length) {
    const pos = FIELD_POS_SAFE(swept[swept.length - 1]);
    sendFarmer(pos[0], pos[1] + 0.6);
    act(function () { return api.plant(swept, S.sel) });
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
      const pos = FIELD_POS_SAFE(tile.index);
      sendFarmer(pos[0], pos[1] + 0.6);
      if (tile.crop) {
        if (tile.ready) {
          fx.spark(w2s(pos[0], pos[1]), 8);
          act(function () { return api.harvest(tile.index) });
        } else toast(itemName(tile.crop) + ' still growing', ICON[tile.crop]);
      } else {
        act(function () { return api.plant([tile.index], S.sel) });
      }
      break;
    }
    case 'machine': {
      const def = machineCfg(h.ref);
      if (def) sendFarmer(def.x, def.y + 0.9);
      const view = machineView(h.ref);
      if (view && Object.keys(view.done).length) {
        act(function () { return api.collectMachine(h.ref) }).then(function () { renderMachine(h.ref) });
      } else renderMachine(h.ref);
      break;
    }
    case 'pen': renderPen(h.ref); break;
    case 'animal': {
      const ref = h.ref;
      const def = penCfg(ref.pen);
      if (def) sendFarmer(def.hx, def.hy + 1);
      if (ref.state === 'ready') act(function () { return api.collectPen(ref.pen, ref.index) });
      else if (ref.state === 'hungry') act(function () { return api.feedPen(ref.pen, ref.index) });
      else toast(itemName(def.out) + ' on the way', ICON[def.out]);
      break;
    }
    case 'orders': renderOrders(); break;
    case 'market': openMarket(); break;
    case 'silo': case 'barn': renderStorage(); break;
  }
}

function dist2(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) }

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
  const bar = document.querySelector('[data-qbar="' + id + '"]');
  if (!bar || !view || !view.jobs[0]) return;
  const j = view.jobs[0];
  bar.style.width = (progress(j.startsAt, j.endsAt) * 100) + '%';
}

export function bootUI() {
  buildHUD(); buildDock(); buildRail(); bindInput();
  syncHUD(); syncBadges();
}
