import {
  ONESIGNAL_APP_ID,
  ONESIGNAL_SAFARI_WEB_ID,
  ONESIGNAL_SERVICE_WORKER_PATH,
  ONESIGNAL_SERVICE_WORKER_SCOPE,
} from "./config.js";
import { showToast } from "./ui.js";

const ONESIGNAL_SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const DEFAULT_ONESIGNAL_SERVICE_WORKER_PATH = "push/onesignal/OneSignalSDKWorker.js";
const DEFAULT_ONESIGNAL_SERVICE_WORKER_SCOPE = "push/onesignal/";
const FALLBACK_ONESIGNAL_SERVICE_WORKER_PATH = "OneSignalSDKWorker.js";
const ROOT_ONESIGNAL_SERVICE_WORKER_SCOPE = "/";
const ONESIGNAL_SDK_LOAD_TIMEOUT_MS = 30000;
const ONESIGNAL_SDK_LOAD_MAX_ATTEMPTS = 2;
const ONESIGNAL_SDK_RETRY_DELAY_MS = 400;
const PUSH_NOTIFICATION_ICON = "https://i.ibb.co/KzFZpw0V/Gemini-Generated-Image-bl807jbl807jbl80.png";
const NOTIFICATION_TAG_TTL_MS = 30000;
let foregroundListenerBound = false;
let identityListenersBound = false;
let notificationRegistrationPromise = null;
let oneSignalReadyPromise = null;
let oneSignalInitError = null;
let activePushIdentity = null;
let identitySyncPromise = null;
const recentNotificationTags = new Map();
let oneSignalDeferredBridgeBound = false;
const oneSignalLoadWaiters = new Set();
let oneSignalScriptAttempt = 0;
let oneSignalScriptLastResult = null;

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

function normalizePushCounty(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePath(pathname, { trailingSlash = false } = {}) {
  let normalized = String(pathname || "").trim().replace(/\\/g, "/");
  normalized = normalized.replace(/^\.?\//, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");

  if (!normalized) {
    return "";
  }

  normalized = trailingSlash ? `${normalized.replace(/\/+$/, "")}/` : normalized.replace(/\/+$/, "");
  return normalized;
}

function getSiteBasePath() {
  const pathname = String(window.location.pathname || "/").trim();
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment && lastSegment.includes(".")) {
    segments.pop();
  }

  return segments.length ? `${segments.join("/")}/` : "";
}

function resolveOneSignalWorkerPath(pathname) {
  const normalizedPath = normalizePath(pathname);
  if (!normalizedPath) {
    return "";
  }

  const siteBasePath = getSiteBasePath();
  if (!siteBasePath || normalizedPath.startsWith(siteBasePath)) {
    return normalizedPath;
  }

  return `${siteBasePath}${normalizedPath}`;
}

function resolveOneSignalWorkerScope(scopePath) {
  const normalizedScope = normalizePath(scopePath, { trailingSlash: true });
  if (!normalizedScope) {
    return "/";
  }

  const siteBasePath = getSiteBasePath();
  const scopedPath = !siteBasePath || normalizedScope.startsWith(siteBasePath)
    ? normalizedScope
    : `${siteBasePath}${normalizedScope}`;

  return `/${scopedPath}`;
}

function isNotificationPermissionGranted(OneSignal) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    return true;
  }

  return OneSignal?.Notifications?.permission === true;
}

function shouldIncludeSafariWebId() {
  const userAgent = String(window.navigator?.userAgent || "");
  const isSafariEngine = /safari/i.test(userAgent) && !/chrome|chromium|crios|edg|opr|android/i.test(userAgent);
  return isSafariEngine;
}

