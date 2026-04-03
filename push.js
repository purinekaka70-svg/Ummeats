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
import { FCM_WEB_PUSH_PUBLIC_KEY } from "./config.js";
import { db } from "./firebase.js";
import { showToast } from "./ui.js";

const PUSH_SUBSCRIPTIONS = "pushSubscriptions";
const PUSH_TOKEN_STORAGE_KEY = "TAMU_PUSH_TOKEN";
let foregroundListenerBound = false;

async function getMessagingContext() {
  if (!FCM_WEB_PUSH_PUBLIC_KEY) {
    return null;
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return null;
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return null;
  }

  const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const messaging = getMessaging();

  if (!foregroundListenerBound) {
    foregroundListenerBound = true;
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || "New notification";
      const body = payload.notification?.body || payload.data?.body || "You have a new update.";
      showToast(`${title}: ${body}`, "info");
    });
  }

  return { messaging, registration };
}

async function resolvePushToken(requestPermission = true) {
  const context = await getMessagingContext();
  if (!context) {
    return null;
  }

  if (requestPermission && Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Push notifications were not enabled.", "warn");
      return null;
    }
  }

  if (Notification.permission !== "granted") {
    return localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  }

  const token = await getToken(context.messaging, {
    vapidKey: FCM_WEB_PUSH_PUBLIC_KEY,
    serviceWorkerRegistration: context.registration,
  }).catch((error) => {
    console.error("Push token request failed", error);
    showToast("Failed to enable push notifications.", "error");
    return null;
  });

  if (token) {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  }

  return token || localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function registerPushSubscription(target, label) {
  if (!target) {
    return false;
  }

  try {
    const token = await resolvePushToken(true);
    if (!token) {
      return false;
    }

    const snapshot = await getDocs(query(collection(db, PUSH_SUBSCRIPTIONS), where("token", "==", token)));
    const match = snapshot.docs.find((item) => item.data().target === target);
    const payload = {
      label,
      target,
      token,
      updatedAt: Date.now(),
    };

    if (match) {
      await updateDoc(match.ref, payload);
    } else {
      await addDoc(collection(db, PUSH_SUBSCRIPTIONS), {
        ...payload,
        createdAt: Date.now(),
      });
    }

    return true;
  } catch (error) {
    console.error("Push registration failed", error);
    showToast("Push notifications could not be enabled.", "warn");
    return false;
  }
}

export async function unregisterPushSubscription(target) {
  if (!target) {
    return false;
  }

  try {
    const token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || (await resolvePushToken(false));
    if (!token) {
      return false;
    }

    const snapshot = await getDocs(query(collection(db, PUSH_SUBSCRIPTIONS), where("token", "==", token)));
    for (const item of snapshot.docs) {
      if (item.data().target === target) {
        await deleteDoc(item.ref);
      }
    }

    return true;
  } catch (error) {
    console.error("Push unregistration failed", error);
    return false;
  }
}
