const cacheName = "lockdulu-shell-v2";
const shell = ["/offline.html", "/icon.svg", "/icon-maskable.svg", "/icon-192.png", "/icon-512.png", "/manifest.json"];

self.addEventListener("install", event => {
  // Let an update wait until existing pages close so checkout keeps its current controller.
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(shell.map(path => new Request(path, { cache: "reload" })))
  ));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("lockdulu-shell-") && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(async () => {
      const offline = await caches.match("/offline.html", { cacheName });
      // Serve the shell at the requested URL, without the cached asset's response URL.
      return offline ? new Response(offline.body, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      }) : Response.error();
    }));
    return;
  }
  if (shell.includes(url.pathname)) {
    event.respondWith(caches.match(request, { cacheName }).then(cached => cached ?? fetch(request)));
  }
});
