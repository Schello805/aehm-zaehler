const CACHE_NAME = 'aehm-zaehler-v3'
const STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png',
  '/favicon.png',
  '/favicon.svg',
  '/icons.svg'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache prefetch note:', err)
      })
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // 1. NEVER intercept Cross-Origin requests (podcasts, external CDNs, Matomo, YouTube, etc.)
  if (url.origin !== self.location.origin) {
    return
  }

  // 2. NEVER intercept non-GET requests or API calls (SSE streams, uploads, status)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api')) {
    return
  }

  // 3. NEVER intercept Audio/Video media or HTTP Range requests
  // WebKit / Safari throws "TypeError: Load failed" in FetchEvent.respondWith for media range requests
  if (
    event.request.headers.has('range') ||
    event.request.destination === 'audio' ||
    event.request.destination === 'video' ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.wav') ||
    url.pathname.endsWith('.m4a') ||
    url.pathname.endsWith('.ogg') ||
    url.pathname.endsWith('.webm')
  ) {
    return
  }

  // 4. Navigation / HTML: ALWAYS Network-First to guarantee newest asset hashes
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/index.html') || caches.match('/'))
        .catch(() => new Response('Netzwerkfehler', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
    )
    return
  }

  // 5. Static Assets: Network-First with Cache fallback for scripts/styles
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(event.request)
          return cached || new Response('', { status: 404 })
        })
    )
    return
  }

  // 6. Other local assets (images, icons): Cache-First with Network Fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => new Response('', { status: 404 }))
    })
  )
})
