// Remote control's service worker (spec §6.5): shows the daemon's Web Push notifications and
// opens the page at the thread's project when one is tapped. The daemon encrypts each one for
// this browser, so the push service that carries it cannot read it.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Cedian", {
      body: data.body || "",
      tag: data.tag,
      icon: "icon.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only a page of this origin: the daemon sends a path, never another site.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const win of windows) {
        try {
          await win.navigate(url);
          return win.focus();
        } catch {}
      }
      return self.clients.openWindow(url);
    })(),
  );
});