function buildOneSignalWorkerCandidates() {
  const configuredPath = normalizePath(ONESIGNAL_SERVICE_WORKER_PATH);
  const configuredScope = normalizePath(ONESIGNAL_SERVICE_WORKER_SCOPE, { trailingSlash: true });
  const candidates = [
    {
      path: configuredPath || DEFAULT_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: configuredScope || DEFAULT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
    {
      path: configuredPath || DEFAULT_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: ROOT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
    {
      path: DEFAULT_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: DEFAULT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
    {
      path: DEFAULT_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: ROOT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
    {
      path: FALLBACK_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: ROOT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
    {
      path: FALLBACK_ONESIGNAL_SERVICE_WORKER_PATH,
      scope: configuredScope || DEFAULT_ONESIGNAL_SERVICE_WORKER_SCOPE,
    },
  ];

  const seen = new Set();
  return candidates.filter((item) => {
    if (!item.path || !item.scope) {
      return false;
    }

    const key = `${item.path}|${item.scope}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function isOneSignalWorkerScriptAccessible(pathname) {
  if (typeof fetch !== "function") {
    return true;
  }

  try {
    const workerUrl = new URL(pathname, `${window.location.origin}/`).href;
    const response = await fetch(workerUrl, {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
    if (!response.ok) {
      return false;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType) {
      return true;
    }

    if (contentType.includes("text/html")) {
      return false;
    }

    return contentType.includes("javascript") || contentType.includes("ecmascript") || contentType.includes("text/plain");
  } catch {
    return false;
  }
}

async function resolveOneSignalWorkerSettings() {
  const candidates = buildOneSignalWorkerCandidates();
  const resolvedSettings = [];

  for (const candidate of candidates) {
    const resolvedPath = resolveOneSignalWorkerPath(candidate.path);
    if (!resolvedPath) {
      continue;
    }

    if (!(await isOneSignalWorkerScriptAccessible(resolvedPath))) {
      continue;
    }

    resolvedSettings.push({
      serviceWorkerParam: {
        scope: resolveOneSignalWorkerScope(candidate.scope),
      },
      serviceWorkerPath: resolvedPath,
    });
  }

  return resolvedSettings;
}

function ensureOneSignalPageScript(options = {}) {
  const cacheBust = Boolean(options.cacheBust);
  const existing = document.querySelector(`script[src^="${ONESIGNAL_SDK_URL}"]`);
  if (existing && !cacheBust) {
    return Promise.resolve(oneSignalScriptLastResult || { ok: true, url: existing.src });
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = cacheBust ? `${ONESIGNAL_SDK_URL}?cb=${Date.now()}` : ONESIGNAL_SDK_URL;
  script.crossOrigin = "anonymous";
  oneSignalScriptAttempt += 1;
  const attempt = oneSignalScriptAttempt;

  const loadPromise = new Promise((resolve) => {
    script.addEventListener("load", () => resolve({ ok: true, url: script.src, attempt }));
    script.addEventListener("error", () => resolve({ ok: false, url: script.src, attempt }));
  }).then((result) => {
    oneSignalScriptLastResult = result;
    return result;
  });

  document.head.appendChild(script);
  return loadPromise;
}

async function probeOneSignalSdkReachable() {
  try {
    // no-cors so we can detect blocked networks/adblockers via thrown error.
    await fetch(ONESIGNAL_SDK_URL, { cache: "no-store", method: "GET", mode: "no-cors" });
    return true;
  } catch {
    return false;
  }
}

function resolveOneSignalWaiters(OneSignal) {
  oneSignalLoadWaiters.forEach((waiter) => {
    window.clearTimeout(waiter.timeoutId);
    waiter.resolve(OneSignal);
  });
  oneSignalLoadWaiters.clear();
}

function rejectOneSignalWaiters(error) {
  oneSignalLoadWaiters.forEach((waiter) => {
    window.clearTimeout(waiter.timeoutId);
    waiter.reject(error);
  });
  oneSignalLoadWaiters.clear();
}

function bindOneSignalDeferredBridge() {
  if (oneSignalDeferredBridgeBound) {
    return;
  }

  oneSignalDeferredBridgeBound = true;
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      const workerSettingsList = await resolveOneSignalWorkerSettings();
      if (!workerSettingsList.length) {
        throw new Error("OneSignal worker file is unreachable. Verify the worker URL returns JavaScript.");
      }

      const appId = String(ONESIGNAL_APP_ID || "").trim();
      const safariWebId = String(ONESIGNAL_SAFARI_WEB_ID || "").trim();
      let initSuccessful = false;
      let lastInitError = null;

      for (const workerSettings of workerSettingsList) {
        try {
          const initOptions = {
            allowLocalhostAsSecureOrigin: isLocalhostOrigin(),
            appId,
            autoResubscribe: true,
            notificationClickHandlerAction: "navigate",
            notificationClickHandlerMatch: "origin",
            notifyButton: {
              enable: true,
            },
            ...workerSettings,
            welcomeNotification: {
              disable: true,
            },
          };

          if (safariWebId && shouldIncludeSafariWebId()) {
            initOptions.safari_web_id = safariWebId;
          }

          await OneSignal.init(initOptions);
          initSuccessful = true;
          break;
        } catch (error) {
          lastInitError = error;
        }
      }

      if (!initSuccessful) {
        throw lastInitError || new Error("OneSignal initialization failed for all worker routes.");
      }

      OneSignal.Notifications.setDefaultTitle("Tamu Express");
      OneSignal.Notifications.setDefaultUrl(new URL("./index.html", window.location.href).href);
      bindOneSignalForegroundListeners(OneSignal);
      bindOneSignalIdentityListeners(OneSignal);
      oneSignalInitError = null;
      resolveOneSignalWaiters(OneSignal);
    } catch (error) {
      oneSignalInitError = error;
      rejectOneSignalWaiters(error);
    }
  });
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
    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const title = event.notification?.title || "New notification";
    const body = event.notification?.body || "You have a new update.";
    const link = event.notification?.launchURL || window.location.href;
    const payload = event.notification?.additionalData || event.notification?.data || {};
    const refId = String(payload?.refId || payload?.ref_id || "").trim();
    const type = String(payload?.type || payload?.notificationType || "notification").trim().toLowerCase();
    const tag = refId ? `notif-${type}-${refId}` : event.notification?.notificationId || `${title}:${body}`;

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
    employeeCounty: "",
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

  if (role === "employee") {
    identity.employeeCounty = normalizePushCounty(options.county);
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

  if (identity.employeeCounty) {
    tags.employee_county = identity.employeeCounty;
  }

  return tags;
}

async function syncOneSignalIdentity(OneSignal, identity, options = {}) {
  if (!OneSignal || !identity?.externalId) {
    return false;
  }

  await OneSignal.login(identity.externalId);
  await OneSignal.User.addTags(createPushTags(identity));

  if (options.ensureOptIn && isNotificationPermissionGranted(OneSignal) && !OneSignal.User.PushSubscription.optedIn) {
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

  oneSignalInitError = null;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  void ensureOneSignalPageScript();
  bindOneSignalDeferredBridge();

  oneSignalReadyPromise = new Promise((resolve, reject) => {
    const waiter = {
      attempt: 0,
      pollId: null,
      timeoutId: null,
      resolve,
      reject,
    };

    const scheduleTimeout = () => {
      waiter.timeoutId = window.setTimeout(async () => {
        if (waiter.attempt + 1 < ONESIGNAL_SDK_LOAD_MAX_ATTEMPTS) {
          waiter.attempt += 1;
          const scriptResult = await ensureOneSignalPageScript({ cacheBust: true });
          if (!scriptResult?.ok) {
            // If the script is blocked, don't wait the full timeout again.
            await new Promise((innerResolve) => window.setTimeout(innerResolve, ONESIGNAL_SDK_RETRY_DELAY_MS));
            scheduleTimeout();
            return;
          }
          await new Promise((innerResolve) => window.setTimeout(innerResolve, ONESIGNAL_SDK_RETRY_DELAY_MS));
          scheduleTimeout();
          return;
        }

        oneSignalLoadWaiters.delete(waiter);
        if (waiter.pollId) {
          window.clearInterval(waiter.pollId);
        }
        oneSignalReadyPromise = null;
        const reachable = await probeOneSignalSdkReachable();
        reject(new Error(reachable ? "OneSignal SDK load timed out." : "OneSignal SDK is blocked by network or browser extensions."));
      }, ONESIGNAL_SDK_LOAD_TIMEOUT_MS);
    };

    // If the SDK is already on the page, resolve immediately without waiting for the deferred callback.
    if (
      window.OneSignal &&
      typeof window.OneSignal === "object" &&
      typeof window.OneSignal.Notifications?.isPushSupported === "function"
    ) {
      resolve(window.OneSignal);
      return;
    }

    oneSignalLoadWaiters.add(waiter);

    waiter.pollId = window.setInterval(() => {
      if (
        window.OneSignal &&
        typeof window.OneSignal === "object" &&
        typeof window.OneSignal.Notifications?.isPushSupported === "function"
      ) {
        oneSignalLoadWaiters.delete(waiter);
        window.clearTimeout(waiter.timeoutId);
        window.clearInterval(waiter.pollId);
        resolve(window.OneSignal);
      }
    }, 250);

    scheduleTimeout();
  }).catch((error) => {
    oneSignalInitError = error;
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
      const initErrorMessage = String(oneSignalInitError?.message || "").trim();
      showToast(
        initErrorMessage
          ? `Push setup failed: ${initErrorMessage} (Check HTTPS, not private mode, allow cdn.onesignal.com, disable adblock).`
          : "Push setup failed. Check HTTPS and OneSignal app/domain settings.",
        "warn",
      );
    }
    return null;
  }

  if (!OneSignal.Notifications.isPushSupported()) {
    if (!silent) {
      showToast("This browser does not support push notifications.", "warn");
    }
    return null;
  }

  if (requestPermission && !isNotificationPermissionGranted(OneSignal)) {
    await OneSignal.Notifications.requestPermission();
  }

  return OneSignal;
}

async function enableBasicBrowserNotifications(options = {}) {
  const { requestPermission = true, silent = false } = options;

  if (!window.isSecureContext || typeof Notification === "undefined") {
    if (!silent) {
      showToast("This browser cannot enable notifications here.", "warn");
    }
    return false;
  }

  if (Notification.permission === "granted") {
    await getNotificationRegistration().catch(() => null);
    if (!silent) {
      showToast("Browser notifications enabled on this device.", "success");
    }
    return true;
  }

  if (Notification.permission === "denied") {
    if (!silent) {
      showToast("Notifications are blocked. Allow them in browser site settings, then refresh.", "warn");
    }
    return false;
  }

  if (!requestPermission) {
    return false;
  }

  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      await getNotificationRegistration().catch(() => null);
      if (!silent) {
        const suffix = oneSignalInitError ? " (Push service unavailable on this network.)" : "";
        showToast(`Browser notifications enabled on this device.${suffix}`, oneSignalInitError ? "warn" : "success");
      }
      return true;
    }
  } catch (error) {
    console.warn("Notification permission request failed", error);
  }

  if (!silent) {
    showToast("Notifications were not enabled.", "warn");
  }
  return false;
}

export async function registerPushSubscription(target, label, options = {}) {
  const identity = buildPushIdentity(target, label, options);
  if (!identity) {
    return false;
  }

  const OneSignal = await ensureOneSignalPush(options);
  if (!OneSignal) {
    // Fallback: still allow browser notifications (foreground alerts) even if OneSignal push is blocked.
    return enableBasicBrowserNotifications(options);
  }

  try {
    activePushIdentity = identity;

    if (!(await syncOneSignalIdentity(OneSignal, identity, { ensureOptIn: true }))) {
      return false;
    }

    if (isNotificationPermissionGranted(OneSignal)) {
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
