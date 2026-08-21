/**
 * SUNMIL — service worker.
 *
 * Notifications only. It deliberately caches nothing: the game is one canvas
 * driven by a server that is authoritative for every number on screen, and a
 * cached shell that shows a stale farm would be worse than no offline mode at
 * all. The client already handles being unable to reach the server.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'SUNMIL';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Your farm needs you.',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    // One tag for the whole "farm is ready" family: a player who was away for
    // a day comes back to one notification, not to a stack of them.
    tag: data.tag || 'sunmil',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus the tab the player already has open rather than opening a second
    // one onto the same farm.
    for (const client of all) {
      if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
