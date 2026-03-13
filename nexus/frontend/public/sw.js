/**
 * NEXUS Service Worker
 *
 * Strategy:
 *   /assets/*  → Cache-forever  (Vite content-hashes these — immutable)
 *   fonts      → Cache-forever  (external font files never change)
 *   /api/*     → Network-only   (always fresh auth/data)
 *   navigation → Stale-while-revalidate (show cached shell instantly, update in bg)
 *   everything else → Network-first with cache fallback
 */

const SHELL_CACHE  = 'nexus-shell-v4';
const ASSETS_CACHE = 'nexus-assets-v2';
const FONT_CACHE   = 'nexus-fonts-v2';

const ALL_CACHES = [SHELL_CACHE, ASSETS_CACHE, FONT_CACHE];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/']))
      .then(() => self.skipWaiting()), // take over immediately
  );
});

// ── Activate: clean up obsolete caches ───────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      // Claim all existing clients so this SW serves them immediately.
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle http/https — the Cache API rejects chrome-extension://, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept non-GET requests
  if (request.method !== 'GET') return;

  // API calls → always go to network (never serve stale auth/data)
  if (url.pathname.startsWith('/api/')) return;

  // Content-hashed Vite assets → cache forever (these never change)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheForever(ASSETS_CACHE, request));
    return;
  }

  // External font files (fonts.gstatic.com) → cache forever
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheForever(FONT_CACHE, request));
    return;
  }

  // Google Fonts stylesheet → cache with revalidation (responds fast, updates in bg)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(FONT_CACHE, request));
    return;
  }

  // HTML navigation → network-first so deployments take effect immediately.
  // Stale-while-revalidate would serve an old index.html (e.g. one without a
  // critical inline redirect) and only update on the *next* visit, which breaks
  // things like the HTTP→HTTPS redirect we rely on for PKCE auth.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCache(SHELL_CACHE, request));
    return;
  }

  // Remaining static assets → network-first with cache fallback
  event.respondWith(networkFirstWithCache(SHELL_CACHE, request));
});

// ── Cache strategies ──────────────────────────────────────────────────────────

/** Cache-forever: serve from cache; fetch + cache on miss. Never revalidates. */
async function cacheForever(cacheName, request) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/**
 * Stale-while-revalidate: respond instantly from cache, refresh in background.
 * On cache miss, wait for network.
 */
async function staleWhileRevalidate(cacheName, request) {
  const cache       = await caches.open(cacheName);
  const cached      = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached ?? (await fetchPromise);
}

/** Network-first: try network; fall back to cache on failure. */
async function networkFirstWithCache(cacheName, request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('Offline', { status: 503 });
  }
}
