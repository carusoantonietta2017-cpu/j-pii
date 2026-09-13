/* ocr-pi PWA hardening WP6: cache statici locale, mai /api/ in cache.
 * IMPORTANTE: a ogni modifica di index.html/styles.css/app.js/icon.svg/manifest.json
 * bumpa CACHE (v2 -> v3 ...): il browser reinstalla il SW solo se sw.js cambia,
 * e con cache-first un nome fermo servirebbe JS stanco per sempre (dock restore). */
const CACHE = "ocr-pi-v2";
const CORE = ["./", "./index.html", "./styles.css", "./app.js", "./icon.svg", "./manifest.json"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/api/")) return; // mai cachare API/wiki
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match("./index.html"))));
});
