import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  ref as rtdbRef,
  remove as removeRtdb,
  set as setRtdb,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { auth, db, rtdb } from "./firebase.js";
import { buildNotificationDocId, inferToastTone, normalizeCoordinates } from "./helpers.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";
import { showToast } from "./ui.js";
import { renderEmployeePortal } from "./view-employee.js";

const EMPLOYEE_ID_CARD_MAX_BYTES = 5 * 1024 * 1024;
const EMPLOYEE_AUTH_VIEW_STORAGE_KEY = "EMPLOYEE_AUTH_VIEW";
const EMPLOYEE_AUTH_EMAIL_STORAGE_KEY = "EMPLOYEE_AUTH_EMAIL";
const EMPLOYEE_PORTAL_FALLBACK_MESSAGE = "Employee portal could not load fully. You can still login or refresh this page.";
const EMPLOYEE_PROFILE_LOAD_STALL_MS = 5000;
const EMPLOYEE_REVERSE_GEOCODE_TIMEOUT_MS = 3000;
const employeeNotificationPromptButton = document.getElementById("employeeNotificationPromptButton");
const COUNTY_NAMES = [
  "Baringo",
  "Bomet",
  "Bungoma",
  "Busia",
  "Elgeyo-Marakwet",
  "Embu",
  "Garissa",
  "Homa Bay",
  "Isiolo",
  "Kajiado",
  "Kakamega",
  "Kericho",
  "Kiambu",
  "Kilifi",
  "Kirinyaga",
  "Kisii",
  "Kisumu",
  "Kitui",
  "Kwale",
  "Laikipia",
  "Lamu",
  "Machakos",
  "Makueni",
  "Mandera",
  "Marsabit",
  "Meru",
  "Migori",
  "Mombasa",
  "Murang'a",
  "Nairobi",
  "Nakuru",
  "Nandi",
  "Narok",
  "Nyamira",
  "Nyandarua",
  "Nyeri",
  "Samburu",
  "Siaya",
  "Taita-Taveta",
  "Tana River",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Turkana",
  "Uasin Gishu",
  "Vihiga",
  "Wajir",
  "West Pokot",
];
const COUNTY_TEXT_ALIAS_MAP = {
  kajiado: [
    "kajiado",
    "kaijiado",
    "around umma university",
    "umma university",
    "my qwetu residence",
    "kajiado town",
    "kajiado cbd",
  ],
};

function safeGetStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadEmployeeAuthView() {
  const value = String(safeGetStorageItem(EMPLOYEE_AUTH_VIEW_STORAGE_KEY) || "").trim().toLowerCase();
  return value === "register" ? "register" : "login";
}

function saveEmployeeAuthView(view) {
  const normalizedView = view === "register" ? "register" : "login";
  safeSetStorageItem(EMPLOYEE_AUTH_VIEW_STORAGE_KEY, normalizedView);
}

function loadEmployeeAuthEmail() {
  return String(safeGetStorageItem(EMPLOYEE_AUTH_EMAIL_STORAGE_KEY) || "").trim();
}

function saveEmployeeAuthEmail(email) {
  const normalizedEmail = String(email || "").trim().slice(0, 160);
  safeSetStorageItem(EMPLOYEE_AUTH_EMAIL_STORAGE_KEY, normalizedEmail);
}

function getEmployeeAppElement() {
  return document.getElementById("app");
}

