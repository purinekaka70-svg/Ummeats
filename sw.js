/* global importScripts, firebase */

const APP_CACHE = "tamu-app-v22";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./umma-shop.html",
  "./styles.css",
  "./app.js",
  "./admin-page.js",
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
  "./view-hotel.js",
  "./view-orders.js",
  "./view-restaurants.js",
  "./manifest.webmanifest",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];
const APP_ICON = "./icons/icon-192.svg";

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

importScripts("https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyApi2RjwEXEW2mTwCMiYERKUNAYL8Toddk",
  authDomain: "tamuexpress-26e4a.firebaseapp.com",
  projectId: "tamuexpress-26e4a",
  storageBucket: "tamuexpress-26e4a.appspot.com",
  messagingSenderId: "202068792631",
  appId: "1:202068792631:web:8a9b97028ebd7a45af76b2",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || "New notification";
  const body = data.body || "You have a new update from Tamu Express.";

  self.registration.showNotification(title, {
    body,
    icon: APP_ICON,
    badge: APP_ICON,
    data: {
      link: data.link || self.registration.scope || "./",
    },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.link || self.registration.scope || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => "focus" in client);

      if (existingClient) {
        return existingClient.focus();
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
