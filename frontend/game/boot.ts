// @ts-nocheck
/**
 * SUNMIL — startup and the frame loop.
 *
 * The loop renders; it never decides anything. Readiness comes from the server
 * snapshot, and the client re-syncs when a known timer elapses, when the tab
 * comes back to the foreground, and on a slow safety interval.
 */
import { api, NetError } from './net';
import { apply, cfg, S, setConfig, snap } from './state';
import { getHIT, cam, clampCam, farmerPos, fitCamera, initWorld, onResize, render, setAmbient, step } from './render';
import {
  awayCardOpen, bootUI, buildDock, buildRail, showAwayCard, syncBadges, syncHUD,
  tickPanels,
} from './ui';
import { errorText, initLang, t } from './i18n';
import { SITE_DOMAIN } from './brand';
import { demoSnapshot } from './demo';
import { connect, discoverWallets, signMessage, type WalletChoice } from './wallet';
import { initAudio, unlockAudio } from './audio';
import { mountJoystick, setJoystickVisible, unmountJoystick } from './joystick';
import { startGuide, stopGuide, tutorialSteps } from './guide';

const IDLE_SYNC_MS = 30_000;

let last = 0;
let started = false;
let loopStarted = false;
let syncTimer = null;
let idleTimer = null;
let lastLevel = 1;

function frame(ms) {
  const t = ms / 1000;
  let dt = last ? t - last : 0.016;
  last = t;
  if (dt > 0.1) dt = 0.1;
  if (started) {
    step(dt);
    render(t);
    window.__HITS = getHIT();
    tickPanels();
  }
  requestAnimationFrame(frame);
}

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  requestAnimationFrame(frame);
}

/** Pull a fresh snapshot; the response always wins. */
async function sync() {
  try {
    const before = S.snap ? S.snap.farm.level : 1;
    apply(await api.farm());
    syncHUD(); syncBadges();
    if (snap().farm.level !== before) { buildDock(); buildRail() }
    if (S.away) showAwayCard(maybeStartTutorial);
    scheduleSync();
  } catch (err) {
    if (err instanceof NetError && err.status === 401) return showLogin();
    // Offline: keep rendering the last known farm and try again shortly.
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 5000);
  }
}

/**
 * Re-sync just after the next thing is due to finish, so a crop that ripens
 * while the player is idle appears without polling every second.
 */
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  const s = S.snap;
  if (!s) return;
  const now = Date.now() + S.serverOffsetMs;
  let soonest = Infinity;

  const consider = (iso) => {
    if (!iso) return;
    const at = Date.parse(iso);
    if (at > now && at < soonest) soonest = at;
  };
  for (const t of s.farm.tiles) if (t.crop && !t.ready) consider(t.readyAt);
  for (const m of s.farm.machines) for (const j of m.jobs) consider(j.endsAt);
  for (const p of s.farm.pens) for (const a of p.animals) if (a.state === 'full') consider(a.readyAt);

  const delay = soonest === Infinity ? IDLE_SYNC_MS : Math.min(IDLE_SYNC_MS, Math.max(500, soonest - now + 300));
  syncTimer = setTimeout(sync, delay);
}

/* ================= LOGIN ================= */

/**
 * The gate has to clear before any login button exists. The server refuses to
 * mint a session without the invite cookie, so showing the buttons first would
 * only produce a 403 the player has no way to act on.
 */
async function showLogin(force = false) {
  try {
    const gate = await api.invite();
    if (gate.required && !gate.ok) return showInvite();
  } catch (err) {
    // Falling through quietly here is what made a build pointing at the wrong
    // API look like a farm with no gate: the check failed, the code box never
    // appeared, and the login button below it could not have worked either.
    // Say so instead.
    const net = err instanceof NetError ? err : null;
    return renderLogin(net ? errorText(net.code, net.message) : t('login.offline'), force);
  }
  renderLogin(undefined, force);
}

