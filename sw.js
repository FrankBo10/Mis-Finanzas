// Service worker: guarda los archivos de la app en el móvil para que
// funcione sin internet. NO guarda ni toca tus datos.
//
// IMPORTANTE: si cambias cualquier archivo de la app, sube este número
// (y pon el mismo en js/version.js) para que los móviles descarguen la versión nueva.
const CACHE = 'mis-finanzas-v1.4';

const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/util.js', './js/crypto.js', './js/storage.js', './js/model.js',
  './js/bio.js', './js/charts.js', './js/version.js', './js/forms.js', './js/views.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))) // 'reload' = descarga siempre de internet, no de la memoria del navegador
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
