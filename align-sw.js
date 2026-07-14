/* align-sw.js — Align Service Worker
 * Network-first for JS/CSS (must not serve stale code)
 * Network-first for HTML (must see version bumps)
 * Cache-first for images/fonts (safe to cache aggressively)
 * Network-only for API (data freshness)
 */

var CACHE = 'align-v53';

// Install: pre-cache nothing — load on demand
self.addEventListener('install', function () {
  self.skipWaiting();
});

// Activate: clean OLD caches only, keep current, claim clients
self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch routing
self.addEventListener('fetch', function (ev) {
  var url = new URL(ev.request.url);

  // API calls: network only — never cache
  if (url.pathname.startsWith('/api/')) {
    ev.respondWith(fetch(ev.request));
    return;
  }

  // JS and CSS: network-first, no stale cache
  if (url.pathname.match(/\.(js|css)(\?|$)/)) {
    ev.respondWith(
      fetch(ev.request).catch(function () {
        return caches.match(ev.request);
      })
    );
    return;
  }

  // HTML: network-first
  if (ev.request.destination === 'document' || url.pathname === '/') {
    ev.respondWith(
      fetch(ev.request).catch(function () {
        return caches.match(ev.request);
      })
    );
    return;
  }

  // Images, fonts, other static: cache-first (safe to cache forever)
  ev.respondWith(
    caches.match(ev.request).then(function (cached) {
      return cached || fetch(ev.request).then(function (res) {
        if (res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(ev.request, clone); });
        }
        return res;
      });
    })
  );
});
