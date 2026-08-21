/**
 * Asking to be told when the farm is ready.
 *
 * Two rules about when: never on load — a permission prompt before a player
 * has a farm is the fastest way to a permanent "no" — and only once the game
 * has actually given them something to wait for. So the ask happens the first
 * time a timer starts and the player has nothing else in front of them, and if
 * they dismiss it, it does not come back.
 */
import { api } from './net';
import { cfg } from './state';
import { t } from './i18n';

const ASKED_KEY = 'sunmil.pushAsked';

function supported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function asked(): boolean {
  try { return window.localStorage.getItem(ASKED_KEY) === '1' } catch { return false }
}

function markAsked(): void {
  try { window.localStorage.setItem(ASKED_KEY, '1') } catch { /* private mode */ }
}

/** base64url → the Uint8Array the PushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

let registration: ServiceWorkerRegistration | null = null;

/** Register the worker. Safe to call more than once; never throws. */
export async function initPush(): Promise<void> {
  if (!supported() || !cfg().features?.push) return;
  try {
    registration = await navigator.serviceWorker.register('/sw.js');
  } catch {
    registration = null;   // http, a locked-down browser — play still works
  }
}

/** Has this browser already agreed? */
export function pushOn(): boolean {
  return supported() && Notification.permission === 'granted';
}

/** Worth putting the question to this player? */
export function canAskPush(): boolean {
  return supported()
    && Boolean(cfg().features?.push)
    && Notification.permission === 'default'
    && !asked();
}

/**
 * Ask, and subscribe if they say yes. Returns whether the farm can now reach
 * them. Marks the ask either way — a second prompt for something they already
 * declined is how a browser starts blocking the site outright.
 */
export async function enablePush(): Promise<boolean> {
  markAsked();
  if (!supported() || !cfg().features?.push) return false;
  const key = cfg().vapidPublicKey;
  if (!key) return false;

  try {
    if (Notification.permission === 'default') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') return false;
    }
    if (Notification.permission !== 'granted') return false;
    if (!registration) await initPush();
    if (!registration) return false;

    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Copied into its own buffer: some TS DOM libs type this as BufferSource
      // and a Uint8Array over a SharedArrayBuffer would not satisfy it.
      applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

    await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch {
    return false;   // a refused prompt, a blocked worker — never a broken game
  }
}

/** They said no to our card, before the browser was ever asked. */
export function markPushDeclined(): void {
  markAsked();
}

/** Stop this browser being told. */
export async function disablePush(): Promise<void> {
  try {
    if (!registration) return;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => undefined);
    await api.unsubscribePush(endpoint).catch(() => undefined);
  } catch { /* nothing to undo */ }
}

/** The one-line offer, for whoever draws it. */
export function pushOfferText(): { title: string; body: string; yes: string; no: string } {
  return {
    title: t('push.title'),
    body: t('push.body'),
    yes: t('push.yes'),
    no: t('push.no'),
  };
}
