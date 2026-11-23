const CACHE_NAME = "editalradar-app-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./pwa-icon.svg"
];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const shellUrls = APP_SHELL.map((path) => new URL(path, self.registration.scope).href);
  const requiredShellUrls = shellUrls.slice(0, 2);
  const optionalShellUrls = shellUrls.slice(2);

  // The document and app root are required for recovery; icons/manifest are
  // optional and must not prevent a safe service-worker update.
  await Promise.all(requiredShellUrls.map((url) => cache.add(url)));
  await Promise.allSettled(optionalShellUrls.map((url) => cache.add(url)));

  // Include Vite's fingerprinted JS/CSS bundles so the app can boot offline
  // immediately after its first successful online visit.
  const indexUrl = new URL("./index.html", self.registration.scope).href;
  const indexResponse = await cache.match(indexUrl);
  if (!indexResponse) return;

  const markup = await indexResponse.text();
  const assetPaths = [...markup.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.(?:m?js|css)(?:\?[^"']*)?)["']/gi)]
    .map((match) => new URL(match[1], self.registration.scope))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href);

  if (assetPaths.length > 0) {
    // The entry bundles are required to boot offline. Keep the current worker
    // active if any required JavaScript or CSS asset cannot be cached yet.
    await cache.addAll([...new Set(assetPaths)]);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("editalradar-app-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const controller = new AbortController();
      const timeoutId = self.setTimeout(() => controller.abort(), 4500);
      try {
        // Em redes instáveis, não deixa a navegação presa indefinidamente antes do cache.
        const response = await fetch(request, { signal: controller.signal });
        const cache = await caches.open(CACHE_NAME);
        if (response.ok) {
          await cache.put(request, response.clone()).catch(() => {});
          return response;
        }

        // Preserva a última versão funcional durante falhas temporárias do servidor.
        if (response.status >= 500 || response.status === 408 || response.status === 429) {
          const exactPage = await cache.match(request);
          const appShell = await cache.match(new URL("./index.html", self.registration.scope).href);
          return exactPage || appShell || response;
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const exactPage = await cache.match(request);
        const appShell = await cache.match(new URL("./index.html", self.registration.scope).href);
        return exactPage || appShell || Response.error();
      } finally {
        self.clearTimeout(timeoutId);
      }
    })());
    return;
  }

  const isStaticAsset = ["script", "style", "worker", "font", "image"].includes(request.destination)
    || url.pathname.endsWith(".webmanifest");
  if (!isStaticAsset) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Asset pre-caching can use a request without the Origin header,
      // while modulepreload later includes it. Ignore Vary so the same
      // same-origin bundle remains available when offline.
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
  );
});
