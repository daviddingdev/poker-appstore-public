const CACHE = 'pokerlog-v101';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './storage.js',
  './playbook.html', './horse.html',
  './charts.js', './nash.js', './poker.js', './dealer.js', './postflop.js', './handeval.js', './study.js', './realspots.json', './realhands.json'];

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
  // There is no server and no API — everything is a local asset. Non-GET is not ours.
  if (e.request.method !== 'GET') return;

  // app shell: network-first so updates propagate, cache fallback for offline
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')){
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // static assets: cache-first with background refresh
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
