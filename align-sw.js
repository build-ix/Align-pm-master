/* align-sw.js — Align Service Worker
 * Offline-first: caches app shell on install, serves from cache when offline.
 * Stale-while-revalidate for all static assets.
 */

var CACHE = 'align-v51';
var SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/align-storage.css',
  '/align-files.css',
  '/align-drawings.css',
  '/align-daily-logs.css',
  '/align-punchlist.css',
  '/align-contacts.css',
  '/align-tasks.css',
  '/align-photos.css',
  '/align-auth.css',
  '/align-schedule.css',
  '/align-specs.css',
  '/align-budget.css',
  '/align-procurement.css',
  '/align-rfis.css',
  '/align-api.js',
  '/align-errors.js',
  '/align-sync.js',
  '/align-vitals.js',
  '/align-a11y.js',
  '/align-storage.js',
  '/align-boot.js',
  '/align-files.js',
  '/align-projects.js',
  '/align-drawings.js',
  '/align-drawing-annotations.js',
  '/align-daily-logs.js',
  '/align-punchlist.js',
  '/align-schedule.js',
  '/align-rfis.js',
  '/align-budget.js',
  '/align-specs.js',
  '/align-procurement.js',
  '/align-contacts.js',
  '/align-tasks.js',
  '/align-photos.js',
  '/align-auth.js',
  '/align-settings.js',
  '/script.js'
];

// Install: pre-cache app shell
self.addEventListener('install', function (ev) {
  // Activate immediately — don't wait for old SW to release
  self.skipWaiting();
  ev.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL).catch(function (err) {
        // Don't fail install if some files are missing
        console.warn('[SW] Cache addAll partial fail:', err);
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: stale-while-revalidate for static, network-first for API and HTML
self.addEventListener('fetch', function (ev) {
  var url = new URL(ev.request.url);

  // API calls: network first, no cache (data must be fresh)
  if (url.pathname.startsWith('/api/')) {
    ev.respondWith(
      fetch(ev.request).catch(function () {
        return new Response(JSON.stringify({ error: 'Offline — no connection' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // HTML: network first (must see version bumps for cache-busted assets)
  if (ev.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    ev.respondWith(
      fetch(ev.request).catch(function () {
        return caches.match(ev.request);
      })
    );
    return;
  }

  // External requests (Open-Meteo, CDNs, etc.): pass through — don't cache
  if (!url.hostname.includes(self.location.hostname)) {
    return;
  }

  // Static assets: stale-while-revalidate
  ev.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(ev.request).then(function (cached) {
        var fetchPromise = fetch(ev.request).then(function (networkResponse) {
          if (networkResponse && networkResponse.ok) {
            cache.put(ev.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(function () {
          // Network failed — return cached if available
        });
        return cached || fetchPromise;
      });
    })
  );
});
