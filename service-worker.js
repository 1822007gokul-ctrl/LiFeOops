const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './supabase-config.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

const CACHE_NAME = 'lifeoops-v1';

function shouldBypassCache(url) {
  if (!url) {
    return true;
  }

  const hasSupabaseHost = url.hostname.includes('supabase.co');
  const hasAuthPath = url.pathname.includes('/auth/') || url.pathname.includes('/auth');
  const hasApiPath = url.pathname.includes('/rest/') || url.pathname.includes('/storage/') || url.pathname.includes('/functions/') || url.pathname.includes('/rpc/');

  return hasSupabaseHost || hasAuthPath || hasApiPath;
}

self.addEventListener('install', (event) => {
  console.log('LifeOops Service Worker installing');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => {
        self.skipWaiting();
      })
      .catch((error) => {
        console.error('LifeOops Service Worker install failed:', error);
        throw error;
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const oldKeys = keys.filter((key) => key.startsWith('lifeoops-') && key !== CACHE_NAME);
        return Promise.all(oldKeys.map((key) => caches.delete(key)));
      })
      .then(() => {
        console.log('LifeOops Service Worker ready');
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (shouldBypassCache(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
