import {
  ONESIGNAL_APP_ID,
  ONESIGNAL_SAFARI_WEB_ID,
  ONESIGNAL_SERVICE_WORKER_PATH,
  ONESIGNAL_SERVICE_WORKER_SCOPE,
} from "./config.js";
import { showToast } from "./ui.js";

const ONESIGNAL_SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const PUSH_NOTIFICATION_ICON = "./icons/icon-192.png";
const NOTIFICATION_TAG_TTL_MS = 8000;
let foregroundListenerBound = false;
let identityListenersBound = false;
let notificationRegistrationPromise = null;
let oneSignalReadyPromise = null;
let activePushIdentity = null;
let identitySyncPromise = null;
const recentNotificationTags = new Map();

function pruneRecentNotificationTags(now = Date.now()) {
  recentNotificationTags.forEach((timestamp, tag) => {
    if (now - timestamp > NOTIFICATION_TAG_TTL_MS) {
      recentNotificationTags.delete(tag);
    }
  });
}

function isLocalhostOrigin() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function normalizePushTarget(target) {
  return String(target || "").trim();
}

function resolveOneSignalPath(pathname) {
  return new URL(pathname, window.location.href).pathname;
}

function ensureOneSignalPageScript() {
  if (document.querySelector(`script[src="${ONESIGNAL_SDK_URL}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = ONESIGNAL_SDK_URL;
  document.head.appendChild(script);
}

async function showForegroundNotification(title, body, registration, notificationOptions = {}) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }

  const options = {
    badge: PUSH_NOTIFICATION_ICON,
    body,
    data: {
      link: notificationOptions.link || window.location.href,
    },
    icon: PUSH_NOTIFICATION_ICON,
    tag: notificationOptions.tag,
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

async function getNotificationRegistration() {
  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return null;
  }

  if (!notificationRegistrationPromise) {
    notificationRegistrationPromise = (async () => {
      const existingRegistration = await navigator.serviceWorker.getRegistration();
      const registration = existingRegistration || (await navigator.serviceWorker.register("./sw.js"));
      return navigator.serviceWorker.ready.catch(() => registration);
    })().catch((error) => {
      console.warn("Notification service worker registration failed", error);
      notificationRegistrationPromise = null;
      return null;
    });
  }

  return notificationRegistrationPromise;
}

function bindOneSignalForegroundListeners(OneSignal) {
  if (foregroundListenerBound) {
    return;
  }

  foregroundListenerBound = true;
  OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event) => {
    const title = event.notification?.title || "New notification";
    const body = event.notification?.body || "You have a new update.";
    const link = event.notification?.launchURL || window.location.href;
    const tag = event.notification?.notificationId || `${title}:${body}`;

    if (!claimNotificationTag(tag)) {
      return;
    }

    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link,
      tag,
    });
  });
}

function buildPushIdentity(target, label, options = {}) {
  const externalId = normalizePushTarget(target);
  if (!externalId) {
    return null;
  }

  const role = String(options.role || (externalId === "admin" ? "admin" : "hotel")).trim().toLowerCase();
  const identity = {
    customerId: "",
    externalId,
    hotelId: "",
    label: String(label || externalId).trim().slice(0, 80),
    role,
  };

  if (role === "hotel") {
    identity.hotelId = String(options.hotelId || externalId).trim();
  }

  if (role === "customer") {
    identity.customerId = String(options.customerId || externalId).trim();
  }

  return identity;
}

function createPushTags(identity) {
  const tags = {
    notification_label: identity.label,
    notification_role: identity.role,
    notification_target: identity.externalId,
    role: identity.role,
  };

  if (identity.hotelId) {
    tags.hotel_id = identity.hotelId;
  }

  if (identity.customerId) {
    tags.customer_id = identity.customerId;
  }

  return tags;
}

async function syncOneSignalIdentity(OneSignal, identity, options = {}) {
  if (!OneSignal || !identity?.externalId) {
    return false;
  }

  await OneSignal.login(identity.externalId);
  await OneSignal.User.addTags(createPushTags(identity));

  if (options.ensureOptIn && OneSignal.Notifications.permission && !OneSignal.User.PushSubscription.optedIn) {
    await OneSignal.User.PushSubscription.optIn();
  }

  return true;
}

function refreshCachedIdentity(OneSignal, options = {}) {
  if (!activePushIdentity?.externalId) {
    return Promise.resolve(false);
  }

  if (!identitySyncPromise) {
    identitySyncPromise = syncOneSignalIdentity(OneSignal, activePushIdentity, options)
      .catch((error) => {
        console.warn("OneSignal identity refresh failed", error);
        return false;
      })
      .finally(() => {
        identitySyncPromise = null;
      });
  }

  return identitySyncPromise;
}

function bindOneSignalIdentityListeners(OneSignal) {
  if (identityListenersBound) {
    return;
  }

  identityListenersBound = true;

  OneSignal.Notifications.addEventListener("permissionChange", (permission) => {
    if (!permission) {
      return;
    }

    void refreshCachedIdentity(OneSignal, { ensureOptIn: true });
  });

  OneSignal.User.PushSubscription.addEventListener("change", (event) => {
    const previous = event?.previous || {};
    const current = event?.current || {};
    const subscriptionChanged =
      previous.id !== current.id ||
      previous.token !== current.token ||
      (current.optedIn && !previous.optedIn);

    if (!subscriptionChanged) {
      return;
    }

    void refreshCachedIdentity(OneSignal, { ensureOptIn: false });
  });
}

async function getOneSignal() {
  if (oneSignalReadyPromise) {
    return oneSignalReadyPromise;
  }

  if (
    window.OneSignal &&
    typeof window.OneSignal === "object" &&
    typeof window.OneSignal.Notifications?.isPushSupported === "function"
  ) {
    bindOneSignalForegroundListeners(window.OneSignal);
    bindOneSignalIdentityListeners(window.OneSignal);
    return window.OneSignal;
  }

  const appId = String(ONESIGNAL_APP_ID || "").trim();
  if (!appId) {
    return null;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  ensureOneSignalPageScript();

  oneSignalReadyPromise = new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      oneSignalReadyPromise = null;
      reject(new Error("OneSignal SDK load timed out."));
    }, 15000);

    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          allowLocalhostAsSecureOrigin: isLocalhostOrigin(),
          appId,
          autoResubscribe: true,
          notificationClickHandlerAction: "navigate",
          notificationClickHandlerMatch: "origin",
          notifyButton: {
            enable: true,
          },
          safari_web_id: String(ONESIGNAL_SAFARI_WEB_ID || "").trim() || undefined,
          serviceWorkerParam: {
            scope: resolveOneSignalPath(ONESIGNAL_SERVICE_WORKER_SCOPE),
          },
          serviceWorkerPath: resolveOneSignalPath(ONESIGNAL_SERVICE_WORKER_PATH),
          welcomeNotification: {
            disable: true,
          },
        });

        OneSignal.Notifications.setDefaultTitle("Tamu Express");
        OneSignal.Notifications.setDefaultUrl(new URL("./index.html", window.location.href).href);
        bindOneSignalForegroundListeners(OneSignal);
        bindOneSignalIdentityListeners(OneSignal);
        window.clearTimeout(timeoutId);
        resolve(OneSignal);
      } catch (error) {
        window.clearTimeout(timeoutId);
        oneSignalReadyPromise = null;
        reject(error);
      }
    });
  }).catch((error) => {
    console.warn("OneSignal initialization failed", error);
    return null;
  });

  return oneSignalReadyPromise;
}

async function ensureOneSignalPush(options = {}) {
  const { requestPermission = true, silent = false } = options;
  const OneSignal = await getOneSignal();
  if (!OneSignal) {
    if (!silent) {
      showToast("OneSignal is not configured correctly for browser push.", "warn");
    }
    return null;
  }

  if (!OneSignal.Notifications.isPushSupported()) {
    if (!silent) {
      showToast("This browser does not support push notifications.", "warn");
    }
    return null;
  }

  if (requestPermission && !OneSignal.Notifications.permission) {
    await OneSignal.Notifications.requestPermission();
  }

  return OneSignal;
}

export async function registerPushSubscription(target, label, options = {}) {
  const identity = buildPushIdentity(target, label, options);
  if (!identity) {
    return false;
  }

  const OneSignal = await ensureOneSignalPush(options);
  if (!OneSignal) {
    return false;
  }

  try {
    activePushIdentity = identity;

    if (!(await syncOneSignalIdentity(OneSignal, identity, { ensureOptIn: true }))) {
      return false;
    }

    if (OneSignal.Notifications.permission) {
      if (!options.silent) {
        showToast("Browser notifications enabled on this device.", "success");
      }
      return true;
    }

    if (!options.silent) {
      showToast("Push notifications were not enabled.", "warn");
    }
    return false;
  } catch (error) {
    console.error("OneSignal push registration failed", error);
    if (!options.silent) {
      showToast("Push notifications could not be enabled.", "warn");
    }
    return false;
  }
}

export async function unregisterPushSubscription() {
  const OneSignal = await getOneSignal();
  if (!OneSignal) {
    return false;
  }

  try {
    activePushIdentity = null;
    await OneSignal.User.PushSubscription.optOut();
    await OneSignal.logout();
    return true;
  } catch (error) {
    console.error("OneSignal push unregistration failed", error);
    return false;
  }
}

export async function showBrowserNotification(title, body, options = {}) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }

  const registration = await getNotificationRegistration();
  await showForegroundNotification(title, body, registration, options);
  return true;
}

export function claimNotificationTag(tag) {
  const normalizedTag = String(tag || "").trim();
  if (!normalizedTag) {
    return true;
  }

  const now = Date.now();
  pruneRecentNotificationTags(now);

  const lastSeenAt = recentNotificationTags.get(normalizedTag);
  recentNotificationTags.set(normalizedTag, now);
  return !lastSeenAt || now - lastSeenAt > NOTIFICATION_TAG_TTL_MS;
}