/**
 * Put something worth looking at behind the card. Only when there is no real
 * farm — a returning player gets their own, drifting, which is better.
 */
function installDemoScene() {
  if (S.snap || !S.config) return;
  apply(demoSnapshot(S.config));
  S.demo = true;   // after apply(), which clears it for real snapshots
  fitCamera();
}

/**
 * Name what actually went wrong.
 *
 * EIP-1193 providers reject with a numeric `code`; the ones a player can hit
 * are worth their own sentence. Anything unrecognised keeps the provider's own
 * message rather than swallowing it — an error nobody can read is an error
 * nobody can report.
 */
function walletError(err: unknown, wallet = ''): string {
  if (err instanceof NetError) return errorText(err.code, err.message);
  const code = (err as { code?: number | string } | null)?.code;
  if (code === 4001) return t('login.rejected');
  if (code === -32002) return t('login.pending');
  if (code === 4900 || code === 4901) return t('login.disconnected');
  const message = String((err as { message?: string } | null)?.message ?? '');
  // Phantom's wording when the account cannot do what was asked. It used to
  // mean "no Ethereum account"; now the app asks for Solana, so seeing it
  // again means the account itself is the wrong kind.
  if (/not supported|account for 60/i.test(message)) return t('login.noAccount', { wallet });
  return message ? `${t('login.failed')} (${message})` : t('login.failed');
}

/** The real address, so a player has something to check a fake against. */
const officialLine = () =>
  '<div class="official">' + t('brand.official') + ' <b>' + SITE_DOMAIN + '</b></div>';

function showCard(mode: string, force = false): HTMLElement | null {
  const intro = document.getElementById('intro');
  const card = intro.querySelector('.icard') as HTMLElement | null;
  intro.classList.remove('gone');
  (intro as HTMLElement).style.display = '';
  // The world drifts behind the card, and the game's own chrome stays hidden
  // until there is a farm to put in it.
  document.body.classList.add('pregame');
  setAmbient(true);
  // Same mode means the card is already on screen, and re-rendering it would
  // only steal focus from whatever the player is typing. `force` is for the
  // one case that has to redraw anyway: retrying after a failure, where the
  // card must come back without its stale error.
  if (!card || (card.dataset.mode === mode && !force)) return null;
  card.dataset.mode = mode;
  return card;
}

function showInvite() {
  const card = showCard('invite');
  if (!card) return;
  card.innerHTML =
    '<img class="brandmark" src="/brand/sunmil-logo-stacked.svg" alt="SUNMIL" width="760" height="600">'
    + '<div class="tl">' + t('invite.title') + '</div>'
    + '<p>' + t('invite.blurb') + '</p>'
    + '<div class="field" style="text-align:left">'
    + '<label for="inviteCode">' + t('invite.label') + '</label>'
    + '<input id="inviteCode" type="text" inputmode="numeric" autocomplete="one-time-code"'
    + ' maxlength="64" spellcheck="false">'
    + '</div>'
    + '<div id="inviteErr" class="form-err" style="display:none"></div>'
    + '<button class="btn gold go" id="btnInvite">' + t('invite.submit') + '</button>'
    + officialLine();

  const input = document.getElementById('inviteCode') as HTMLInputElement;
  const btn = document.getElementById('btnInvite') as HTMLButtonElement;
  const err = document.getElementById('inviteErr') as HTMLElement;
  input.focus();

  let busy = false;
  const submit = async () => {
    if (busy) return;
    const code = input.value.trim();
    if (!code) return input.focus();
    busy = true;
    btn.disabled = true;
    btn.textContent = t('invite.checking');
    err.style.display = 'none';
    unlockAudio();
    try {
      await api.redeemInvite(code);
      renderLogin();
    } catch (e) {
      const net = e instanceof NetError ? e : null;
      err.textContent = net && net.code === 'invite_invalid' ? t('invite.wrong')
        : net && net.status === 429 ? t('invite.tooMany')
        : t('invite.failed');
      err.style.display = '';
      input.select();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = t('invite.submit');
    }
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() });
}