function renderEmployeeStartupFallback(message = EMPLOYEE_PORTAL_FALLBACK_MESSAGE) {
  const appElement = getEmployeeAppElement();
  if (!appElement) {
    return;
  }

  appElement.innerHTML = `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <p class="eyebrow">Employee workspace</p>
          <h2 class="view-title">Employee Portal</h2>
          <p class="view-copy">${String(message || EMPLOYEE_PORTAL_FALLBACK_MESSAGE)}</p>
        </div>
      </div>
      <div class="auth-flow-grid employee-portal-grid">
        <article class="card auth-card">
          <p class="eyebrow">Quick actions</p>
          <h3 class="card-title">Reload Portal</h3>
          <p class="tiny">Refresh to retry loading login and registration forms.</p>
          <div class="button-row">
            <button class="button button-primary" id="employeePortalReload" type="button">Refresh</button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderEmployeeView() {
  try {
    renderEmployeePortal(portalState);
  } catch (error) {
    console.error("Employee portal render failed", error);
    renderEmployeeStartupFallback("Employee portal failed to render. Refresh page to retry.");
  }
}

const portalState = {
  authEmailDraft: loadEmployeeAuthEmail(),
  authView: loadEmployeeAuthView(),
  countyEditorOpen: false,
  countySuggestions: [],
  currentUser: null,
  employeeProfile: null,
  employeeSection: "dashboard",
  employeeSidebarOpen: false,
  hotels: [],
  mapMode: "road",
  mapModal: null,
  notifications: [],
  orders: [],
  profileStatus: "idle",
  pendingRegistration: false,
  requestNotificationPermission: false,
  ummaShopOrders: [],
};

let unfilteredOrders = [];
let unfilteredShopOrders = [];

let unsubscribeEmployeeProfile = null;
let unsubscribeEmployeeNotifications = null;
let employeeProfileLoadTimer = null;
let activeEmployeeNotificationTarget = "";
const employeeOrderAlertTracker = {
  ids: new Set(),
  ready: false,
};
const employeeShopOrderAlertTracker = {
  ids: new Set(),
  ready: false,
};
const employeeOrderStatusTracker = new Map();
const employeeShopOrderStatusTracker = new Map();
const employeeNotificationAlertTracker = {
  ids: new Set(),
  ready: false,
};
const employeeCountyLookupCache = new Map();
const employeeCountyLookupPending = new Set();

function clearEmployeeProfileLoadTimer() {
  if (employeeProfileLoadTimer) {
    window.clearTimeout(employeeProfileLoadTimer);
    employeeProfileLoadTimer = null;
  }
}

function scheduleEmployeeProfileLoadTimeout(uid) {
  clearEmployeeProfileLoadTimer();
  if (!uid) {
    return;
  }

  employeeProfileLoadTimer = window.setTimeout(() => {
    employeeProfileLoadTimer = null;
    if (!portalState.currentUser || portalState.currentUser.uid !== uid) {
      return;
    }

    if (portalState.profileStatus !== "loading") {
      return;
    }

    portalState.profileStatus = "stalled";
    showToast("Employee profile check is taking too long. Use refresh or logout to continue.", "warn");
    renderEmployeeView();
  }, EMPLOYEE_PROFILE_LOAD_STALL_MS);
}

safeBootstrap();

function safeBootstrap() {
  try {
    bootstrap();
  } catch (error) {
    console.error("Employee portal bootstrap failed", error);
    renderEmployeeStartupFallback();
  }
}

function bootstrap() {
  bindEvents();
  bindPushSyncEvents();
  hydrateShell();
  subscribeToAuth();
  subscribeToCollections();
  renderEmployeeView();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("submit", handleSubmit);

  if (employeeNotificationPromptButton) {
    employeeNotificationPromptButton.addEventListener("click", handleEmployeeNotificationPromptClick);
  }
}

function bindPushSyncEvents() {
  window.addEventListener("focus", () => {
    syncEmployeePushSubscription();
    updateEmployeeNotificationPromptButtonState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncEmployeePushSubscription();
      updateEmployeeNotificationPromptButtonState();
    }
  });
}

function hydrateShell() {
  const year = document.getElementById("year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  window.alert = (message) => {
    showToast(String(message ?? ""), inferToastTone(String(message ?? "")));
  };

  updateEmployeeNotificationPromptButtonState();
}

function collectNewSnapshotDocs(snapshot, tracker) {
  const currentIds = new Set(snapshot.docs.map((item) => item.id));

  if (!tracker.ready) {
    tracker.ready = true;
    tracker.ids = currentIds;
    return [];
  }

  const additions = snapshot.docs
    .filter((item) => !tracker.ids.has(item.id) && !item.metadata.hasPendingWrites)
    .map((item) => ({ id: item.id, ...item.data() }));

  tracker.ids = currentIds;
  return additions;
}

function normalizeCountyKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectCountyFromText(value) {
  const normalizedValue = normalizeCountyKey(value);
  if (!normalizedValue) {
    return "";
  }

  for (const [countyKey, aliases] of Object.entries(COUNTY_TEXT_ALIAS_MAP)) {
    if (aliases.some((alias) => normalizedValue.includes(normalizeCountyKey(alias)))) {
      const matchedCounty = COUNTY_NAMES.find((item) => normalizeCountyKey(item) === countyKey);
      return matchedCounty || titleCaseWords(countyKey);
    }
  }

  for (const county of COUNTY_NAMES) {
    if (normalizedValue.includes(normalizeCountyKey(county))) {
      return county;
    }
  }

  return "";
}

function normalizeCounty(value) {
  const detectedCounty = detectCountyFromText(value);
  return normalizeCountyKey(detectedCounty || value);
}

function getKnownCountyLabel(value) {
  return detectCountyFromText(value);
}

function getEmployeeCounty(profile = portalState.employeeProfile) {
  return normalizeCounty(profile?.normalizedCounty || profile?.county);
}

function matchesEmployeeCounty(text, county) {
  const normalizedText = normalizeCountyKey(text);
  const normalizedCounty = normalizeCounty(county);

  if (!normalizedText || !normalizedCounty) {
    return false;
  }

  const detectedTextCounty = normalizeCounty(detectCountyFromText(text));
  if (detectedTextCounty) {
    return detectedTextCounty === normalizedCounty;
  }

  return normalizedText.includes(normalizedCounty);
}

function buildCountyLookupCacheKey(value) {
  const coordinates = normalizeCoordinates(value);
  if (!coordinates) {
    return "";
  }

  return `${coordinates.latitude.toFixed(5)}:${coordinates.longitude.toFixed(5)}`;
}

function getCachedCountyForCoordinates(value) {
  const cacheKey = buildCountyLookupCacheKey(value);
  if (!cacheKey || !employeeCountyLookupCache.has(cacheKey)) {
    return "";
  }

  return employeeCountyLookupCache.get(cacheKey) || "";
}

function extractCountyFromAddressPayload(payload) {
  const address = payload?.address || {};
  const countyCandidate = [
    address.county,
    address.state_district,
    address.region,
    address.state,
    payload?.display_name,
  ].find(Boolean);

  return getKnownCountyLabel(countyCandidate);
}

function queueCountyLookupForCoordinates(value) {
  const coordinates = normalizeCoordinates(value);
  const cacheKey = buildCountyLookupCacheKey(coordinates);
  if (!coordinates || !cacheKey || employeeCountyLookupCache.has(cacheKey) || employeeCountyLookupPending.has(cacheKey) || typeof fetch !== "function") {
    return;
  }

  employeeCountyLookupPending.add(cacheKey);

  let abortController = null;
  let timeoutId = 0;

  void (async () => {
    let resolvedCounty = "";

    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(coordinates.latitude));
      url.searchParams.set("lon", String(coordinates.longitude));
      url.searchParams.set("zoom", "18");
      url.searchParams.set("addressdetails", "1");

      if (typeof AbortController !== "undefined") {
        abortController = new AbortController();
        timeoutId = window.setTimeout(() => abortController?.abort(), EMPLOYEE_REVERSE_GEOCODE_TIMEOUT_MS);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
        ...(abortController ? { signal: abortController.signal } : {}),
      });

      if (response.ok) {
        const payload = await response.json();
        resolvedCounty = extractCountyFromAddressPayload(payload);
      }
    } catch {
      resolvedCounty = "";
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      employeeCountyLookupPending.delete(cacheKey);
      employeeCountyLookupCache.set(cacheKey, resolvedCounty);

      if (resolvedCounty) {
        syncEmployeeVisibleCollections();
        renderEmployeeView();
      }
    }
  })();
}

function getHotelForOrder(order) {
  if (!order?.hotelId) {
    return null;
  }

  return portalState.hotels.find((item) => item.id === order.hotelId) || null;
}

function getHotelLocationForOrder(order) {
  const hotel = getHotelForOrder(order);
  return String(hotel?.location || "").trim();
}

function getHotelCountyForOrder(order) {
  const hotel = getHotelForOrder(order);
  return getKnownCountyLabel(hotel?.county || hotel?.normalizedCounty);
}

function getOrderResolvedCounty(order) {
  const directCounty = [
    order?.customerCounty,
    order?.normalizedCustomerCounty,
    order?.deliveryCounty,
    order?.normalizedDeliveryCounty,
    order?.county,
    order?.normalizedCounty,
    order?.customerArea,
    order?.customerSpecificArea,
  ]
    .map(getKnownCountyLabel)
    .find(Boolean);

  if (directCounty) {
    return directCounty;
  }

  const customerCoordinateCounty = getCachedCountyForCoordinates(order?.customerCoordinates);
  if (customerCoordinateCounty) {
    return customerCoordinateCounty;
  }

  const hotelCounty = [
    order?.hotelCounty,
    order?.normalizedHotelCounty,
    getHotelCountyForOrder(order),
  ]
    .map(getKnownCountyLabel)
    .find(Boolean);

  if (hotelCounty) {
    return hotelCounty;
  }

  const hotel = getHotelForOrder(order);
  const hotelCoordinateCounty = getCachedCountyForCoordinates(hotel?.coordinates);
  if (hotelCoordinateCounty) {
    return hotelCoordinateCounty;
  }

  const hotelLocationCounty = getKnownCountyLabel(getHotelLocationForOrder(order));
  if (hotelLocationCounty) {
    return hotelLocationCounty;
  }

  queueCountyLookupForCoordinates(order?.customerCoordinates);
  queueCountyLookupForCoordinates(hotel?.coordinates);
  return "";
}

function isOrderVisibleToEmployee(order) {
  const county = getEmployeeCounty();
  if (!county) {
    return false;
  }

  const resolvedCounty = normalizeCounty(getOrderResolvedCounty(order));
  if (resolvedCounty) {
    return resolvedCounty === county;
  }

  const text = [
    order?.customerCounty,
    order?.customerArea,
    order?.customerSpecificArea,
    order?.hotelCounty,
    getHotelLocationForOrder(order),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");

  return matchesEmployeeCounty(text, county);
}

function isShopOrderVisibleToEmployee(order) {
  const county = getEmployeeCounty();
  if (!county) {
    return false;
  }

  const resolvedCounty = normalizeCounty(
    [order?.county, order?.normalizedCounty, order?.location, order?.shopName]
      .map(getKnownCountyLabel)
      .find(Boolean),
  );
  if (resolvedCounty) {
    return resolvedCounty === county;
  }

  const text = [order?.county, order?.location, order?.shopName]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");

  return matchesEmployeeCounty(text, county);
}

function addCountySuggestion(target, value) {
  const label = getKnownCountyLabel(value);
  if (label) {
    target.add(label);
  }
}

function syncEmployeeCountySuggestions() {
  const suggestions = new Set();

  addCountySuggestion(suggestions, portalState.employeeProfile?.county);

  portalState.hotels.forEach((hotel) => {
    addCountySuggestion(suggestions, hotel?.county);
    addCountySuggestion(suggestions, hotel?.location);
  });

  unfilteredOrders.forEach((order) => {
    addCountySuggestion(suggestions, order?.customerCounty);
    addCountySuggestion(suggestions, order?.hotelCounty);
    addCountySuggestion(suggestions, order?.customerArea);
    addCountySuggestion(suggestions, order?.customerSpecificArea);
    addCountySuggestion(suggestions, getOrderResolvedCounty(order));
    addCountySuggestion(suggestions, getHotelLocationForOrder(order));
  });

  unfilteredShopOrders.forEach((order) => {
    addCountySuggestion(suggestions, order?.county);
    addCountySuggestion(suggestions, order?.location);
    addCountySuggestion(suggestions, order?.shopName);
  });

  portalState.countySuggestions = [...suggestions].sort((left, right) => left.localeCompare(right));
}

function syncEmployeeVisibleCollections() {
  portalState.orders = unfilteredOrders.filter(isOrderVisibleToEmployee);
  portalState.ummaShopOrders = unfilteredShopOrders.filter(isShopOrderVisibleToEmployee);
  syncEmployeeCountySuggestions();
}

function handleEmployeeOrderAlerts(snapshot) {
  if (!portalState.currentUser || !portalState.employeeProfile) {
    collectNewSnapshotDocs(snapshot, employeeOrderAlertTracker);
    return;
  }

  const newOrders = collectNewSnapshotDocs(snapshot, employeeOrderAlertTracker);
  newOrders.filter(isOrderVisibleToEmployee).forEach((order) => {
    const tag = `notif-order-${order.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    const title = "New hotel order";
    const body = `${order.customerName || "A customer"} placed an order for delivery.`;
    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./employee.html",
      tag,
    });
  });
}

