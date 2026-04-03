/* global importScripts, firebase */

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
const APP_ICON = "https://i.ibb.co/KcFc8xn5/Gemini-Generated-Image-jokiqjjokiqjjoki.png";

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
