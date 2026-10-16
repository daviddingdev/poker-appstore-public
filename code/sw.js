const CACHE = 'pokerlog-v143';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './storage.js',
  './playbook.html', './horse.html', './howto.html', './privacy.html', './guide.js',
  // The Library's guides (LAUNCH_PLAN §8): four free, nine Pro chapters, one shared stylesheet.
  './learn.css', './learn-position.html', './learn-hands.html', './learn-pot-odds.html', './learn-leaks.html',
  './course-opening.html', './course-facing-raise.html', './course-reraised.html', './course-ranges.html',
  './course-flop.html', './course-facing-bets.html', './course-turn-river.html', './course-live-field.html',
  './course-results.html',
  './charts.js', './tables.js', './nash.js', './poker.js', './dealer.js', './postflop.js', './handeval.js', './equity.js',
  './app-core.js', './app-log.js', './app-history.js', './app-results.js', './app-data.js',
  './app-ui.js', './app-home.js', './app-progress.js', './app-boot.js',
  './study.js', './odds.js', './swings.js', './realspots.json', './realhands.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // There is no server and no API — everything is a local asset. Non-GET is not ours,
  // and neither is any other origin: nothing cross-origin may enter the app cache.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Atomic snapshot model: EVERYTHING is served from the installed cache generation.
  // The old network-first shell + cache-first modules meant the first load after a
  // deploy ran a NEW index.html against STALE app files — the shell and its nine
  // app-*.js slices share one top-level scope, so version skew there is a crash, not
  // a cosmetic bug. Updates arrive the standard way instead: a deploy bumps CACHE,
  // the changed sw.js installs the fresh snapshot in the background, and the next
  // load activates it whole. Offline always serves the last complete snapshot.
  // A navigation is answered with ITS OWN page when that page is in the snapshot. Only an
  // unknown navigation falls back to the shell. (Mapping every navigation to index.html
  // loaded the whole app inside the Guide window's iframe for howto/playbook/horse/privacy.)
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(e.request, {ignoreSearch: true})
        .then(hit => hit || (e.request.mode === 'navigate' ? c.match('./index.html') : undefined))
        .then(hit => hit || fetch(e.request).then(res => {
          c.put(e.request, res.clone());   // cache-miss fill (nothing today; safety net)
          return res;
        }))
    )
  );
});