function handleEmployeeOrderStatusAlerts(snapshot) {
  const currentIds = new Set(snapshot.docs.map((item) => item.id));

  snapshot.docs.forEach((item) => {
    if (item.metadata.hasPendingWrites) {
      return;
    }

    const order = item.data() || {};
    const orderId = item.id;
    const previousStatus = employeeOrderStatusTracker.get(orderId);
    const currentStatus = String(order.status || "Pending");
    employeeOrderStatusTracker.set(orderId, currentStatus);

    if (!portalState.currentUser || !portalState.employeeProfile) {
      return;
    }

    if (!previousStatus || previousStatus === currentStatus || currentStatus !== "Paid") {
      return;
    }

    if (!isOrderVisibleToEmployee({ id: orderId, ...order })) {
      return;
    }

    const tag = `notif-order-paid-${orderId}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    const title = "Order marked as paid";
    const body = `${order.customerName || "A customer"}'s hotel order is now paid.`;
    showToast(`${title}: ${body}`, "success");
    void showBrowserNotification(title, body, {
      link: "./employee.html",
      tag,
    });
  });

  [...employeeOrderStatusTracker.keys()].forEach((orderId) => {
    if (!currentIds.has(orderId)) {
      employeeOrderStatusTracker.delete(orderId);
    }
  });
}