/**
 * Where the farm key lives on this device. A player who clears site data or
 * moves browsers needs the key itself — there is no wallet and no email to
 * recover from — so the card shows it once and offers to restore from it.
 */
const KEY_STORE = 'sunmil.farmKey';

function readFarmKey(): string | null {
  try {
    const v = window.localStorage.getItem(KEY_STORE);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null; // private mode, or storage disabled — play still works
  }
}

function writeFarmKey(key: string) {
  try { window.localStorage.setItem(KEY_STORE, key) } catch { /* nothing to do */ }
}

function forgetFarmKey() {
  try { window.localStorage.removeItem(KEY_STORE) } catch { /* nothing to do */ }
}

/**
 * Is this the site's fault rather than the player's?
 *
 * A refused signature or a stale farm key is something only the player can
 * act on; an unreachable server or a 5xx is not, and telling them apart is the
 * difference between a card that reads as broken and one that reads as busy.
 */
function serverFault(err: unknown): boolean {
  return err instanceof NetError && (err.status === 0 || err.status >= 500);
}

function renderLogin(problem?: string, force = false) {
  const card = showCard('login', force);
  if (!card) return;
  const features = cfg().features;
  const returning = Boolean(readFarmKey());

  card.innerHTML =
    '<img class="brandmark" src="/brand/sunmil-logo-stacked.svg" alt="SUNMIL" width="760" height="600">'
    + '<div class="tl">' + t('intro.tagline') + '</div>'
    + '<p>' + t('login.blurb') + '</p>'
    + '<div id="loginErr" class="hint" style="display:none"><span class="d"></span>'
    + '<span><span id="loginErrTxt"></span>'
    + '<span id="loginErrWhose" style="display:none"> ' + t('login.ourFault') + '</span></span></div>'
    + '<button type="button" class="linkish" id="btnRetry" style="display:none">' + t('login.retry') + '</button>'
    + (features.guestLogin
      ? '<button class="btn gold go" id="btnPlay">'
        + (returning ? t('login.resume') : t('login.play')) + '</button>'
      : '')
    + (features.walletLogin
      ? '<button class="btn ' + (features.guestLogin ? 'wood' : 'gold') + ' go" id="btnWallet"'
        + (features.guestLogin ? ' style="margin-top:10px"' : '') + '>' + t('login.wallet') + '</button>'
        + '<div id="walletPick" class="wallet-pick" style="display:none"></div>'
      : '')
    + (features.guestLogin && !returning
      ? '<button type="button" class="linkish" id="btnRestore">' + t('login.haveKey') + '</button>'
      : '')
    + officialLine();

  /**
   * Show the reason, and — when the reason is ours — say so and offer the one
   * thing that can help. A player who taps the only button on the page and is
   * handed a bare sentence has no way to tell a broken site from a broken
   * device, and no reason to believe a second tap would land any differently.
   */
  const fail = (msg, ours = false) => {
    const box = document.getElementById('loginErr');
    box.classList.add('bad');
    document.getElementById('loginErrTxt').textContent = msg;
    (document.getElementById('loginErrWhose') as HTMLElement).style.display = ours ? '' : 'none';
    box.style.display = '';
    const retry = document.getElementById('btnRetry') as HTMLElement;
    if (retry) retry.style.display = ours ? '' : 'none';
  };
  if (problem) fail(problem, true);

  const retryBtn = document.getElementById('btnRetry');
  if (retryBtn) {
    retryBtn.addEventListener('pointerdown', function () {
      (retryBtn as HTMLButtonElement).disabled = true;
      // Re-checks the gate as well as the server: whatever was down may have
      // come back as something that changes which card belongs here.
      void showLogin(true);
    });
  }

  /** One place for "the server said no" so every path reads the same. */
  const loginFailed = (err) => {
    if (!(err instanceof NetError)) return t('login.failed');
    if (err.code === 'guest_unknown') { forgetFarmKey(); return t('login.keyGone') }
    return errorText(err.code, err.message);
  };

  const play = async (key?: string) => {
    const res = await api.loginGuest(key);
    if (res.created && res.key) {
      writeFarmKey(res.key);
      // Shown once, and only once — the server keeps a hash, not the key.
      return showKeyCard(res.key);
    }
    if (key) writeFarmKey(key);
    await afterLogin();
  };

  const playBtn = document.getElementById('btnPlay');
  if (playBtn) {
    playBtn.addEventListener('pointerdown', async function () {
      unlockAudio();
      (playBtn as HTMLButtonElement).disabled = true;
      try {
        await play(readFarmKey() || undefined);
      } catch (err) {
        // The gate cookie can lapse between the card being drawn and the
        // button being tapped. Telling that player "this beta needs an invite
        // code" while showing them no box to type one into is a dead end, so
        // send them to the card that can actually take it.
        if (err instanceof NetError && err.code === 'invite_required') return showInvite();
        fail(loginFailed(err), serverFault(err));
        (playBtn as HTMLButtonElement).disabled = false;
      }
    });
  }

  const restore = document.getElementById('btnRestore');
  if (restore) restore.addEventListener('pointerdown', () => showRestoreCard());

  if (!features.walletLogin) return;

  const signInWith = async (choice: WalletChoice) => {
    try {
      const address = await connect(choice);
      const { message } = await api.nonce(address);
      const signature = await signMessage(choice, message);
      await api.loginWallet(address, signature);
      await afterLogin();
    } catch (err) {
      // A wallet that refused, a popup already waiting, a wallet with no Solana
      // account, and a server that never answered are four different problems,
      // and only some of them are the player's to solve. Saying "could not sign
      // in with that wallet" for all four is how this stayed unexplained.
      if (err instanceof NetError && err.code === 'invite_required') return showInvite();
      fail(walletError(err, choice.name), serverFault(err));
    }
  };

  /** More than one wallet is installed, so the player chooses rather than the
   *  last extension to load choosing for them. */
  const showPicker = (wallets: WalletChoice[]) => {
    const host = document.getElementById('walletPick');
    if (!host) return;
    host.innerHTML = '<div class="pick-title">' + t('login.pick') + '</div>'
      + wallets.map((w, i) =>
        '<button class="btn wood pick" data-i="' + i + '">'
        + (w.icon ? '<img src="' + w.icon + '" alt="" width="20" height="20">' : '')
        + '<span></span></button>').join('');
    host.querySelectorAll('.pick').forEach((node, i) => {
      node.querySelector('span').textContent = wallets[i].name;
      node.addEventListener('pointerdown', () => { host.innerHTML = ''; signInWith(wallets[i]) });
    });
    host.style.display = '';
  };

  document.getElementById('btnWallet').addEventListener('pointerdown', async function () {
    unlockAudio();
    const wallets = await discoverWallets();
    if (!wallets.length) return fail(t('login.noWallet'));
    if (wallets.length === 1) return signInWith(wallets[0]);
    showPicker(wallets);
  });
}

