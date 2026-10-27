// Service worker del Reloj Ajedrez (generado al compilar desde sw-template.js).
// Guarda la app y Stockfish en la tablet para abrir y jugar contra el motor sin internet.
const VERSION = '__VERSION__'
const CORE = __CORE__                                  // archivos de esta versión de la app
const CACHE = 'reloj-app-' + VERSION
// El motor va en una caché aparte que NO cambia con cada versión de la app:
// la red neuronal (40 MB) se descarga una sola vez.
const ENGINE_CACHE = 'reloj-engine-sf16'
const ENGINE = ['stockfish/stockfish-nnue-16-single.js', 'stockfish/stockfish-nnue-16-single.wasm']
const NNUE = 'stockfish/nn-5af11540bbfe.nnue'

const url = p => new URL(p, self.registration.scope).href
// ignoreVary: los scripts de la app se piden con cabecera Origin (type="module") y el servidor
// responde con "Vary: Origin"; sin esto la copia guardada no coincidiría sin conexión.
const MATCH = { ignoreSearch: true, ignoreVary: true }

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(CACHE)
    await app.addAll(CORE.map(url))
    const eng = await caches.open(ENGINE_CACHE)
    for (const f of [...ENGINE, NNUE]) {
      // Si la red neuronal no baja (red lenta), no se bloquea la instalación: se reintenta
      // cuando el motor la pida, y mientras tanto juega con evaluación clásica.
      if (!(await eng.match(url(f), MATCH))) await eng.add(url(f)).catch(() => {})
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('reloj-app-') && k !== CACHE) await caches.delete(k)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return   // Lichess, etc.: directo a la red

  // Páginas: primero la red (para recibir actualizaciones); sin red, la copia guardada
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 4000)
        const res = await fetch(req, { signal: ctrl.signal })
        clearTimeout(t)
        return res
      } catch {
        return (await caches.match(url('index.html'), MATCH)) || (await caches.match(url('./'), MATCH)) || Response.error()
      }
    })())
    return
  }

  // Motor y demás archivos: primero la caché
  const isEngine = req.url.includes('/stockfish/')
  event.respondWith((async () => {
    const cache = await caches.open(isEngine ? ENGINE_CACHE : CACHE)
    const hit = await cache.match(req, MATCH)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {})
    return res
  })())
})