function handleEmployeeShopOrderAlerts(snapshot) {
  if (!portalState.currentUser || !portalState.employeeProfile) {
    collectNewSnapshotDocs(snapshot, employeeShopOrderAlertTracker);
    return;
  }

  const newOrders = collectNewSnapshotDocs(snapshot, employeeShopOrderAlertTracker);
  newOrders.filter(isShopOrderVisibleToEmployee).forEach((order) => {
    const tag = `notif-umma-shop-order-${order.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    const title = "New Shop Here order";
    const body = `${order.customerName || "A customer"} submitted a Shop Here order.`;
    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./employee.html",
      tag,
    });
  });
}

function handleEmployeeShopOrderStatusAlerts(snapshot) {
  const currentIds = new Set(snapshot.docs.map((item) => item.id));

  snapshot.docs.forEach((item) => {
    if (item.metadata.hasPendingWrites) {
      return;
    }

    const order = item.data() || {};
    const orderId = item.id;
    const previous = employeeShopOrderStatusTracker.get(orderId) || {
      delivered: Boolean(order.delivered),
      paid: Boolean(order.paid),
    };
    const current = {
      delivered: Boolean(order.delivered),
      paid: Boolean(order.paid),
    };
    employeeShopOrderStatusTracker.set(orderId, current);

    if (!portalState.currentUser || !portalState.employeeProfile) {
      return;
    }

    if (!isShopOrderVisibleToEmployee({ id: orderId, ...order })) {
      return;
    }

    if (!previous.paid && current.paid) {
      const tag = `notif-umma-shop-order-paid-${orderId}`;
      if (!claimNotificationTag(tag)) {
        return;
      }

      const title = "Shop Here order marked as paid";
      const body = `${order.customerName || "A customer"}'s Shop Here order is now paid.`;
      showToast(`${title}: ${body}`, "success");
      void showBrowserNotification(title, body, {
        link: "./employee.html",
        tag,
      });
    }

    if (!previous.delivered && current.delivered) {
      const tag = `notif-umma-shop-order-delivered-${orderId}`;
      if (!claimNotificationTag(tag)) {
        return;
      }

      const title = "Shop Here order marked as delivered";
      const body = `${order.customerName || "A customer"}'s Shop Here order is now delivered.`;
      showToast(`${title}: ${body}`, "success");
      void showBrowserNotification(title, body, {
        link: "./employee.html",
        tag,
      });
    }
  });

  [...employeeShopOrderStatusTracker.keys()].forEach((orderId) => {
    if (!currentIds.has(orderId)) {
      employeeShopOrderStatusTracker.delete(orderId);
    }
  });
}