/**
 * The farm key, said once. Everything about this card assumes the player will
 * lose it otherwise: it is selectable, copyable, and the way past it is a
 * button that admits what happens if they did not write it down.
 */
function showKeyCard(key: string) {
  const card = showCard('farmkey');
  if (!card) return afterLogin();
  card.innerHTML =
    '<div class="tl">' + t('key.title') + '</div>'
    + '<p>' + t('key.blurb') + '</p>'
    + '<div class="farmkey" id="farmKeyText"></div>'
    + '<button class="btn wood go" id="btnCopyKey">' + t('key.copy') + '</button>'
    + '<div id="keyErr" class="form-err" style="display:none;margin-top:10px"></div>'
    + '<button class="btn gold go" id="btnKeyGo" style="margin-top:10px">' + t('key.go') + '</button>';

  // textContent, not innerHTML: the key is data, and it renders as typed.
  document.getElementById('farmKeyText').textContent = key;

  const copy = document.getElementById('btnCopyKey') as HTMLButtonElement;
  copy.addEventListener('pointerdown', async function () {
    try {
      await navigator.clipboard.writeText(key);
      copy.textContent = t('key.copied');
    } catch {
      // No clipboard permission — the key is on screen and selectable anyway.
      copy.textContent = t('key.copyManually');
    }
  });

  const go = document.getElementById('btnKeyGo') as HTMLButtonElement;
  const err = document.getElementById('keyErr') as HTMLElement;
  go.addEventListener('pointerdown', async function () {
    unlockAudio();
    go.disabled = true;
    err.style.display = 'none';
    try {
      await afterLogin();
    } catch (e) {
      // The farm exists — the session was minted a moment ago — so this is the
      // server going out from under a player already through the door.
      // Unhandled, it left them holding a card that had quietly stopped
      // working. Said inline rather than on the offline card, because this
      // card is the only time the key is ever shown and replacing it would
      // take the key away at the exact moment they were asked to save it.
      err.textContent = e instanceof NetError ? errorText(e.code, e.message) : t('login.offline');
      err.style.display = '';
      go.disabled = false;
    }
  });
}

