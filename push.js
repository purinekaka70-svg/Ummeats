import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-functions.js";
import { FCM_WEB_PUSH_PUBLIC_KEY } from "./config.js";
import { db, functions } from "./firebase.js";
import { showToast } from "./ui.js";

const PUSH_SUBSCRIPTIONS = "pushSubscriptions";
const PUSH_TOKEN_STORAGE_KEY = "TAMU_PUSH_TOKEN";
const PUSH_NOTIFICATION_ICON = "./icons/icon-192.png";
let foregroundListenerBound = false;
const upsertPushSubscriptionCallable = httpsCallable(functions, "upsertPushSubscription");
const removePushSubscriptionCallable = httpsCallable(functions, "removePushSubscription");

async function showForegroundNotification(title, body, registration, link) {
  if (Notification.permission !== "granted") {
    return;
  }

  const options = {
    badge: PUSH_NOTIFICATION_ICON,
    body,
    data: {
      link: link || window.location.href,
    },
    icon: PUSH_NOTIFICATION_ICON,
  };

  if (registration?.showNotification) {
    try {
      await registration.showNotification(title, options);
      return;
    } catch (error) {
      console.warn("Foreground browser notification failed", error);
    }
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      if (options.data?.link) {
        window.location.href = options.data.link;
      }
    };
  } catch (error) {
    console.warn("Fallback notification failed", error);
  }
}

async function getMessagingContext() {
  if (!FCM_WEB_PUSH_PUBLIC_KEY) {
    return null;
  }

  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return null;
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return null;
  }

  const existingRegistration = await navigator.serviceWorker.getRegistration("./");
  const registration = existingRegistration || (await navigator.serviceWorker.register("./sw.js"));
  const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
  const messaging = getMessaging();

  if (!foregroundListenerBound) {
    foregroundListenerBound = true;
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || "New notification";
      const body = payload.notification?.body || payload.data?.body || "You have a new update.";
      showToast(`${title}: ${body}`, "info");
      void showForegroundNotification(title, body, readyRegistration || registration, payload.data?.link);
    });
  }

  return { messaging, registration: readyRegistration || registration };
}

async function resolvePushToken(options = {}) {
  const { requestPermission = true, silent = false } = options;
  const context = await getMessagingContext();
  if (!context) {
    return null;
  }

  if (requestPermission && Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      if (!silent) {
        showToast("Push notifications were not enabled.", "warn");
      }
      return null;
    }
  }

  if (Notification.permission !== "granted") {
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    return null;
  }

  const storedToken = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  const token = await getToken(context.messaging, {
    vapidKey: FCM_WEB_PUSH_PUBLIC_KEY,
    serviceWorkerRegistration: context.registration,
  }).catch((error) => {
    console.error("Push token request failed", error);
    if (!silent) {
      showToast("Failed to enable push notifications.", "error");
    }
    return null;
  });

  if (token) {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    if (!silent && token !== storedToken) {
      showToast("Push notifications enabled on this device.", "success");
    }
  }

  return token || storedToken;
}

async function upsertSubscriptionRecord(payload) {
  try {
    await upsertPushSubscriptionCallable(payload);
    return true;
  } catch (error) {
    console.warn("Callable push subscription save failed, trying Firestore fallback", error);
  }

  const snapshot = await getDocs(query(collection(db, PUSH_SUBSCRIPTIONS), where("token", "==", payload.token)));
  const match = snapshot.docs.find((item) => item.data().target === payload.target);

  if (match) {
    await updateDoc(match.ref, payload);
    return true;
  }

  await addDoc(collection(db, PUSH_SUBSCRIPTIONS), {
    ...payload,
    createdAt: Date.now(),
  });

  return true;
}

async function removeSubscriptionRecord(target, token) {
  try {
    await removePushSubscriptionCallable({ target, token });
    return true;
  } catch (error) {
    console.warn("Callable push subscription removal failed, trying Firestore fallback", error);
  }

  const snapshot = await getDocs(query(collection(db, PUSH_SUBSCRIPTIONS), where("token", "==", token)));
  for (const item of snapshot.docs) {
    if (item.data().target === target) {
      await deleteDoc(item.ref);
    }
  }

  return true;
}

export async function registerPushSubscription(target, label, options = {}) {
  if (!target) {
    return false;
  }

  try {
    const token = await resolvePushToken(options);
    if (!token) {
      return false;
    }

    const payload = {
      label,
      target,
      token,
      updatedAt: Date.now(),
    };

    return upsertSubscriptionRecord(payload);
  } catch (error) {
    console.error("Push registration failed", error);
    if (!options.silent) {
      showToast("Push notifications could not be enabled.", "warn");
    }
    return false;
  }
}

export async function unregisterPushSubscription(target) {
  if (!target) {
    return false;
  }

  try {
    const token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || (await resolvePushToken({ requestPermission: false, silent: true }));
    if (!token) {
      return false;
    }

    await removeSubscriptionRecord(target, token);

    return true;
  } catch (error) {
    console.error("Push unregistration failed", error);
    return false;
  }
}