function getNotificationPermissionState() {
  if (!window.isSecureContext || typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

function setNotificationButtonVariant(button, variant) {
  button.classList.remove("button-primary", "button-outline", "button-danger-soft");
  button.classList.add(variant);
}

function getEmployeePushContext() {
  const user = portalState.currentUser;
  const profile = portalState.employeeProfile;
  if (!user || !profile) {
    return null;
  }

  if (String(profile.status || "active").trim().toLowerCase() === "blocked") {
    return null;
  }

  return {
    label: profile.fullName || user.email || "Employee",
    options: {
      county: profile.normalizedCounty || profile.county,
      role: "employee",
    },
    target: user.uid,
  };
}

function syncEmployeePushSubscription(options = {}) {
  const context = getEmployeePushContext();
  if (!context) {
    return;
  }

  const requestPermission = options.requestPermission === true;
  void registerPushSubscription(context.target, context.label, {
    ...context.options,
    requestPermission,
    silent: !requestPermission,
  });
}

function updateEmployeeNotificationPromptButtonState() {
  if (!employeeNotificationPromptButton) {
    return;
  }

  const permission = getNotificationPermissionState();
  const context = getEmployeePushContext();

  if (!context || permission === "unsupported" || permission === "granted") {
    employeeNotificationPromptButton.classList.add("is-hidden");
    employeeNotificationPromptButton.disabled = false;
    return;
  }

  employeeNotificationPromptButton.classList.remove("is-hidden");
  employeeNotificationPromptButton.disabled = false;

  if (permission === "denied") {
    employeeNotificationPromptButton.textContent = "Notifications Blocked";
    employeeNotificationPromptButton.setAttribute("aria-label", "Notifications are blocked in this browser");
    setNotificationButtonVariant(employeeNotificationPromptButton, "button-danger-soft");
    return;
  }

  employeeNotificationPromptButton.textContent = "Enable Notifications";
  employeeNotificationPromptButton.setAttribute("aria-label", "Enable browser notifications for employee");
  setNotificationButtonVariant(employeeNotificationPromptButton, "button-primary");
}

function stopEmployeeNotificationSubscription() {
  if (unsubscribeEmployeeNotifications) {
    try {
      unsubscribeEmployeeNotifications();
    } catch {
      // ignore
    }
    unsubscribeEmployeeNotifications = null;
  }

  activeEmployeeNotificationTarget = "";
  employeeNotificationAlertTracker.ids = new Set();
  employeeNotificationAlertTracker.ready = false;
  portalState.notifications = [];
}

function resolveEmployeeNotificationTitle(item) {
  const normalizedType = String(item?.type || "").trim().toLowerCase();
  if (normalizedType === "order-paid" || normalizedType === "order_paid") {
    return "Order marked as paid";
  }

  if (normalizedType === "order") {
    return "New hotel order";
  }

  if (normalizedType === "umma-shop-order") {
    return "New Shop Here order";
  }

  if (normalizedType === "umma-shop-order-paid" || normalizedType === "umma_shop_order_paid") {
    return "Shop Here order marked as paid";
  }

  if (normalizedType === "umma-shop-order-delivered" || normalizedType === "umma_shop_order_delivered") {
    return "Shop Here order marked as delivered";
  }

  return "New notification";
}

function handleEmployeeNotificationAlerts(snapshot) {
  const currentIds = new Set(snapshot.docs.map((item) => item.id));
  const previousIds = employeeNotificationAlertTracker.ids;

  if (!employeeNotificationAlertTracker.ready) {
    employeeNotificationAlertTracker.ready = true;
    employeeNotificationAlertTracker.ids = currentIds;
    return;
  }

  snapshot.docChanges().forEach((change) => {
    if (change.type !== "added" || change.doc.metadata.hasPendingWrites) {
      return;
    }

    const docSnapshot = change.doc;
    if (previousIds.has(docSnapshot.id)) {
      return;
    }

    const item = docSnapshot.data() || {};
    if (item.read) {
      return;
    }

    const title = resolveEmployeeNotificationTitle(item);
    const body = String(item.message || "You have a new update.");
    const refId = String(item.refId || "").trim();
    const type = String(item.type || "notification").trim().toLowerCase();
    const tag = refId ? `notif-${type}-${refId}` : `notif-${docSnapshot.id}`;

    if (!claimNotificationTag(tag)) {
      return;
    }

    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./employee.html",
      tag,
    });
  });

  employeeNotificationAlertTracker.ids = currentIds;
}

function startEmployeeNotificationSubscription(employeeId) {
  const normalizedEmployeeId = String(employeeId || "").trim();
  if (!normalizedEmployeeId) {
    stopEmployeeNotificationSubscription();
    return;
  }

  if (unsubscribeEmployeeNotifications && activeEmployeeNotificationTarget === normalizedEmployeeId) {
    return;
  }

  stopEmployeeNotificationSubscription();
  activeEmployeeNotificationTarget = normalizedEmployeeId;
  unsubscribeEmployeeNotifications = onSnapshot(
    query(collection(db, "notifications"), where("to", "==", normalizedEmployeeId)),
    (snapshot) => {
      handleEmployeeNotificationAlerts(snapshot);
      portalState.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderEmployeeView();
    },
    (error) => {
      console.warn("Employee notifications subscription failed", error);
    },
  );
}

async function handleEmployeeNotificationPromptClick() {
  const permission = getNotificationPermissionState();
  if (permission === "unsupported") {
    showToast("This browser cannot enable web push notifications here.", "warn");
    updateEmployeeNotificationPromptButtonState();
    return;
  }

  if (permission === "denied") {
    showToast("Notifications are blocked. Allow them in browser site settings, then refresh.", "warn");
    updateEmployeeNotificationPromptButtonState();
    return;
  }

  const context = getEmployeePushContext();
  if (!context) {
    showToast("Login as employee first to enable notifications.", "warn");
    updateEmployeeNotificationPromptButtonState();
    return;
  }

  await registerPushSubscription(context.target, context.label, {
    ...context.options,
    requestPermission: true,
    silent: false,
  });
  updateEmployeeNotificationPromptButtonState();
}

