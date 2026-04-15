try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (error) {
  // Ignore failures so offline caching still works even if the OneSignal CDN is unreachable.
}
const APP_CACHE = "tamu-app-v40";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./employee.html",
  "./umma-shop.html",
  "./styles.css",
  "./app.js",
  "./admin-page.js",
  "./employee-page.js",
  "./config.js",
  "./firebase.js",
  "./helpers.js",
  "./push.js",
  "./state.js",
  "./storage.js",
  "./ui.js",
  "./umma-shop.js",
  "./view-admin.js",
  "./view-common.js",
  "./view-employee.js",
  "./view-hotel.js",
  "./view-orders.js",
  "./view-restaurants.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];
const APP_ICON = "https://i.ibb.co/KzFZpw0V/Gemini-Generated-Image-bl807jbl807jbl80.png";

function resolveNotificationLink(link) {
  const fallback = self.registration.scope || "./";

  try {
    return new URL(link || "./", self.registration.scope).href;
  } catch (error) {
    return fallback;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== APP_CACHE) {
            return caches.delete(key);
          }

          return Promise.resolve(false);
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, responseClone));
        }

        return response;
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = resolveNotificationLink(event.notification.data?.link);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      const exactClient = clientList.find((client) => "focus" in client && client.url === targetUrl);

      if (exactClient) {
        return exactClient.focus();
      }

      const existingClient = clientList.find((client) => "focus" in client);

      if (existingClient) {
        if ("navigate" in existingClient) {
          await existingClient.navigate(targetUrl).catch(() => undefined);
        }

        return existingClient.focus();
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
