// ═══════════════════════════════════════════════════
//  ALDIA APP — sw.js v5
//  Service Worker: cache + offline + install prompt
// ═══════════════════════════════════════════════════

const CACHE_NAME    = "aldia-v1.0.10";
const CACHE_STATIC  = "aldia-static-v1.0.10";
const CACHE_DYNAMIC = "aldia-dynamic-v1.0.10";

// Recursos que se cachean al instalar (shell de la app)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/admin.html",
  "/style.css",
  "/script.js",
  "/admin.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/notification-icon.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  // Fuentes de Google (pre-cache para offline)
  "https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap",
];

// Recursos que NUNCA se cachean (siempre red)
const NEVER_CACHE = [
  "firebase",
  "googleapis",
  "cloudflarestorage",
  "mpago.la",
  "wa.me",
  "/notificar",
  "/boleta/subir",
  "/sms/",
];

// ════════════════════════════════════════════════════
//  INSTALL — pre-cachear shell de la app
// ════════════════════════════════════════════════════
self.addEventListener("install", event => {
  console.log("[SW] Instalando v1.0.10...");
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(
        STATIC_ASSETS.map(url => new Request(url, { cache: "reload" }))
      ))
      .then(() => {
        console.log("[SW] Instalado correctamente");
        return self.skipWaiting(); // activa inmediatamente sin esperar recarga
      })
      .catch(err => console.warn("[SW] Error en install:", err))
  );
});

// ════════════════════════════════════════════════════
//  ACTIVATE — limpiar caches viejas
// ════════════════════════════════════════════════════
self.addEventListener("activate", event => {
  console.log("[SW] Activando v1.0.10...");
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log("[SW] Eliminando cache vieja:", k);
            return caches.delete(k);
          })
      ))
      .then(() => {
        console.log("[SW] Activado. Tomando control de clientes.");
        return self.clients.claim();
      }).then(() => {
        // Notificar a todos los clientes que el SW se actualizó
        return self.clients.matchAll({ type:"window" }).then(clients => {
          clients.forEach(c => c.postMessage({ type:"SW_UPDATED" }));
        });
      })
  );
});

// ════════════════════════════════════════════════════
//  FETCH — estrategia de caché
// ════════════════════════════════════════════════════
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar http/https
  if (!request.url.startsWith("http")) return;

  // Nunca cachear estas URLs (siempre ir a la red)
  if (NEVER_CACHE.some(nc => request.url.includes(nc))) return;

  // HTML siempre desde la red (para detectar actualizaciones)
  if (request.mode === "navigate" ||
      request.url.endsWith(".html") ||
      request.url.endsWith("/")) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // JS y CSS con versión — Cache First (el ?v= garantiza frescura)
  if (request.url.includes("?v=")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Para assets estáticos → Cache First
  if (STATIC_ASSETS.some(a => request.url.endsWith(a) || url.pathname === a)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Para fuentes e imágenes → Cache First con TTL largo
  if (
    url.hostname.includes("fonts.g") ||
    request.destination === "image"  ||
    request.destination === "font"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Para todo lo demás → Network First
  event.respondWith(networkFirst(request));
});

// ── Cache First: busca en caché, si no hay va a la red ──
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Sin conexión", { status: 503 });
  }
}

// ── Network First: va a la red, si falla usa caché ──────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("Sin conexión", { status: 503 });
  }
}

// ── Network First con página offline como fallback ───────
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Intentar desde caché
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback a index.html (para que la PWA funcione offline)
    const fallback = await caches.match("/index.html");
    return fallback || new Response(offlinePage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
}

// ── Página offline mínima ────────────────────────────────
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AlDía Digital — Sin conexión</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#070b14;color:#f0f4ff;
         min-height:100dvh;display:flex;align-items:center;justify-content:center;
         flex-direction:column;gap:16px;padding:24px;text-align:center}
    .icon{font-size:48px}
    h1{font-size:22px;font-weight:800;letter-spacing:-.5px}
    p{font-size:14px;color:#8892aa;line-height:1.6;max-width:280px}
    button{margin-top:8px;padding:14px 28px;background:linear-gradient(135deg,#28e07a,#00c2ff);
           border:none;border-radius:12px;color:#070b14;font-size:14px;
           font-weight:700;cursor:pointer}
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>Sin conexión</h1>
  <p>No hay conexión a internet. Revisá tu red y volvé a intentarlo.</p>
  <button onclick="location.reload()">Reintentar</button>
</body>
</html>`;
}

// ════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
//  Manejadas por firebase-messaging-sw.js (FCM)
//  No duplicar aquí para evitar notificaciones dobles
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
//  SYNC EN BACKGROUND — cuando vuelve la conexión
// ════════════════════════════════════════════════════
self.addEventListener("sync", event => {
  if (event.tag === "sync-pendientes") {
    console.log("[SW] Background sync — verificando pendientes...");
    // En producción: re-intentar operaciones fallidas offline
  }
});

// ════════════════════════════════════════════════════
//  MENSAJE DESDE LA APP
// ════════════════════════════════════════════════════
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
