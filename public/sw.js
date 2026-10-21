// Service worker: shows table-invite notifications (Web Push) and opens the table when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: 'Capsa Banting', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(n.title || 'Capsa Banting', {
    body: n.body || '', tag: n.tag, renotify: !!n.tag, data: n.data || {},
    icon: '/icon-192.png', badge: '/badge-96.png', vibrate: [200, 100, 200],
    actions: n.data && n.data.room ? [{ action: 'join', title: 'Gabung' }] : [],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = new URL(data.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      win.postMessage({ type: 'invite', room: data.room });
      return win.focus();
    }
    return self.clients.openWindow(url);
  })());
});
