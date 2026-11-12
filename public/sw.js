// Swapsmith service worker: makes the app installable and lets the shell open offline.
// Only same-origin GETs are handled. Scryfall calls pass straight through; src/scryfall/client.ts
// already caches them in IndexedDB. Bump VERSION to drop old caches.
const VERSION = 'v2';
const CACHE = `swapsmith-shell-${VERSION}`;
const SCOPE = self.registration.scope;
/** Files that are not part of the build (public/), needed to open and install the app. */
const PUBLIC_FILES = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png'];
const isBuilt = (url) => url.pathname.startsWith(new URL('assets/', SCOPE).pathname);

/**
 * Saves the page and every built file (listed in precache.json, written by the build) at install, so
 * the app opens offline after one visit instead of two. A file that fails is fetched when first used.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  const list = await fetch(new URL('precache.json', SCOPE), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : []), () => []);
  const files = Array.isArray(list) ? list.filter((f) => typeof f === 'string') : [];
  // Only addresses inside the app are ever saved, whatever the list says.
  const urls = ['./', ...PUBLIC_FILES, ...files].map((f) => new URL(f, SCOPE).href).filter((u) => u.startsWith(SCOPE));
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url, { ignoreVary: true })) return;
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch {
        // Offline or blocked: the fetch handler saves it later.
      }
    }),
  );
  // Built files have hashed names and are never reused by a later deploy: drop the ones no longer listed.
  if (files.length) {
    const keep = new Set(urls);
    for (const req of await cache.keys()) if (isBuilt(new URL(req.url)) && !keep.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('swapsmith-shell-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first so a deploy shows up on the next load; cached copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(new URL('./', SCOPE).href, copy));
          return res;
        })
        .catch(async () => (await caches.match(new URL('./', SCOPE).href, { ignoreVary: true })) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Matched by address alone: these are static files, and a script tag's request differs from the
      // install-time one in headers a server may list in Vary (Vite's preview lists Origin).
      const cached = await cache.match(request, { ignoreVary: true });
      // Built files (hashed names) never change: the saved copy is the answer, with no request at all.
      if (cached && isBuilt(url)) return cached;
      // Icons and the manifest: serve the saved copy, refresh it in the background.
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => undefined);
      return cached ?? (await refresh) ?? Response.error();
    }),
  );
});
