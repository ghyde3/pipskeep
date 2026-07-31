/*
 * PipsKeep — round 2I (docs/notifications-bible.md §7.2/§7.3).
 *
 * Pulled INTO the existing vite-plugin-pwa service worker via
 * `workbox.importScripts` — this is not a second service worker, and the
 * owner's "web only, one SW" decision is the reason it is written this
 * way. It contains no game logic and no state, because a service worker
 * cannot import our modules and must never be trusted with rules.
 *
 * ITS ONLY JOB: make a delivered notification tappable. Without this, a
 * notification shown by `registration.showNotification()` does nothing at
 * all when clicked — it does not even dismiss. That is a dead end at the
 * exact moment the round exists to serve, so the handler ships even
 * though the outbox/`periodicsync` half of bible §2.4 (Tier 2) does not.
 *
 * Where a tap LANDS is deliberately not decided here. Focusing the app is
 * enough: `app/ticker.ts` dispatches CATCHUP on becoming visible, which
 * settles the trip and opens the loot reveal / Doorstep through the exact
 * same path a player who opened the tab themselves would take. One
 * destination, one code path, no duplicate routing to drift.
 */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
      return undefined;
    })(),
  );
});