function subscribeToCollections() {
  onSnapshot(collection(db, "hotels"), (snapshot) => {
    portalState.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncEmployeeVisibleCollections();
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee hotels subscription failed", error);
  });

  onSnapshot(collection(db, "orders"), (snapshot) => {
    handleEmployeeOrderAlerts(snapshot);
    handleEmployeeOrderStatusAlerts(snapshot);
    unfilteredOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncEmployeeVisibleCollections();
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee orders subscription failed", error);
  });

  onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
    handleEmployeeShopOrderAlerts(snapshot);
    handleEmployeeShopOrderStatusAlerts(snapshot);
    unfilteredShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncEmployeeVisibleCollections();
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee shop orders subscription failed", error);
  });
}

function subscribeToAuth() {
  onAuthStateChanged(auth, (user) => {
    portalState.currentUser = user;
    clearEmployeeProfileLoadTimer();

    if (unsubscribeEmployeeProfile) {
      unsubscribeEmployeeProfile();
      unsubscribeEmployeeProfile = null;
    }

    if (!user) {
      stopEmployeeNotificationSubscription();
      portalState.countyEditorOpen = false;
      portalState.employeeProfile = null;
      portalState.employeeSection = "dashboard";
      portalState.employeeSidebarOpen = false;
      portalState.mapMode = "road";
      portalState.mapModal = null;
      portalState.profileStatus = "idle";
      portalState.pendingRegistration = false;
      portalState.requestNotificationPermission = false;
      portalState.authView = loadEmployeeAuthView();
      syncEmployeeVisibleCollections();
      void unregisterPushSubscription().catch(() => false);
      updateEmployeeNotificationPromptButtonState();
      renderEmployeeView();
      return;
    }

    portalState.profileStatus = "loading";
    if (!portalState.pendingRegistration) {
      scheduleEmployeeProfileLoadTimeout(user.uid);
    }
    renderEmployeeView();

    unsubscribeEmployeeProfile = onSnapshot(doc(db, "employees", user.uid), (snapshot) => {
      clearEmployeeProfileLoadTimer();
      portalState.employeeProfile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      portalState.profileStatus = snapshot.exists() ? "ready" : portalState.pendingRegistration ? "loading" : "missing";
      if (portalState.profileStatus === "loading" && !portalState.pendingRegistration) {
        scheduleEmployeeProfileLoadTimeout(user.uid);
      }
      if (
        snapshot.exists() &&
        String(snapshot.data()?.status || "active").trim().toLowerCase() !== "blocked"
      ) {
        startEmployeeNotificationSubscription(user.uid);
        syncEmployeePushSubscription({
          requestPermission: portalState.requestNotificationPermission && getNotificationPermissionState() === "default",
        });
        portalState.requestNotificationPermission = false;
      } else {
        portalState.requestNotificationPermission = false;
        stopEmployeeNotificationSubscription();
      }
      if (!snapshot.exists()) {
        portalState.countyEditorOpen = false;
      }
      syncEmployeeVisibleCollections();
      updateEmployeeNotificationPromptButtonState();
      renderEmployeeView();
    }, (error) => {
      console.warn("Employee profile subscription failed", error);
      clearEmployeeProfileLoadTimer();
      portalState.profileStatus = "missing";
      stopEmployeeNotificationSubscription();
      syncEmployeeVisibleCollections();
      updateEmployeeNotificationPromptButtonState();
      renderEmployeeView();
    });
  }, (error) => {
    console.error("Employee auth subscription failed", error);
    clearEmployeeProfileLoadTimer();
    renderEmployeeStartupFallback("Employee auth could not initialize. Refresh and try again.");
  });
}

async function handleClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.id === "employeePortalReload") {
    window.location.reload();
    return;
  }

  if (button.id === "retryEmployeeSession") {
    window.location.reload();
    return;
  }

  if (button.classList.contains("employeeAuthSwitchBtn")) {
    portalState.authView = button.dataset.authView === "register" ? "register" : "login";
    saveEmployeeAuthView(portalState.authView);
    renderEmployeeView();
    return;
  }

  if (button.id === "toggleEmployeeCountyEditor") {
    portalState.countyEditorOpen = !portalState.countyEditorOpen;
    renderEmployeeView();
    return;
  }

  if (button.id === "cancelEmployeeCountyEditor") {
    portalState.countyEditorOpen = false;
    renderEmployeeView();
    return;
  }

  if (button.id === "employeeMenuToggle") {
    portalState.employeeSidebarOpen = !portalState.employeeSidebarOpen;
    renderEmployeeView();
    return;
  }

  if (button.id === "employeeSidebarClose" || button.id === "employeeSidebarBackdrop") {
    portalState.employeeSidebarOpen = false;
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("employeeNavBtn")) {
    portalState.employeeSection = button.dataset.section || "dashboard";
    portalState.employeeSidebarOpen = false;
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("markNotifRead")) {
    await markEmployeeNotificationRead(button.dataset.id || "");
    return;
  }

  if (button.classList.contains("viewCustomerMapBtn")) {
    openCustomerMap(button);
    return;
  }

  if (button.classList.contains("employeeMapModeBtn")) {
    portalState.mapMode = button.dataset.mode === "satellite" ? "satellite" : "road";
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("employeeDeleteShopOrderBtn")) {
    await deleteEmployeeShopOrder(button.dataset.orderId || "");
    return;
  }

  if (button.id === "closeEmployeeMap" || button.id === "employeeMapBackdrop") {
    closeCustomerMap();
    return;
  }

  if (button.id === "logoutEmployee") {
    await unregisterPushSubscription().catch(() => false);
    await signOut(auth);
    showToast("Employee logged out.", "info");
  }
}