/** Coming back on a device that has never held this farm's key. */
function showRestoreCard() {
  const card = showCard('restore');
  if (!card) return;
  card.innerHTML =
    '<div class="tl">' + t('restore.title') + '</div>'
    + '<p>' + t('restore.blurb') + '</p>'
    + '<div class="field" style="text-align:left">'
    + '<label for="farmKeyIn">' + t('restore.label') + '</label>'
    + '<input id="farmKeyIn" class="key" type="text" autocomplete="off" spellcheck="false" maxlength="64">'
    + '</div>'
    + '<div id="restoreErr" class="form-err" style="display:none"></div>'
    + '<button class="btn gold go" id="btnRestoreGo">' + t('restore.submit') + '</button>'
    + '<button type="button" class="linkish" id="btnRestoreBack">' + t('restore.back') + '</button>';

  const input = document.getElementById('farmKeyIn') as HTMLInputElement;
  const btn = document.getElementById('btnRestoreGo') as HTMLButtonElement;
  const err = document.getElementById('restoreErr') as HTMLElement;
  input.focus();

  const submit = async () => {
    const key = input.value.trim();
    if (!key) return input.focus();
    btn.disabled = true;
    err.style.display = 'none';
    unlockAudio();
    try {
      await api.loginGuest(key);
      writeFarmKey(key);
      await afterLogin();
    } catch (e) {
      err.textContent = e instanceof NetError && e.code === 'guest_unknown'
        ? t('restore.wrong')
        : e instanceof NetError ? errorText(e.code, e.message)
        : t('login.failed');
      err.style.display = '';
      input.select();
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() });
  document.getElementById('btnRestoreBack')
    .addEventListener('pointerdown', () => renderLogin());
}


async function afterLogin() {
  apply(await api.farm());
  entered = true;   // the intro is being dismissed here, not by enterFromIntro
  lastLevel = snap().farm.level;
  buildDock(); buildRail(); syncHUD(); syncBadges();
  scheduleSync();
  dismissIntro();
  maybeStartTutorial();
}

/**
 * A player who has never finished the guide gets it on their first farm. It
 * waits on real state at every step, so someone who ignores it and plays their
 * own way simply walks through it without noticing.
 */
