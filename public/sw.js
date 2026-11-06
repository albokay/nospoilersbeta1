// Sidebar's background worker (push notifications CP1, 2026-11-05).
//
// Push ONLY: it shows a notification when one arrives and opens the right
// page when it's tapped. There is deliberately no fetch handler: it caches
// nothing and never stands between the app and the network, so it can't
// serve anyone an old build. It's registered only on a device that turned
// notifications on (src/lib/push.ts).

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  // An iPhone/iPad Home Screen app already prints "from Sidebar" under the
  // title, so a "Sidebar" title read "Sidebar / from Sidebar" (his catch,
  // 11-05): there the title is left empty and the message follows the one
  // "from Sidebar". Computers have no such line and keep the title.
  const apple = /iPhone|iPad|iPod/.test(self.navigator.userAgent || "");
  const title = apple ? "" : (data.title || "Sidebar");
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  };
  if (data.tag) options.tag = data.tag;
  // Every push shows a notification (browsers require it; iPhones revoke
  // permission from sites that push silently).
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      try {
        await w.focus();
        if ("navigate" in w) await w.navigate(url);
        return;
      } catch (_) { /* fall through to a fresh window */ }
    }
    await self.clients.openWindow(url);
  })());
});
