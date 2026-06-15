// public/sw.js
const CACHE_NAME = "busepel-v4";

self.addEventListener("install", (event) => {
  console.log("[SW] Instalado");
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // IGNORA COMPLETAMENTE requisições de extensões
  if (url.startsWith("chrome-extension://")) {
    return; // Não faz nada, deixa o navegador lidar
  }

  // Ignora métodos que não são GET
  if (event.request.method !== "GET") {
    return;
  }

  // Ignora APIs do Firebase
  if (
    url.includes("firebase") ||
    url.includes("firestore") ||
    url.includes("googleapis")
  ) {
    return;
  }

  // Para navegação (páginas) - apenas fallback offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("/index.html");
        return cached || new Response("Página offline", { status: 503 });
      }),
    );
    return;
  }

  // Para outros recursos, busca da rede normalmente
  event.respondWith(fetch(event.request));
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Ativado");
  event.waitUntil(clients.claim());
});
