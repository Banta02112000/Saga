// Saga website: an offline copy of the app and of the posters and covers it shows.
// The app's own files: fresh from the server when it answers within 2.5 s, else the saved copy (so an update never
// mixes old and new files). Pictures: the saved copy at once, refreshed in the background (stale-while-revalidate).
// Your data (/api/…) and the sign-in page are never stored here.
"use strict";
const SHELL = "saga-shell-1", IMG = "saga-img-1", IMG_MAX = 800;
const IMG_HOSTS = /(^|\.)(image\.tmdb\.org|media-amazon\.com|myanimelist\.net|steamstatic\.com|books\.google\.com|googleusercontent\.com|igdb\.com)$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== IMG) await caches.delete(k);
  await self.clients.claim();
})()));

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - IMG_MAX; i++) await cache.delete(keys[i]);
}

async function shell(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(r => {
    if (r.ok && !r.redirected && r.type === "basic") cache.put(req, r.clone());
    return r;
  });
  const late = new Promise(res => setTimeout(res, 2500, null));
  const first = await Promise.race([net.catch(() => null), late]);
  if (first) return first;
  const saved = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
  return saved || net; // nothing saved yet: wait for the server after all
}

async function picture(req) {
  const cache = await caches.open(IMG);
  const saved = await cache.match(req);
  const net = fetch(req).then(r => {
    if (r.ok || r.type === "opaque") cache.put(req, r.clone()).then(() => trim(cache)).catch(() => {});
    return r;
  });
  if (saved) { net.catch(() => {}); return saved; }
  return net;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (/\/(api\/|login|sw\.js$)/.test(u.pathname)) return; // straight to the server
    e.respondWith(shell(req));
    return;
  }
  if (req.destination === "image" || IMG_HOSTS.test(u.hostname)) {
    if (IMG_HOSTS.test(u.hostname)) e.respondWith(picture(req));
  }
});
