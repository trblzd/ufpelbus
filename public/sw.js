// public/sw.js
const CACHE_NAME = "busepel-v4";

// Recursos para cache offline (opcional)
const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
];

// Instalação - cache recursos estáticos
self.addEventListener("install", (event) => {
  console.log("[SW] Instalando...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Cacheando recursos...");
      return cache.addAll(FILES_TO_CACHE);
    }),
  );
  self.skipWaiting();
});

// Ativação - limpa caches antigos
self.addEventListener("activate", (event) => {
  console.log("[SW] Ativando...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[SW] Removendo cache antigo:", cache);
            return caches.delete(cache);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

// Interceptação de requisições
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // IGNORA extensões do navegador
  if (url.startsWith("chrome-extension://")) {
    return;
  }

  // Ignora métodos que não são GET
  if (event.request.method !== "GET") {
    return;
  }

  // Ignora APIs do Firebase
  if (
    url.includes("firebase") ||
    url.includes("firestore") ||
    url.includes("googleapis") ||
    url.includes("basemaps.cartocdn")
  ) {
    return;
  }

  // Estratégia: Cache First para recursos estáticos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fallback para rede
      return fetch(event.request)
        .then((response) => {
          // Cache apenas para recursos válidos
          if (
            !response ||
            response.status !== 200 ||
            response.type !== "basic"
          ) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // Fallback offline para navegação
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
    }),
  );
});