function maybeStartTutorial() {
  const tutorial = S.snap?.tutorial;
  if (!tutorial || tutorial.done) return;
  // The away card gets read first; the guide would only dim it.
  if (awayCardOpen()) return;
  window.setTimeout(function () {
    if (awayCardOpen()) return;
    startGuide({
      id: 'tutorial',
      steps: tutorialSteps(),
      onFinish: function (completed) {
        void api.setTutorial(completed ? { done: true } : { step: 1 }).catch(function () {});
      },
    });
  }, 700);
}

function dismissIntro() {
  const intro = document.getElementById('intro');
  intro.classList.add('gone');
  // Hand the camera back to the player and let the HUD in.
  setAmbient(false);
  fitCamera();
  document.body.classList.remove('pregame');
  setTimeout(function () { intro.style.display = 'none' }, 520);
}

/* ================= BOOT ================= */

/**
 * Startup, made retriable.
 *
 * Everything below the config fetch needs game data — buildDecor() reads the
 * pen list, the dock reads the crop list — so a failed /api/config used to end
 * boot() with a bare `return`. What that left on screen was the card that
 * ships in the page: a Start farming button with no listener behind it, on a
 * canvas that was never initialised, under a toast that cleared itself after
 * two seconds. The player was then looking at a game that could not be
 * started and would not say why, and only a reload could change that. A
 * session that survived a server outage landed in the same place, because the
 * first farm read failed the same way.
 *
 * Both now land on a card that names the reason, says it is not the player's
 * device, and offers Try again — and keeps retrying on its own with a widening
 * gap, so a server that comes back finds the player already in the game.
 */
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 30_000;
let retryMs = RETRY_MIN_MS;
let retryTimer = null;
/** initWorld/bootUI are one-time and need config; this is what guards them. */
let worldReady = false;
/** The handover into the game happens once, whichever attempt gets there. */
let entered = false;
let attempting = false;

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  retryMs = RETRY_MIN_MS;
}

/** The one card in the game that is never a dead end. */
function showOffline(err: unknown) {
  const reason = err instanceof NetError ? errorText(err.code, err.message) : t('login.offline');
  const card = showCard('offline');
  if (card) {
    card.innerHTML =
      '<img class="brandmark" src="/brand/sunmil-logo-stacked.svg" alt="SUNMIL" width="760" height="600">'
      + '<div class="tl">' + t('intro.tagline') + '</div>'
      + '<p>' + t('offline.blurb') + '</p>'
      + '<div class="hint bad"><span class="d"></span>'
      + '<span><span id="bootErrTxt"></span> ' + t('login.ourFault') + '</span></div>'
      + '<button class="btn gold go" id="btnBootRetry">' + t('login.retry') + '</button>'
      + officialLine();
    const retry = document.getElementById('btnBootRetry') as HTMLButtonElement;
    retry.addEventListener('pointerdown', function () {
      unlockAudio();
      retry.disabled = true;
      retry.textContent = t('offline.trying');
      clearRetry();
      void attempt();
    });
  }

  // A retry that fails again keeps the card and only refreshes the reason —
  // what comes back may be a different problem, and re-rendering the card
  // under the player's thumb would take the button away mid-tap.
  const txt = document.getElementById('bootErrTxt');
  if (txt) txt.textContent = reason;
  const retry = document.getElementById('btnBootRetry') as HTMLButtonElement | null;
  if (retry) { retry.disabled = false; retry.textContent = t('login.retry') }

  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(function () { retryTimer = null; void attempt() }, retryMs);
  // Widening, so a long outage is not a request every three seconds from every
  // tab anyone left open.
  retryMs = Math.min(RETRY_MAX_MS, Math.round(retryMs * 1.6));
}