async function markEmployeeNotificationRead(notificationIdValue) {
  const notificationId = String(notificationIdValue || "").trim();
  if (!notificationId) {
    return;
  }

  try {
    await updateDoc(doc(db, "notifications", notificationId), { read: true });
  } catch (error) {
    console.error("Employee notification read update failed", error);
    showToast("Failed to mark notification as read.", "error");
  }
}

async function deleteEmployeeShopOrder(orderIdValue) {
  const orderId = String(orderIdValue || "").trim();
  if (!orderId) {
    showToast("Order ID is missing.", "warn");
    return;
  }

  if (!window.confirm("Delete this Shop Here order?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "ummaShopOrders", orderId));
    showToast("Shop Here order deleted.", "success");
  } catch (error) {
    console.error("Employee delete Shop Here order failed", error);
    showToast("Failed to delete Shop Here order.", "error");
  }
}

function openCustomerMap(button) {
  const latitude = Number.parseFloat(button.dataset.latitude || "");
  const longitude = Number.parseFloat(button.dataset.longitude || "");

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showToast("Customer map point is not available for this order.", "warn");
    return;
  }

  portalState.mapModal = {
    customerArea: String(button.dataset.customerArea || "").trim(),
    customerName: String(button.dataset.customerName || "").trim(),
    latitude,
    longitude,
  };
  portalState.mapMode = "road";
  renderEmployeeView();
}

function closeCustomerMap() {
  if (!portalState.mapModal) {
    return;
  }

  portalState.mapModal = null;
  renderEmployeeView();
}

function handleInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (!portalState.currentUser && input.name === "employeeEmail") {
    portalState.authEmailDraft = String(input.value || "").trim();
    saveEmployeeAuthEmail(portalState.authEmailDraft);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id === "employeeLogin") {
    await loginEmployee(form);
    return;
  }

  if (form.id === "employeeSetCounty") {
    await updateEmployeeCounty(form);
    return;
  }

  if (form.id === "employeeRegister") {
    await registerEmployee(form);
  }
}

async function loginEmployee(form) {
  const email = form.elements.employeeEmail.value.trim();
  const password = form.elements.employeePass.value.trim();

  if (!email || !password) {
    alert("Enter employee email and password.");
    return;
  }

  try {
    saveEmployeeAuthEmail(email);
    portalState.authEmailDraft = email;
    portalState.authView = "login";
    saveEmployeeAuthView(portalState.authView);
    portalState.requestNotificationPermission = getNotificationPermissionState() === "default";
    await signInWithEmailAndPassword(auth, email, password);
    form.reset();
    showToast("Employee login successful.", "success");
  } catch (error) {
    console.error(error);
    portalState.requestNotificationPermission = false;
    showToast(getAuthErrorMessage(error, "login"), "error");
  }
}

async function updateEmployeeCounty(form) {
  const countyInput = String(form.elements.employeeCounty?.value || "").trim().replace(/\s+/g, " ");
  const formattedCounty = getKnownCountyLabel(countyInput);
  const normalizedCounty = normalizeCounty(formattedCounty);

  if (!normalizedCounty || !formattedCounty) {
    showToast("Enter a valid Kenyan county first.", "warn");
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    showToast("Login as employee first.", "warn");
    return;
  }

  try {
    await updateDoc(doc(db, "employees", user.uid), {
      county: formattedCounty,
      normalizedCounty,
      updatedAt: Date.now(),
    });
    portalState.countyEditorOpen = false;
    syncEmployeePushSubscription();
    syncEmployeeVisibleCollections();
    updateEmployeeNotificationPromptButtonState();
    renderEmployeeView();
    showToast(`Coverage switched to ${formattedCounty}.`, "success");
    form.reset();
  } catch (error) {
    console.error("Employee county update failed", error);
    showToast("Failed to save work county.", "error");
  }
}

