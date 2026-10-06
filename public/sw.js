// nullboard service worker.
//   HTML (navigations):  network first, cached copy when offline
//   static assets:       cache first
//   /api/*:              never touched, always goes to the network
//
// CACHE_NAME and PRECACHE are rewritten by scripts/stamp-build.mjs on every
// deploy (`npm run deploy` runs it). A new CACHE_NAME is what makes browsers
// drop the old assets, so never ship without stamping.

const CACHE_NAME = 'nullboard-202610060743-17aa628';
const PRECACHE = [
  '/',
  '/css/app.css',
  '/css/nullobj-tokens.css',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon.svg',
  '/js/actions.js',
  '/js/api.js',
  '/js/appearance.js',
  '/js/auth-ui.js',
  '/js/capture.js',
  '/js/dnd.js',
  '/js/dom.js',
  '/js/icons.js',
  '/js/main.js',
  '/js/model.js',
  '/js/panel.js',
  '/js/qr.js',
  '/js/session.js',
  '/js/shell.js',
  '/js/store.js',
  '/js/tile-sheet.js',
  '/js/ui.js',
  '/js/views/board.js',
  '/js/views/focus.js',
  '/js/views/import.js',
  '/js/views/lists.js',
  '/js/views/review.js',
  '/js/views/settings.js',
  '/js/views/streak.js',
  '/manifest.webmanifest',
  '/vendor/qrcode.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  const isPage = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put('/', copy)); }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // Same-origin files and the Google Fonts CSS and font files are kept.
      const keep = res.ok || res.type === 'opaque';
      const cacheable = url.origin === location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
      if (keep && cacheable) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
      return res;
    })));
});