/** One pass at starting: the config, then the world, then the farm. */
async function attempt() {
  if (attempting) return;
  attempting = true;
  try {
    if (!S.config) {
      try {
        setConfig(await api.config());
      } catch (err) {
        return showOffline(err);
      }
    }

    if (!worldReady) {
      initWorld();
      bootUI();
      mountJoystick();
      // Every path into the game passes through #intro — the invite gate, the
      // login card, and the first-run card a returning player still taps
      // through. All of them sit on the live world, so the game's own chrome
      // stays out until that card is dismissed.
      document.body.classList.add('pregame');
      setAmbient(true);
      installDemoScene();
      started = true;
      startLoop();

      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', function () { setTimeout(onResize, 200) });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) sync() });

      // Slow safety net on top of the timer-driven syncs.
      idleTimer = setInterval(function () { if (!document.hidden && S.snap && !S.demo) sync() }, IDLE_SYNC_MS);

      localiseIntro();
      worldReady = true;
    }

    try {
      apply(await api.farm());
    } catch (err) {
      // No session is not a failure — it is the login card.
      if (err instanceof NetError && err.status === 401) { clearRetry(); return showLogin() }
      // Anything else is the server's, and a player holding a session must not
      // be dropped onto an intro card that cannot do anything for them.
      return showOffline(err);
    }

    clearRetry();
    lastLevel = snap().farm.level;
    buildDock(); buildRail(); syncHUD(); syncBadges();
    scheduleSync();
    enterFromIntro();
  } finally {
    attempting = false;
  }
}

/**
 * Hand the farm over.
 *
 * The card that ships in the page is still there on a clean load, and a
 * returning player taps through it. Once a failure has replaced that card
 * there is nothing left to tap and the player has already tapped Try again, so
 * go straight in rather than asking for a second tap on a button that no
 * longer exists.
 */
function enterFromIntro() {
  if (entered) return;
  entered = true;
  const go = document.getElementById('introGo') as HTMLButtonElement | null;
  const start = function () {
    dismissIntro();
    // If they were away, that card comes first and starts the guide after.
    if (!showAwayCard(maybeStartTutorial)) maybeStartTutorial();
  };
  if (!go) return start();
  go.disabled = false;
  go.addEventListener('pointerdown', function () { unlockAudio(); start() });
}

export async function boot() {
  window.__CAM = cam;
  window.__clampCam = clampCam;
  window.__HITS = [];
  // Read-only, for browser-smoke.mjs — the same reason __CAM and __HITS are here.
  window.__farmerPos = farmerPos;

  initLang();
  initAudio();

  // This button ships in the page, so it exists before the code that makes it
  // work does. Disabled until the farm is in hand, rather than silently
  // swallowing the first tap.
  const go = document.getElementById('introGo') as HTMLButtonElement | null;
  if (go) go.disabled = true;

  // Coming back to the tab is exactly the moment a stuck card should try
  // again. The widening gap above is for a tab nobody is looking at; a player
  // who just looked at it should not be made to wait out the tail of it.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !retryTimer) return;
    clearRetry();
    void attempt();
  });

  await attempt();
}

/** The intro card is static markup; fill it in for the current language. */
function localiseIntro() {
  const setText = (id, html) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = html;
  };
  setText('introTagline', t('intro.tagline'));
  setText('introBlurb', t('intro.blurb'));
  setText('introHint1', t('intro.hint1'));
  setText('introHint2', t('intro.hint2'));
  setText('introGo', t('intro.start'));

  const scale = cfg().timeScale;
  setText('introScale', scale === 1
    ? t('intro.hintFast')
    : t('intro.hintReal', { n: Math.max(1, Math.round(cfg().items.wheat.growSeconds / 60)) }));
}

export function shutdown() {
  if (syncTimer) clearTimeout(syncTimer);
  if (idleTimer) clearInterval(idleTimer);
  if (retryTimer) clearTimeout(retryTimer);
  stopGuide(false);
  unmountJoystick();
  started = false;
  // The module outlives this — the dynamic import is cached — so the one-time
  // guards have to come back down with it. Left standing, the next boot()
  // would skip initWorld and the joystick and render nothing. React's dev
  // StrictMode mounts the effect twice, so that next boot() is not theoretical.
  worldReady = false;
  entered = false;
  attempting = false;
}