async function registerEmployee(form) {
  const fullName = form.elements.employeeName.value.trim();
  const email = form.elements.employeeEmail.value.trim();
  const idNumber = form.elements.employeeIdNumber.value.trim();
  const countyInput = String(form.elements.employeeCounty?.value || "").trim().replace(/\s+/g, " ");
  const county = getKnownCountyLabel(countyInput);
  const normalizedCounty = normalizeCounty(county);
  const password = form.elements.employeePass.value.trim();
  const confirmPassword = form.elements.employeePassConfirm.value.trim();
  const idCardFile = form.elements.employeeIdCard.files?.[0];

  if (!fullName || !email || !idNumber || !county || !normalizedCounty || !password || !confirmPassword) {
    alert("Fill all employee account details and use a valid Kenyan county.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  validateIdCardFile(idCardFile);

  portalState.pendingRegistration = true;
  portalState.profileStatus = "loading";
  portalState.requestNotificationPermission = getNotificationPermissionState() === "default";
  saveEmployeeAuthEmail(email);
  portalState.authEmailDraft = email;
  renderEmployeeView();

  let credentials = null;
  let uploadResult = null;

  try {
    credentials = await createUserWithEmailAndPassword(auth, email, password);
    uploadResult = await uploadEmployeeIdCard(credentials.user.uid, idCardFile);

    await setDoc(doc(db, "employees", credentials.user.uid), {
      createdAt: Date.now(),
      email: credentials.user.email || email,
      fullName,
      county,
      idCardFileName: idCardFile.name,
      idCardDatabasePath: uploadResult.path,
      idCardUploaded: true,
      idNumber,
      normalizedCounty,
      role: "employee",
      status: "active",
      uid: credentials.user.uid,
    });

    try {
      const notification = {
        message: `New employee account created: ${fullName} (${email})`,
        read: false,
        refId: credentials.user.uid,
        timestamp: Date.now(),
        to: "admin",
        type: "employee",
      };
      const notificationId = buildNotificationDocId(notification);
      if (notificationId) {
        await setDoc(doc(db, "notifications", notificationId), notification, { merge: true });
      } else {
        await addDoc(collection(db, "notifications"), notification);
      }
    } catch (error) {
      console.warn("Employee notification write failed", error);
    }

    portalState.pendingRegistration = false;
    portalState.authView = "login";
    portalState.countyEditorOpen = false;
    saveEmployeeAuthView(portalState.authView);
    form.reset();
    updateEmployeeNotificationPromptButtonState();
    showToast("Employee account created successfully.", "success");
  } catch (error) {
    console.error(error);
    portalState.pendingRegistration = false;
    portalState.profileStatus = auth.currentUser ? "loading" : "idle";
    portalState.requestNotificationPermission = false;

    if (uploadResult?.path) {
      await removeRtdb(rtdbRef(rtdb, uploadResult.path)).catch(() => undefined);
    }

    if (credentials?.user) {
      await deleteUser(credentials.user).catch(() => undefined);
      if (auth.currentUser?.uid === credentials.user.uid) {
        await signOut(auth).catch(() => undefined);
      }
    }

    showToast(getAuthErrorMessage(error, "register"), "error");
    renderEmployeeView();
  }
}

function validateIdCardFile(file) {
  if (!file) {
    throw createEmployeeError("employee/id-card-required", "Upload one PDF that contains both front and back of the ID.");
  }

  const fileName = String(file.name || "").trim().toLowerCase();
  const fileType = String(file.type || "").trim().toLowerCase();
  const isPdf = fileType === "application/pdf" || fileName.endsWith(".pdf");
  if (!isPdf) {
    throw createEmployeeError("employee/id-card-pdf-required", "Only PDF is allowed. Upload one scanned PDF with both front and back.");
  }

  if (file.size > EMPLOYEE_ID_CARD_MAX_BYTES) {
    throw createEmployeeError("employee/id-card-too-large", "ID card file is too large. Use a file under 5 MB.");
  }
}

async function uploadEmployeeIdCard(uid, file) {
  const fileName = sanitizeStorageFileName(file.name || "id-card");
  const dataUrl = await readFileAsDataUrl(file);
  const base64Content = extractBase64Payload(dataUrl);
  const path = `employeeIdCards/${uid}`;
  await setRtdb(rtdbRef(rtdb, path), {
    base64: base64Content,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: Number(file.size || 0),
    uploadedAt: Date.now(),
  });

  return {
    path,
  };
}

function sanitizeStorageFileName(value) {
  return String(value || "file")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(createEmployeeError("employee/id-card-upload-failed", "Failed to read ID card file."));
    reader.readAsDataURL(file);
  });
}

function extractBase64Payload(dataUrl) {
  const normalized = String(dataUrl || "").trim();
  const marker = ";base64,";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) {
    throw createEmployeeError("employee/id-card-upload-failed", "Failed to process ID card PDF.");
  }

  const payload = normalized.slice(markerIndex + marker.length).trim();
  if (!payload) {
    throw createEmployeeError("employee/id-card-upload-failed", "Failed to process ID card PDF.");
  }

  return payload;
}

function createEmployeeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getAuthErrorMessage(error, mode) {
  const code = String(error?.code || "").toLowerCase();

  if (
    code === "employee/id-card-required" ||
    code === "employee/id-card-pdf-required" ||
    code === "employee/id-card-too-large" ||
    code === "employee/id-card-upload-failed"
  ) {
    return String(error.message || "ID card upload failed.");
  }

  if (code.includes("invalid-email")) {
    return "Enter a valid email address.";
  }

  if (code.includes("missing-password")) {
    return "Enter a password.";
  }

  if (code.includes("email-already-in-use")) {
    return "This email is already used by another account.";
  }

  if (code.includes("weak-password")) {
    return "Password should be at least 6 characters.";
  }

  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Wrong email or password.";
  }

  if (code.includes("too-many-requests")) {
    return "Too many attempts. Try again later.";
  }

  if (code.includes("database/permission-denied") || code.includes("permission_denied")) {
    return "ID card upload was blocked by Realtime Database rules.";
  }

  if (code.includes("database/network-error")) {
    return "Network error while uploading ID card. Try again.";
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("permission_denied")) {
    return "ID card upload was blocked by Realtime Database rules.";
  }

  if (message.includes("network error")) {
    return "ID card upload failed due to network error. Try again.";
  }

  if (mode === "register") {
    return "Failed to create the employee account.";
  }

  return "Failed to log in to the employee portal.";
}
