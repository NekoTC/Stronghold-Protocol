const CACHE = 'stronghold-v3';
// Classic service worker for art a player imported on this origin.
// Keep these three lines in sync with public/js/assetCache.js (that module documents why this file is not a module).
const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';
const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';
const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/css/theme.css',
  '/css/components.css',
  '/css/devices.css',
  '/css/screens/title.css',
  '/css/screens/lobby.css',
  '/css/screens/game.css',
  '/js/main.js',
  '/js/store.js',
  '/js/net.js',
  '/js/data.js',
  '/js/assets.js',
  '/js/runtime.js',
  '/vendor/preact.module.js',
  '/vendor/hooks.module.js',
  '/vendor/htm.module.js'
];

// Essential data files for offline single-player mode
const DATA_FILES = [
  '/data/config.json',
  '/data/chess.json',
  '/data/bonds.json',
  '/data/items.json',
  '/data/bands.json',
  '/data/enemies.json',
  '/data/bosses.json',
  '/data/stages.json',
  '/data/tokens.json',
  '/data/choices.json',
  '/data/assets.json'
];

// Install: cache shell and essential data
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Try to cache data files, but don't fail if they're not available yet
    try {
      await Promise.allSettled(DATA_FILES.map(url =>
        fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
      ));
    } catch (err) {
      console.warn('[sw] Data files not cached during install:', err);
    }
    await self.skipWaiting();
  })());
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('stronghold-') && key !== CACHE) {
        await caches.delete(key);
      }
    }
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(IMPORTED_ASSET_CACHE_PREFIX) && name !== IMPORTED_ASSET_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Fetch: imported art is served from its own cache; the PWA shell is network-first for HTML/API,
// cache-first for assets, with a cache fallback when offline.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;

  const url = new URL(r.url);
  const path = url.pathname;

  if (IMPORTED_ASSET_PATH.test(path)) {
    if (r.headers.has('range')) return;
    e.respondWith((async () => {
      const cache = await caches.open(IMPORTED_ASSET_CACHE);
      // The exact key: an import stores each URL without a query, so the path is the key. `ignoreSearch` would make
      // Chrome scan every entry — about 4 s per request once a whole pack (some 43,000 entries) is imported.
      const hit = await cache.match(url.origin + url.pathname);
      if (hit) return hit;
      // Do not cache the network response. The browser's own HTTP cache still applies to this fetch.
      return fetch(r);
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // For navigation requests, try network first, fallback to cached index
    if (r.mode === 'navigate') {
      try {
        const networkResponse = await fetch(r);
        if (networkResponse.ok) {
          cache.put(r, networkResponse.clone()).catch(() => {});
          return networkResponse;
        }
      } catch {
        // Network failed, return cached index
        const cachedResponse = await cache.match('/');
        if (cachedResponse) return cachedResponse;
      }
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }

    // For data files, try cache first (for offline mode), then network
    if (path.startsWith('/data/') && path.endsWith('.json')) {
      const cachedResponse = await cache.match(r);
      if (cachedResponse) {
        // Update cache in background
        fetch(r).then(networkResponse => {
          if (networkResponse.ok) cache.put(r, networkResponse.clone()).catch(() => {});
        }).catch(() => {});
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(r);
        if (networkResponse.ok) {
          cache.put(r, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // For static assets (JS, CSS, fonts, images), cache-first
    if (r.destination === 'script' || r.destination === 'style' ||
        r.destination === 'font' || r.destination === 'image' ||
        path.startsWith('/assets/') || path.startsWith('/fonts/')) {
      const cachedResponse = await cache.match(r);
      if (cachedResponse) return cachedResponse;

      try {
        const networkResponse = await fetch(r);
        if (networkResponse.ok) {
          cache.put(r, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    }

    // For everything else, network-first
    try {
      const networkResponse = await fetch(r);
      if (networkResponse.ok && networkResponse.status < 400) {
        cache.put(r, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch {
      const cachedResponse = await cache.match(r);
      if (cachedResponse) return cachedResponse;
      return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});

// Message handler for cache management
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data && e.data.type === 'CACHE_URLS') {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const urls = e.data.urls || [];
      await Promise.allSettled(urls.map(url =>
        fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
      ));
    })());
  }
});
