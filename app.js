import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  ANNOUNCEMENT_TEXT,
  DEFAULT_HOTEL_LOCATION,
  getServiceFeeForHotel,
  resolveDistanceServiceFee,
  SERVICE_FEE,
  SERVICE_FEE_TILL,
  SMS_SIMULATION_ENABLED,
} from "./config.js";
import { auth, db } from "./firebase.js";
import {
  calculateDistanceKm,
  buildNotificationDocId,
  escapeHtml,
  formatCoordinatePair,
  formatDistanceKm,
  formatCurrency,
  inferToastTone,
  normalizeCoordinates,
  normalizeMenuDay,
  normalizeMenuMealPeriod,
  toFiniteNumber,
} from "./helpers.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";
import { dispatchOrderNotification } from "./notification-api.js";
import { notifyPaidOrderStatus } from "./order-status-notifications.js";
import {
  ensureCustomerSession,
  loginHotelWithServer,
  registerHotelWithServer,
  resolveAuthSession,
} from "./security.js";
import {
  CUSTOMER_ID,
  elements,
  getCart,
  getCartItemCount,
  getCartItemsTotal,
  getCheckoutDraft,
  getHotelById,
  getHotelLocation,
  getLocationCards,
  getRestaurantByHotelId,
  getVisibleRestaurants,
  isHotelOpenForCustomers,
  normalizeHotelLocation,
  state,
} from "./state.js";
import { saveCustomerProfile, saveOrderProfile } from "./storage.js";
import { showToast } from "./ui.js";
import { renderHotelPortal } from "./view-hotel.js";
import { renderOrders } from "./view-orders.js";
import { renderRestaurants } from "./view-restaurants.js";

let deferredInstallPrompt = null;
let installPromptWaiters = [];
const liveNotificationAlertTracker = {
  idsByTarget: new Map(),
  readyTargets: new Set(),
};
const FAST_LOCATION_TIMEOUT_MS = 3500;
const PRECISE_LOCATION_TIMEOUT_MS = 12000;
const CHECKOUT_PRECISION_REFRESH_TIMEOUT_MS = 3000;
const LOCATION_CACHE_MAX_AGE_MS = 60 * 1000;
const REVERSE_GEOCODE_TIMEOUT_MS = 3000;
const TARGET_LOCATION_ACCURACY_M = 50;
const ACCEPTABLE_LOCATION_ACCURACY_M = 120;
const UMMA_UNIVERSITY_REFERENCE_COORDINATES = Object.freeze({
  latitude: -1.77726,
  longitude: 36.82064,
});
const reverseGeocodeCache = new Map();
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

void bootstrap();

async function bootstrap() {
  try {
    const session = await resolveAuthSession().catch(() => null);
    if (session?.role === "hotel" && session.hotelId) {
      state.currentHotelId = session.hotelId;
      state.currentTab = "hotel";
    } else if (!auth.currentUser || auth.currentUser.isAnonymous) {
      await ensureCustomerSession();
    } else {
      await signOut(auth).catch(() => undefined);
      await ensureCustomerSession();
    }
  } catch (error) {
    console.warn("Guest session bootstrap failed", error);
  }

  bindStaticEvents();
  bindInstallFlow();
  bindNotificationPermissionFlow();
  bindPushSyncEvents();
  hydrateStaticShell();
  registerAppServiceWorker();
  syncActivePushSubscription();
  subscribeToCollections();
  updateInfoSections();
  syncUi();
}

function bindStaticEvents() {
  elements.brandHome.addEventListener("click", (event) => {
    event.preventDefault();
    state.currentInfoSection = null;
    state.activeHotelMenuId = null;
    state.locationDirectoryOpen = false;
    state.selectedLocation = null;
    state.restaurantDirectoryOpen = false;
    updateInfoSections();
    switchTab("restaurants");
  });

  let footerClicks = 0;
  elements.footer.addEventListener("click", () => {
    footerClicks += 1;
    if (footerClicks < 4) {
      return;
    }

    footerClicks = 0;
    window.location.href = "./admin.html";
  });

  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCartModal();
    }
  });
}

function bindInstallFlow() {
  if (elements.installAppButton) {
    elements.installAppButton.addEventListener("click", handleInstallClick);
  }

  updateInstallButtonState();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    resolveInstallPromptWaiters();
    updateInstallButtonState();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButtonState();
    showToast("Tamu Express is ready to open from your device.", "success");
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener("change", updateInstallButtonState);
}

function bindNotificationPermissionFlow() {
  if (elements.notificationPromptButton) {
    elements.notificationPromptButton.addEventListener("click", handleNotificationPromptClick);
  }

  updateNotificationPromptButtonState();
}

function bindPushSyncEvents() {
  window.addEventListener("focus", () => {
    syncActivePushSubscription();
    updateNotificationPromptButtonState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncActivePushSubscription();
      updateNotificationPromptButtonState();
    }
  });
}

function getActivePushSubscriptionContext() {
  if (state.currentHotelId) {
    const hotel = getHotelById(state.currentHotelId);
    if (!hotel.id) {
      return null;
    }

    return {
      label: hotel.name,
      options: {
        hotelId: hotel.id,
        role: "hotel",
      },
      target: hotel.id,
    };
  }

  return {
    label: state.currentCustomer?.name || "Customer",
    options: {
      customerId: CUSTOMER_ID,
      role: "customer",
    },
    target: CUSTOMER_ID,
  };
}

function syncActivePushSubscription() {
  const subscriptionContext = getActivePushSubscriptionContext();
  if (!subscriptionContext) {
    return;
  }

  void registerPushSubscription(subscriptionContext.target, subscriptionContext.label, {
    ...subscriptionContext.options,
    requestPermission: false,
    silent: true,
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

function updateNotificationPromptButtonState() {
  if (!elements.notificationPromptButton) {
    return;
  }

  const permission = getNotificationPermissionState();
  const button = elements.notificationPromptButton;

  if (permission === "unsupported" || permission === "granted") {
    button.classList.add("is-hidden");
    button.disabled = false;
    return;
  }

  button.classList.remove("is-hidden");
  button.disabled = false;

  if (permission === "denied") {
    button.textContent = "Notifications Blocked";
    button.setAttribute("aria-label", "Notifications are blocked in this browser");
    setNotificationButtonVariant(button, "button-danger-soft");
    return;
  }

  button.textContent = "Enable Notifications";
  button.setAttribute("aria-label", "Enable browser notifications");
  setNotificationButtonVariant(button, "button-primary");
}

function readCoordinatesFromForm(form) {
  return normalizeCoordinates({
    accuracy: toFiniteNumber(form?.elements.hotelAccuracy?.value),
    latitude: toFiniteNumber(form?.elements.hotelLatitude?.value),
    longitude: toFiniteNumber(form?.elements.hotelLongitude?.value),
  });
}

function writeCoordinatesToForm(form, coordinates) {
  if (!form) {
    return;
  }

  form.elements.hotelLatitude.value = coordinates?.latitude ?? "";
  form.elements.hotelLongitude.value = coordinates?.longitude ?? "";
  form.elements.hotelAccuracy.value = coordinates?.accuracy ?? "";
}

function getCoordinateAccuracy(coordinates) {
  const accuracy = Number(coordinates?.accuracy);
  return Number.isFinite(accuracy) && accuracy > 0 ? accuracy : Number.POSITIVE_INFINITY;
}

function formatLocationAccuracy(coordinates) {
  const accuracy = getCoordinateAccuracy(coordinates);
  if (!Number.isFinite(accuracy)) {
    return "";
  }

  if (accuracy < 1000) {
    return `accuracy about ${Math.round(accuracy)} m`;
  }

  return `accuracy about ${(accuracy / 1000).toFixed(1)} km`;
}

function hasLocationAccuracyWithin(coordinates, threshold = ACCEPTABLE_LOCATION_ACCURACY_M) {
  return getCoordinateAccuracy(coordinates) <= threshold;
}

function selectBestCoordinates(...candidates) {
  return candidates
    .filter(Boolean)
    .sort((left, right) => getCoordinateAccuracy(left) - getCoordinateAccuracy(right))[0] || null;
}

function shouldReplaceCoordinates(nextCoordinates, currentCoordinates) {
  if (!nextCoordinates) {
    return false;
  }

  if (!currentCoordinates) {
    return true;
  }

  return getCoordinateAccuracy(nextCoordinates) + 5 < getCoordinateAccuracy(currentCoordinates);
}

function setButtonBusy(button, busy, busyText = "Working...") {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || "";
  }

  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.defaultLabel;
}

function setHotelCoordinateStatusMessage(form, message) {
  const status = form?.querySelector("[data-hotel-geo-status]");
  if (status) {
    status.textContent = String(message || "");
  }
}

function setCheckoutLocationStatusMessage(hotelId, message) {
  const status = document.querySelector(`[data-customer-geo-status][data-hotel="${hotelId}"]`);
  if (status) {
    status.textContent = String(message || "");
  }
}

function formatCoordinateSnapshot(coordinates) {
  const normalized = normalizeCoordinates(coordinates);
  if (!normalized) {
    return "Precise delivery location not saved yet.";
  }

  const accuracyText = formatLocationAccuracy(normalized);
  return `Saved map point ${normalized.latitude.toFixed(5)}, ${normalized.longitude.toFixed(5)}${accuracyText ? ` (${accuracyText})` : ""}.`;
}

function updateHotelRegistrationCoordinateStatus(form, coordinates = readCoordinatesFromForm(form)) {
  const status = form?.querySelector("[data-hotel-geo-status]");
  if (!status) {
    return;
  }

  status.textContent = normalizeCoordinates(coordinates)
    ? `${formatCoordinateSnapshot(coordinates)} Distance-based delivery fees are enabled for this hotel.`
    : `New hotel accounts stay under ${DEFAULT_HOTEL_LOCATION}. Use current location to save the hotel map point for delivery fees.`;
}

function getHotelCoordinates(hotel) {
  return normalizeCoordinates(hotel?.coordinates);
}

function readCheckoutCustomerCoordinates(hotelId) {
  const draft = state.checkoutDrafts[hotelId] || {};
  return normalizeCoordinates({
    accuracy: toFiniteNumber(draft.customerAccuracy),
    latitude: toFiniteNumber(draft.customerLatitude),
    longitude: toFiniteNumber(draft.customerLongitude),
  });
}

function getCheckoutCustomerArea(hotelId) {
  const draft = state.checkoutDrafts[hotelId] || {};
  return String(draft.customerArea || "").trim();
}

function getCheckoutCustomerSpecificArea(hotelId) {
  const draft = state.checkoutDrafts[hotelId] || {};
  return String(draft.customerSpecificArea || "").trim();
}

function getCheckoutLocationStatusCopy(hotelId) {
  const coordinates = readCheckoutCustomerCoordinates(hotelId);
  const area = getCheckoutCustomerArea(hotelId);
  const specificArea = getCheckoutCustomerSpecificArea(hotelId);
  const areaSummary = [area, specificArea].filter(Boolean).join(" - ");
  const accuracyText = formatLocationAccuracy(coordinates);
  const coordinateSummary = coordinates
    ? `${formatCoordinatePair(coordinates)}${accuracyText ? `, ${accuracyText}` : ""}`
    : "";

  if (coordinates && areaSummary) {
    return `Shared delivery point: ${areaSummary} (${coordinateSummary}). The delivery person and hotel will receive it with your order.`;
  }

  if (coordinates) {
    return `Shared delivery point: ${coordinateSummary}. The delivery person and hotel will receive it with your order.`;
  }

  if (areaSummary) {
    return `Area noted: ${areaSummary}. Click Use My Current Location to attach exact coordinates for delivery.`;
  }

  return "Type your area and use current location so the delivery person and hotel can receive your delivery point.";
}

function updateCheckoutLocationStatus(hotelId) {
  const status = document.querySelector(`[data-customer-geo-status][data-hotel="${hotelId}"]`);
  if (!status) {
    return;
  }

  status.textContent = getCheckoutLocationStatusCopy(hotelId);
}

function setCheckoutCustomerLocationDraft(hotelId, coordinates, area = "") {
  const draft = state.checkoutDrafts[hotelId] = state.checkoutDrafts[hotelId] || {};
  const normalizedArea = String(area || "").trim();

  draft.customerAccuracy = coordinates?.accuracy ?? "";
  draft.customerLatitude = coordinates?.latitude ?? "";
  draft.customerLongitude = coordinates?.longitude ?? "";
  draft.customerLocationLabel = normalizedArea;
  if (normalizedArea) {
    draft.customerArea = normalizedArea;
  } else {
    draft.customerArea = draft.customerArea || "";
  }

  const areaInput = document.querySelector(`.checkout-input[data-field="customerArea"][data-hotel="${hotelId}"]`);
  if (areaInput && normalizedArea) {
    areaInput.value = normalizedArea;
  }

  updateCheckoutLocationStatus(hotelId);
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

function detectCountyFromText(value) {
  const normalizedValue = normalizeCountyKey(value);
  if (!normalizedValue) {
    return "";
  }

  for (const [countyKey, aliases] of Object.entries(COUNTY_TEXT_ALIAS_MAP)) {
    if (aliases.some((alias) => normalizedValue.includes(normalizeCountyKey(alias)))) {
      return COUNTY_NAMES.find((item) => normalizeCountyKey(item) === countyKey) || "";
    }
  }

  for (const county of COUNTY_NAMES) {
    if (normalizedValue.includes(normalizeCountyKey(county))) {
      return county;
    }
  }

  return "";
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

  return detectCountyFromText(countyCandidate);
}

function buildCustomerAreaLabel(payload) {
  const address = payload?.address || {};
  const primary = [
    address.amenity,
    address.building,
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.residential,
    address.village,
    address.hamlet,
    address.town,
    address.city_district,
    address.city,
  ].find(Boolean);
  const secondary = [address.road, address.county, address.state].find(Boolean);
  const label = [primary, secondary].filter(Boolean).join(", ").trim();

  return label || String(payload?.display_name || "").split(",").slice(0, 2).join(", ").trim();
}

async function resolveReverseGeocodeSummary(coordinates) {
  if (!coordinates || typeof fetch !== "function") {
    return { county: "", label: "" };
  }

  const cacheKey = buildCoordinateCacheKey(coordinates);
  if (cacheKey && reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey) || { county: "", label: "" };
  }

  let abortController = null;
  let timeoutId = 0;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(coordinates.latitude));
    url.searchParams.set("lon", String(coordinates.longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    if (typeof AbortController !== "undefined") {
      abortController = new AbortController();
      timeoutId = window.setTimeout(() => abortController?.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      ...(abortController ? { signal: abortController.signal } : {}),
    });
    if (!response.ok) {
      return { county: "", label: "" };
    }

    const payload = await response.json();
    const summary = {
      county: extractCountyFromAddressPayload(payload),
      label: buildCustomerAreaLabel(payload),
    };
    if (cacheKey) {
      reverseGeocodeCache.set(cacheKey, summary);
    }
    return summary;
  } catch {
    return { county: "", label: "" };
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function isUmmaLocationText(value) {
  return /umma\s+universit/i.test(String(value || ""));
}

function getReferenceCoordinatesForLocationText(value) {
  if (!isUmmaLocationText(value)) {
    return null;
  }

  return normalizeCoordinates(UMMA_UNIVERSITY_REFERENCE_COORDINATES);
}

function buildCoordinateCacheKey(coordinates) {
  const normalized = normalizeCoordinates(coordinates);
  if (!normalized) {
    return "";
  }

  return `${normalized.latitude.toFixed(5)}:${normalized.longitude.toFixed(5)}`;
}

async function resolveCustomerAreaLabel(coordinates) {
  const summary = await resolveReverseGeocodeSummary(coordinates);
  return summary.label;
}

async function resolveCountyFromCoordinates(coordinates) {
  const summary = await resolveReverseGeocodeSummary(coordinates);
  return summary.county;
}

async function resolveHotelCounty(hotel) {
  const explicitCounty = detectCountyFromText(hotel?.county || hotel?.normalizedCounty);
  if (explicitCounty) {
    return explicitCounty;
  }

  const coordinateCounty = await resolveCountyFromCoordinates(getHotelCoordinates(hotel));
  if (coordinateCounty) {
    return coordinateCounty;
  }

  return detectCountyFromText(getHotelLocation(hotel));
}

async function resolveOrderCustomerCounty(customerArea, customerSpecificArea, customerCoordinates) {
  const knownCounty = detectCountyFromText([customerSpecificArea, customerArea].filter(Boolean).join(" "));
  if (knownCounty) {
    return knownCounty;
  }

  return resolveCountyFromCoordinates(customerCoordinates);
}

function buildCustomerAreaSearchQueries(customerArea, customerSpecificArea, hotelLocation) {
  const area = String(customerArea || "").trim();
  const specificArea = String(customerSpecificArea || "").trim();
  const hotelArea = String(hotelLocation || DEFAULT_HOTEL_LOCATION).trim();

  const queries = [
    [specificArea, area, hotelArea, "Kenya"].filter(Boolean).join(", "),
    [area, hotelArea, "Kenya"].filter(Boolean).join(", "),
    [specificArea, hotelArea, "Kenya"].filter(Boolean).join(", "),
    [area, "Kenya"].filter(Boolean).join(", "),
    [specificArea, "Kenya"].filter(Boolean).join(", "),
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(queries)];
}

function buildHotelLocationSearchQueries(hotel) {
  const hotelArea = getHotelLocation(hotel);
  const hotelName = String(hotel?.name || "").trim();

  const queries = [
    [hotelArea, "Kenya"].filter(Boolean).join(", "),
    [hotelName, hotelArea, "Kenya"].filter(Boolean).join(", "),
    [hotelName, "Kenya"].filter(Boolean).join(", "),
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(queries)];
}

async function resolveCoordinatesFromTextQueries(queries) {
  if (typeof fetch !== "function") {
    return null;
  }

  const uniqueQueries = [...new Set((Array.isArray(queries) ? queries : []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!uniqueQueries.length) {
    return null;
  }

  for (const query of uniqueQueries) {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("q", query);
      url.searchParams.set("countrycodes", "ke");

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        continue;
      }

      const results = await response.json();
      const bestMatch = Array.isArray(results) ? results[0] : null;
      const coordinates = normalizeCoordinates({
        latitude: toFiniteNumber(bestMatch?.lat),
        longitude: toFiniteNumber(bestMatch?.lon),
      });
      if (coordinates) {
        return coordinates;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveCoordinatesFromAreaText(customerArea, customerSpecificArea, hotelLocation) {
  const queries = buildCustomerAreaSearchQueries(customerArea, customerSpecificArea, hotelLocation);
  const geocoded = await resolveCoordinatesFromTextQueries(queries);
  if (geocoded) {
    return geocoded;
  }

  const fallbackReference = getReferenceCoordinatesForLocationText(`${customerSpecificArea} ${customerArea} ${hotelLocation}`);
  return fallbackReference;
}

async function resolveHotelCoordinatesFallback(hotel) {
  const queries = buildHotelLocationSearchQueries(hotel);
  const geocoded = await resolveCoordinatesFromTextQueries(queries);
  if (geocoded) {
    return geocoded;
  }

  return getReferenceCoordinatesForLocationText(getHotelLocation(hotel));
}

function requestCurrentCoordinates() {
  if (!window.isSecureContext || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(
          normalizeCoordinates({
            accuracy: position.coords.accuracy,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        );
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        maximumAge: 5 * 60 * 1000,
        timeout: 12000,
      },
    );
  });
}

async function captureHotelRegistrationCoordinates(form) {
  const coordinates = await requestCurrentCoordinates();
  if (!coordinates) {
    showToast("Location access was unavailable. You can still register and update the hotel location later.", "warn");
    return null;
  }

  writeCoordinatesToForm(form, coordinates);
  updateHotelRegistrationCoordinateStatus(form, coordinates);
  showToast("Hotel map point saved for distance-based delivery fees.", "success");
  return coordinates;
}

async function updateCurrentHotelCoordinates() {
  const hotel = getHotelById(state.currentHotelId);
  if (!hotel.id) {
    return;
  }

  const coordinates = await requestCurrentCoordinates();
  if (!coordinates) {
    showToast("Could not capture the current hotel location on this device.", "warn");
    return;
  }

  try {
    const county = await resolveCountyFromCoordinates(coordinates);
    await updateDoc(doc(db, "hotels", hotel.id), {
      ...(county ? {
        county,
        normalizedCounty: normalizeCountyKey(county),
      } : {}),
      coordinates: {
        ...(Number.isFinite(coordinates.accuracy) ? { accuracy: coordinates.accuracy } : {}),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
    });
    showToast(
      county ? `Hotel delivery map point updated for ${county}.` : "Hotel delivery map point updated.",
      "success",
    );
  } catch (error) {
    console.error(error);
    showToast("Failed to update hotel location.", "error");
  }
}

async function captureCustomerCheckoutLocation(hotelId) {
  const coordinates = await requestCurrentCoordinates();
  if (!coordinates) {
    showToast("Could not read your browser location on this device.", "warn");
    return;
  }

  const detectedArea = await resolveCustomerAreaLabel(coordinates);
  setCheckoutCustomerLocationDraft(hotelId, coordinates, detectedArea);

  if (detectedArea) {
    showToast("Delivery coordinates and area detected. You can still edit the area text.", "success");
    return;
  }

  showToast("Delivery coordinates shared. Type your area manually if needed.", "info");
}

async function resolveOrderFeeDetails(hotel, customerCoordinates = null, customerArea = "", customerSpecificArea = "") {
  let hotelCoordinates = getHotelCoordinates(hotel);
  const baseFee = getServiceFeeForHotel(hotel);

  if (!hotelCoordinates) {
    hotelCoordinates = await resolveHotelCoordinatesFallback(hotel);
  }

  if (!hotelCoordinates) {
    return {
      customerCoordinates: null,
      distanceKm: null,
      hotelCoordinates: null,
      serviceFee: baseFee,
      serviceFeeBand: "hotel-location-missing",
      serviceFeeLabel: "Base service fee",
      serviceFeeSource: "fallback",
    };
  }

  let normalizedCustomerCoordinates = normalizeCoordinates(customerCoordinates);
  if (!normalizedCustomerCoordinates) {
    normalizedCustomerCoordinates = await resolveCoordinatesFromAreaText(
      customerArea,
      customerSpecificArea,
      getHotelLocation(hotel),
    );
  }

  if (!normalizedCustomerCoordinates) {
    return {
      customerCoordinates: null,
      distanceKm: null,
      hotelCoordinates,
      serviceFee: baseFee,
      serviceFeeBand: "customer-location-missing",
      serviceFeeLabel: "Base service fee",
      serviceFeeSource: "fallback",
    };
  }

  const distanceKm = calculateDistanceKm(normalizedCustomerCoordinates, hotelCoordinates);
  const fee = resolveDistanceServiceFee(distanceKm, hotel);

  return {
    customerCoordinates: normalizedCustomerCoordinates,
    distanceKm,
    hotelCoordinates,
    serviceFee: fee.fee,
    serviceFeeBand: fee.bandId,
    serviceFeeLabel: fee.label,
    serviceFeeSource: "distance",
  };
}

function waitForInstallPrompt(timeout = 1800) {
  if (deferredInstallPrompt) {
    return Promise.resolve(deferredInstallPrompt);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      installPromptWaiters = installPromptWaiters.filter((waiter) => waiter !== resolve);
      resolve(null);
    }, timeout);

    installPromptWaiters.push((prompt) => {
      window.clearTimeout(timer);
      resolve(prompt);
    });
  });
}

function resolveInstallPromptWaiters(prompt = deferredInstallPrompt) {
  if (!installPromptWaiters.length) {
    return;
  }

  const waiters = installPromptWaiters;
  installPromptWaiters = [];
  waiters.forEach((resolve) => resolve(prompt));
}

function hydrateStaticShell() {
  if (elements.noticeText) {
    elements.noticeText.textContent = ANNOUNCEMENT_TEXT;
  }
  if (elements.noticeTextClone) {
    elements.noticeTextClone.textContent = ANNOUNCEMENT_TEXT;
  }
  if (elements.serviceFeeAmount) {
    elements.serviceFeeAmount.textContent = String(SERVICE_FEE);
  }
  if (elements.serviceFeeTill) {
    elements.serviceFeeTill.textContent = SERVICE_FEE_TILL;
  }
  if (elements.year) {
    elements.year.textContent = String(new Date().getFullYear());
  }
  window.alert = (message) => {
    showToast(String(message ?? ""), inferToastTone(String(message ?? "")));
  };
}

async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("App service worker registration failed", error);
  }
}

function subscribeToCollections() {
  onSnapshot(collection(db, "hotels"), (snapshot) => {
    state.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

    if (state.currentHotelId && !state.hotels.some((hotel) => hotel.id === state.currentHotelId)) {
      state.currentHotelId = null;
    }

    if (state.activeHotelMenuId && !isHotelOpenForCustomers(state.activeHotelMenuId)) {
      state.activeHotelMenuId = null;
    }

    if (state.selectedLocation) {
      const availableLocations = getLocationCards().map((item) => item.name);
      if (!availableLocations.includes(state.selectedLocation)) {
        state.selectedLocation = null;
      }
    }

    syncUi();
  });

  onSnapshot(collection(db, "restaurants"), (snapshot) => {
    state.restaurants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncUi();
  });

  onSnapshot(collection(db, "orders"), (snapshot) => {
    state.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncUi();
  });

  onSnapshot(collection(db, "notifications"), (snapshot) => {
    handleLiveNotificationAlerts(snapshot);
    state.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    syncUi();
  });
}

function syncUi() {
  updateHeaderMetrics();
  updateBadges();
  updateTabState();
  renderCurrentView();
}

function switchTab(tab) {
  state.currentTab = tab;
  updateTabState();
  renderCurrentView();
}

function normalizeHotelAccountName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function openLocationDirectory(location) {
  state.currentInfoSection = null;
  state.selectedLocation = location ? normalizeHotelLocation(location) : null;
  state.activeHotelMenuId = null;
  state.locationDirectoryOpen = !location;
  state.restaurantDirectoryOpen = true;
  updateInfoSections();
  switchTab("restaurants");
}

function renderCurrentView() {
  if (state.currentTab === "orders") {
    renderOrders();
    return;
  }

  if (state.currentTab === "hotel") {
    renderHotelPortal();
    return;
  }

  renderRestaurants();
}

function updateHeaderMetrics() {
  const visibleRestaurants = getVisibleRestaurants(null);
  const pendingOrders = state.orders.filter((order) => (order.status || "Pending") !== "Paid").length;

  if (elements.heroRestaurantCount) {
    elements.heroRestaurantCount.textContent = String(visibleRestaurants.length);
  }
  if (elements.heroHotelCount) {
    elements.heroHotelCount.textContent = String(state.hotels.length);
  }
  if (elements.heroOrderCount) {
    elements.heroOrderCount.textContent = String(pendingOrders);
  }
}

function updateBadges() {
  setBadge(elements.restBadge, getVisibleRestaurants(null).length, "light");

  const hotelUnread = state.currentHotelId
    ? state.notifications.filter((item) => item.to === state.currentHotelId && !item.read).length
    : 0;
  setBadge(elements.hotelNotifBadge, hotelUnread, "alert");
}

function updateTabState() {
  document.querySelectorAll(".nav-tabs .tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.currentTab);
  });
}

function setBadge(element, count, tone) {
  if (!element) {
    return;
  }

  element.innerHTML = count
    ? `<span class="count-badge count-badge--${tone}">${escapeHtml(String(count))}</span>`
    : "";
}

function setInfoSection(sectionId) {
  state.currentInfoSection = sectionId || null;
  updateInfoSections();

  const section = state.currentInfoSection ? document.getElementById(state.currentInfoSection) : null;
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function handleInstallClick() {
  if (isStandaloneDisplayMode()) {
    showToast("Tamu Express is already installed on this device.", "success");
    return;
  }

  if (!deferredInstallPrompt) {
    await waitForInstallPrompt();
  }

  if (!deferredInstallPrompt) {
    if (isIosInstallCandidate()) {
      showToast("On iPhone or iPad, tap Share then choose Add to Home Screen.", "info");
      return;
    }

    showToast("Use Chrome, Edge, or Samsung Internet, then tap your browser menu and choose Install app.", "info");
    return;
  }

  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferredInstallPrompt = null;

  if (result.outcome === "accepted") {
    elements.installAppButton?.classList.add("is-hidden");
    showToast("Install started. You can pin Tamu Express on this device.", "success");
    return;
  }

  updateInstallButtonState();
}

function getActiveNotificationTarget() {
  if (state.currentHotelId) {
    return state.currentHotelId;
  }

  return CUSTOMER_ID;
}

function resetLiveNotificationAlertTracker(target = null) {
  if (target) {
    liveNotificationAlertTracker.idsByTarget.delete(target);
    liveNotificationAlertTracker.readyTargets.delete(target);
    return;
  }

  liveNotificationAlertTracker.idsByTarget.clear();
  liveNotificationAlertTracker.readyTargets.clear();
}

function resolveNotificationTitle(item) {
  const normalizedType = String(item?.type || "").trim().toLowerCase();
  if (normalizedType === "order-paid" || normalizedType === "order_paid") {
    return "Order update";
  }

  if (normalizedType === "order") {
    return "New order received";
  }

  if (normalizedType === "umma-shop-order") {
    return "New Shop Here order";
  }

  if (normalizedType === "umma-shop-order-paid" || normalizedType === "umma_shop_order_paid") {
    return "Shop Here payment update";
  }

  if (normalizedType === "umma-shop-order-delivered" || normalizedType === "umma_shop_order_delivered") {
    return "Shop Here delivery update";
  }

  return "New notification";
}

function handleLiveNotificationAlerts(snapshot) {
  const target = getActiveNotificationTarget();
  if (!target) {
    return;
  }

  const targetDocs = snapshot.docs.filter((docSnapshot) => String(docSnapshot.data()?.to || "").trim() === target);
  const currentIds = new Set(targetDocs.map((docSnapshot) => docSnapshot.id));
  const previousIds = liveNotificationAlertTracker.idsByTarget.get(target) || new Set();

  if (!liveNotificationAlertTracker.readyTargets.has(target)) {
    liveNotificationAlertTracker.readyTargets.add(target);
    liveNotificationAlertTracker.idsByTarget.set(target, currentIds);
    return;
  }

  snapshot.docChanges().forEach((change) => {
    if (change.type !== "added" || change.doc.metadata.hasPendingWrites) {
      return;
    }

    const docSnapshot = change.doc;
    const item = docSnapshot.data() || {};
    const itemTarget = String(item.to || "").trim();
    if (itemTarget !== target || item.read || previousIds.has(docSnapshot.id)) {
      return;
    }

    const title = resolveNotificationTitle(item);
    const body = String(item.message || "You have a new update.");
    const refId = String(item.refId || "").trim();
    const type = String(item.type || "notification").trim().toLowerCase();
    const tag = refId ? `notif-${type}-${refId}` : `notif-${docSnapshot.id}`;

    if (!claimNotificationTag(tag)) {
      return;
    }

    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./index.html",
      tag,
    });
  });

  liveNotificationAlertTracker.idsByTarget.set(target, currentIds);
}

async function handleNotificationPromptClick() {
  const permission = getNotificationPermissionState();
  if (permission === "unsupported") {
    showToast("This browser cannot enable web push notifications here.", "warn");
    updateNotificationPromptButtonState();
    return;
  }

  if (permission === "denied") {
    showToast("Notifications are blocked. Allow them in your browser site settings, then refresh.", "warn");
    updateNotificationPromptButtonState();
    return;
  }

  const subscriptionContext = getActivePushSubscriptionContext();
  if (!subscriptionContext) {
    showToast("Notification setup is not ready yet.", "warn");
    return;
  }

  await registerPushSubscription(subscriptionContext.target, subscriptionContext.label, {
    ...subscriptionContext.options,
    requestPermission: true,
    silent: false,
  });
  updateNotificationPromptButtonState();
}

function updateInstallButtonState() {
  if (!elements.installAppButton) {
    return;
  }

  const installed = isStandaloneDisplayMode();
  const shouldShow = !installed;

  elements.installAppButton.classList.toggle("is-hidden", !shouldShow);
  elements.installAppButton.textContent = "Install Tamu App";
}

function isStandaloneDisplayMode() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIosInstallCandidate() {
  const userAgent = window.navigator.userAgent || window.navigator.vendor || "";
  return /iphone|ipad|ipod/i.test(userAgent) && !isStandaloneDisplayMode();
}

function updateInfoSections() {
  const currentSection = state.currentInfoSection;
  const infoModeOpen = Boolean(currentSection);

  if (elements.mainContent) {
    elements.mainContent.classList.toggle("is-hidden", infoModeOpen);
  }

  if (elements.siteInfoShell) {
    elements.siteInfoShell.classList.toggle("is-hidden", !infoModeOpen);
  }

  document.querySelectorAll("[data-info-target]").forEach((trigger) => {
    trigger.classList.toggle("is-active", trigger.dataset.infoTarget === currentSection);
  });

  document.querySelectorAll(".site-info-card").forEach((card) => {
    card.classList.toggle("is-hidden", card.id !== currentSection);
  });
}

async function writeImmediateOrderNotifications({ customerName, hotelId, hotelName, orderId }) {
  const normalizedOrderId = String(orderId || "").trim();
  const normalizedHotelId = String(hotelId || "").trim();
  if (!normalizedOrderId || !normalizedHotelId) {
    return false;
  }

  const normalizedCustomerName = String(customerName || "A customer").trim() || "A customer";
  const normalizedHotelName = String(hotelName || "selected hotel").trim() || "selected hotel";
  const timestamp = Date.now();
  const notificationPayloads = [
    {
      message: `${normalizedCustomerName} placed an order for ${normalizedHotelName}.`,
      read: false,
      refId: normalizedOrderId,
      timestamp,
      to: "admin",
      type: "order",
    },
    {
      message: `${normalizedCustomerName} placed an order for ${normalizedHotelName}.`,
      read: false,
      refId: normalizedOrderId,
      timestamp,
      to: normalizedHotelId,
      type: "order",
    },
  ];

  await Promise.all(
    notificationPayloads.map(async (notification) => {
      const notificationId = buildNotificationDocId(notification);
      if (notificationId) {
        await setDoc(doc(db, "notifications", notificationId), notification, { merge: true });
        return;
      }

      await addDoc(collection(db, "notifications"), notification);
    }),
  );

  await updateDoc(doc(db, "orders", normalizedOrderId), {
    notificationAdminDispatchedAt: timestamp,
    notificationHotelDispatchedAt: timestamp,
  }).catch(() => undefined);

  return true;
}

async function handleClick(event) {
  const infoTrigger = event.target.closest("[data-info-target]");
  if (infoTrigger) {
    event.preventDefault();
    setInfoSection(infoTrigger.dataset.infoTarget);
    return;
  }

  const locationTrigger = event.target.closest(".browseLocationBtn");
  if (locationTrigger) {
    openLocationDirectory(locationTrigger.dataset.location);
    return;
  }

  if (event.target.closest(".browseAllHotelsBtn")) {
    openLocationDirectory(null);
    return;
  }

  const switchTrigger = event.target.closest("[data-switch-tab]");
  if (switchTrigger) {
    switchTab(switchTrigger.dataset.switchTab);
    return;
  }

  const button = event.target.closest("button");
  if (event.target.id === "cartModalBackdrop") {
    closeCartModal();
    return;
  }

  if (!button) {
    return;
  }

  if (button.classList.contains("hotelAuthSwitchBtn")) {
    state.hotelAuthView = button.dataset.hotelAuthView === "register" ? "register" : "login";
    syncUi();
    return;
  }

  if (button.classList.contains("openHotelCartBtn")) {
    openHotelCartShortcut(button.dataset.hotel);
    return;
  }

  if (button.classList.contains("viewMenuBtn")) {
    toggleMenu(button.dataset.hotel);
    return;
  }

  if (button.classList.contains("browseDirectoryBtn")) {
    toggleRestaurantDirectory();
    return;
  }

  if (button.classList.contains("browseNavBtn")) {
    state.restaurantDirectoryOpen = true;
    state.locationDirectoryOpen = button.dataset.tab === "restaurants" && !state.selectedLocation && !state.activeHotelMenuId;
    switchTab(button.dataset.tab);
    return;
  }

  if (button.classList.contains("addToCart")) {
    addToCart(button);
    return;
  }

  if (button.classList.contains("removeItem")) {
    removeCartItem(button);
    return;
  }

  if (button.classList.contains("resetCart")) {
    resetCart(button.dataset.hotel);
    return;
  }

  if (button.classList.contains("placeOrder")) {
    openCartModal(button.dataset.hotel);
    return;
  }

  if (button.id === "confirmOrderBtn") {
    await handlePlaceOrder(button.dataset.hotel, { clearCartAfter: true, closeModal: true });
    return;
  }

  if (button.classList.contains("captureCustomerLocationBtn")) {
    await captureCustomerCheckoutLocation(button.dataset.hotel);
    return;
  }

  if (button.id === "closeCartModal") {
    closeCartModal();
    return;
  }

  if (button.classList.contains("markNotifRead")) {
    await updateDoc(doc(db, "notifications", button.dataset.id), { read: true });
    return;
  }

  if (button.classList.contains("deleteNotification")) {
    await deleteUserNotification(button.dataset.id);
    return;
  }

  if (button.dataset.togglePanel) {
    const panel = document.getElementById(button.dataset.togglePanel);
    if (panel) {
      panel.classList.toggle("is-hidden");
    }
    return;
  }

  if (button.classList.contains("deleteOrder")) {
    await deleteOrder(button.dataset.id);
    return;
  }

  if (button.classList.contains("markPaid")) {
    await markOrderPaid(button.dataset.id);
    return;
  }

  if (button.classList.contains("removeMenu")) {
    await removeMenuItem(button.dataset.index);
    return;
  }

  if (button.classList.contains("captureHotelLocationBtn")) {
    await captureHotelRegistrationCoordinates(button.closest("form"));
    return;
  }

  if (button.id === "saveHotelCurrentLocation") {
    await updateCurrentHotelCoordinates();
    return;
  }

  if (button.id === "logoutHotel") {
    await unregisterPushSubscription(state.currentHotelId);
    resetLiveNotificationAlertTracker(state.currentHotelId);
    state.currentHotelId = null;
    state.hotelAuthView = "login";
    state.currentAdmin = false;
    await signOut(auth).catch(() => undefined);
    await ensureCustomerSession().catch(() => undefined);
    syncActivePushSubscription();
    syncUi();
    return;
  }
}

function handleInput(event) {
  const input = event.target.closest(".checkout-input");
  if (!input) {
    return;
  }

  const hotelId = input.dataset.hotel;
  const field = input.dataset.field;

  state.checkoutDrafts[hotelId] = state.checkoutDrafts[hotelId] || {};
  state.checkoutDrafts[hotelId][field] = input.value;

  if (field === "customerArea" || field === "customerSpecificArea") {
    updateCheckoutLocationStatus(hotelId);
  }
}

async function deleteUserNotification(notificationIdValue) {
  const notificationId = String(notificationIdValue || "").trim();
  if (!notificationId) {
    return;
  }

  if (!window.confirm("Delete this notification?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "notifications", notificationId));
    showToast("Notification deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete notification.", "error");
  }
}

function handleChange(event) {
  const form = event.target.form;
  if (form?.id === "addMenu" && event.target.name === "itemAvailability") {
    syncMenuScheduleFields(form);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id === "feedbackForm") {
    await submitFeedback(form);
    return;
  }

  if (form.id === "hotelRegister") {
    await registerHotel(form);
    return;
  }

  if (form.id === "hotelLogin") {
    await loginHotel(form);
    return;
  }

  if (form.id === "addMenu") {
    await addMenuItem(form);
  }
}

async function submitFeedback(form) {
  const name = form.elements.feedbackName.value.trim();
  const phone = form.elements.feedbackPhone.value.trim();
  const message = form.elements.feedbackMessage.value.trim();

  if (!name || !phone || !message) {
    alert("Fill your name, phone number, and feedback message.");
    return;
  }

  const feedbackPayload = {
    createdAt: Date.now(),
    message,
    name,
    phone,
    status: "New",
  };

  let feedbackRef = null;

  try {
    feedbackRef = await addDoc(collection(db, "feedbacks"), feedbackPayload);
  } catch (error) {
    console.error("Feedback write failed", error);
    showToast("Failed to send feedback.", "error");
    return;
  }

  try {
    const notification = {
      message: `New feedback from ${name} (${phone})`,
      read: false,
      ...(feedbackRef?.id ? { refId: feedbackRef.id } : {}),
      timestamp: Date.now(),
      to: "admin",
      type: "feedback",
    };

    const notificationId = buildNotificationDocId(notification);
    if (notificationId) {
      await setDoc(doc(db, "notifications", notificationId), notification, { merge: true });
    } else {
      await addDoc(collection(db, "notifications"), notification);
    }
  } catch (error) {
    console.warn("Feedback notification write failed", error);
  }

  form.reset();
  showToast("Feedback sent successfully.", "success");
}

function toggleMenu(hotelId) {
  if (!isHotelOpenForCustomers(hotelId)) {
    showToast("This hotel is not available right now.", "info");
    state.activeHotelMenuId = null;
    syncUi();
    return;
  }

  state.restaurantDirectoryOpen = true;
  state.locationDirectoryOpen = false;
  state.activeHotelMenuId = state.activeHotelMenuId === hotelId ? null : hotelId;
  renderRestaurants();
}

function openHotelCartShortcut(hotelId) {
  const cart = getCart(hotelId);
  if (cart.length) {
    openCartModal(hotelId);
    return;
  }

  if (!isHotelOpenForCustomers(hotelId)) {
    state.activeHotelMenuId = null;
    showToast("This hotel is not available right now.", "info");
    syncUi();
    return;
  }

  state.restaurantDirectoryOpen = true;
  state.locationDirectoryOpen = false;
  state.activeHotelMenuId = hotelId;
  renderRestaurants();

  window.requestAnimationFrame(() => {
    const menuSection = [...document.querySelectorAll("[data-hotel-menu-id]")]
      .find((section) => section.dataset.hotelMenuId === hotelId);
    menuSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  showToast("Cart is empty. Add items from this menu first.", "info");
}

function toggleRestaurantDirectory() {
  const nextOpenState = !state.restaurantDirectoryOpen;
  state.restaurantDirectoryOpen = nextOpenState;

  if (nextOpenState) {
    state.locationDirectoryOpen = true;
    state.selectedLocation = null;
    state.activeHotelMenuId = null;
  } else {
    state.locationDirectoryOpen = false;
    state.activeHotelMenuId = null;
    state.selectedLocation = null;
    state.currentTab = "restaurants";
  }

  renderCurrentView();
}

function addToCart(button) {
  const hotelId = button.dataset.hotel;
  const name = button.dataset.name;
  const price = Number(button.dataset.price || 0);
  const row = button.closest("[data-menu-item]");
  const qtyInput = row?.querySelector(".qty-input");
  const qty = Math.max(1, Number.parseInt(qtyInput?.value || "1", 10) || 1);

  if (!isHotelOpenForCustomers(hotelId)) {
    showToast("This hotel is not available right now.", "info");
    state.activeHotelMenuId = null;
    syncUi();
    return;
  }

  state.cartByHotel[hotelId] = state.cartByHotel[hotelId] || [];
  const existingItem = state.cartByHotel[hotelId].find(
    (item) => item.name === name && Number(item.price) === price,
  );

  if (existingItem) {
    existingItem.qty += qty;
  } else {
    state.cartByHotel[hotelId].push({ name, price, qty });
  }

  const itemLabel = qty === 1 ? name : `${qty} x ${name}`;
  showToast(`Added to cart: ${itemLabel}.`, "success");
  syncUi();
}

function removeCartItem(button) {
  const hotelId = button.dataset.hotel;
  const index = Number.parseInt(button.dataset.index || "-1", 10);
  if (!state.cartByHotel[hotelId]) {
    return;
  }

  state.cartByHotel[hotelId].splice(index, 1);
  showToast("Item removed from cart.", "info");
  syncUi();
}

function resetCart(hotelId) {
  state.cartByHotel[hotelId] = [];
  showToast("Cart reset.", "info");
  syncUi();
}

async function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
    return;
  }

  const allowed =
    state.currentAdmin ||
    (state.currentHotelId && state.currentHotelId === order.hotelId) ||
    order.customerId === CUSTOMER_ID;

  if (!allowed) {
    alert("No permission to delete this order.");
    return;
  }

  if (!window.confirm("Delete this order permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "orders", orderId));
    showToast("Order deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Delete failed.", "error");
  }
}

async function markOrderPaid(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
    return;
  }

  const allowed = state.currentAdmin || state.currentHotelId === order.hotelId;
  if (!allowed) {
    alert("No permission to mark this order as paid.");
    return;
  }

  if ((order.status || "Pending") === "Paid") {
    showToast("Order is already marked as paid.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Paid" });
  } catch (error) {
    console.error(error);
    showToast("Failed to mark order as paid.", "error");
    return;
  }

  try {
    await notifyPaidOrderStatus(order, getHotelById(order.hotelId).name);
    showToast("Order marked as paid.", "success");
  } catch (error) {
    console.warn("Paid order notification failed", error);
    showToast("Order marked as paid, but notification delivery failed.", "warn");
  }
}

async function removeMenuItem(indexText) {
  const index = Number.parseInt(indexText || "-1", 10);
  const restaurant = getRestaurantByHotelId(state.currentHotelId);
  if (!restaurant) {
    return;
  }

  const nextMenu = [...(restaurant.menu || [])];
  nextMenu.splice(index, 1);

  await setDoc(doc(db, "restaurants", restaurant.id), {
    hotelId: state.currentHotelId,
    menu: nextMenu,
  });

  showToast("Menu item removed.", "success");
}

async function registerHotel(form) {
  const name = form.elements.hotelName.value.trim();
  const phone = form.elements.hotelPhone.value.trim();
  const pass = form.elements.hotelPass.value.trim();
  const till = form.elements.hotelTill.value.trim();
  const location = DEFAULT_HOTEL_LOCATION;
  let coordinates = readCoordinatesFromForm(form);
  const normalizedName = normalizeHotelAccountName(name);

  if (!name || !phone || !pass || !till) {
    alert("Fill in all hotel details.");
    return;
  }

  if (state.hotels.some((item) => normalizeHotelAccountName(item.name) === normalizedName)) {
    alert("A hotel with this name is already registered.");
    return;
  }

  if (!coordinates) {
    coordinates = await requestCurrentCoordinates();
    if (coordinates) {
      writeCoordinatesToForm(form, coordinates);
      updateHotelRegistrationCoordinateStatus(form, coordinates);
    }
  }

  if (!coordinates) {
    alert("Allow location access while registering the hotel so delivery distance and service fee can be calculated automatically.");
    return;
  }

  try {
    const county = await resolveCountyFromCoordinates(coordinates);
    await registerHotelWithServer({
      coordinates,
      ...(county ? {
        county,
        normalizedCounty: normalizeCountyKey(county),
      } : {}),
      location,
      name,
      password: pass,
      phone,
      till,
    });

    form.reset();
    updateHotelRegistrationCoordinateStatus(form, null);
    state.hotelAuthView = "login";
    showToast("Hotel registered. Wait for admin approval and subscription activation.", "success");
    syncUi();
  } catch (error) {
    console.error(error);
    showToast(String(error?.message || "Registration failed."), "error");
  }
}

async function loginHotel(form) {
  const name = form.elements.hotelName.value.trim();
  const pass = form.elements.hotelPass.value.trim();

  if (!name || !pass) {
    alert("Enter hotel name and password.");
    return;
  }

  try {
    const result = await loginHotelWithServer(name, pass);
    const hotelId = String(result?.hotelId || "").trim();
    const hotel =
      state.hotels.find((item) => item.id === hotelId) ||
      {
        id: hotelId,
        name: String(result?.hotelName || name).trim() || name,
      };

    if (!hotelId) {
      alert("Hotel login failed.");
      return;
    }

    state.currentHotelId = hotelId;
    resetLiveNotificationAlertTracker(hotelId);
    state.hotelAuthView = "login";
    state.currentAdmin = false;
    const pushEnabled = await registerPushSubscription(hotelId, hotel.name, {
      hotelId,
      role: "hotel",
    });
    switchTab("hotel");
    showToast(
      pushEnabled
        ? "Hotel login successful. Browser notifications enabled."
        : "Hotel login successful. Tap Enable Notifications to allow browser alerts.",
      pushEnabled ? "success" : "warn",
    );
  } catch (error) {
    console.error(error);
    alert(String(error?.message || "Wrong hotel name or password."));
  }
}

async function addMenuItem(form) {
  const name = form.elements.itemName.value.trim();
  const price = Number.parseFloat(form.elements.itemPrice.value);
  const availability = form.elements.itemAvailability?.value === "scheduled" ? "scheduled" : "daily";
  const day = availability === "scheduled" ? normalizeMenuDay(form.elements.itemDay?.value) : "";
  const mealPeriod = availability === "scheduled"
    ? normalizeMenuMealPeriod(form.elements.itemMealPeriod?.value)
    : "";

  if (!name || Number.isNaN(price)) {
    alert("Fill a valid menu item and price.");
    return;
  }

  if (availability === "scheduled" && !day) {
    alert("Choose the day for this scheduled menu item.");
    return;
  }

  const restaurant = getRestaurantByHotelId(state.currentHotelId);
  const nextMenu = [
    ...(restaurant?.menu || []),
    {
      name,
      price,
      ...(day ? { day } : {}),
      ...(mealPeriod ? { mealPeriod } : {}),
    },
  ];
  const docId = restaurant?.id || state.currentHotelId;

  await setDoc(doc(db, "restaurants", docId), {
    hotelId: state.currentHotelId,
    menu: nextMenu,
  });

  form.reset();
  syncMenuScheduleFields(form);
  showToast("Menu item added.", "success");
}

function syncMenuScheduleFields(form) {
  const isScheduled = form?.elements.itemAvailability?.value === "scheduled";
  const scheduleFields = form?.querySelector("[data-menu-schedule-fields]");
  const daySelect = form?.elements.itemDay;
  const mealPeriodSelect = form?.elements.itemMealPeriod;

  scheduleFields?.classList.toggle("is-hidden", !isScheduled);

  if (daySelect) {
    daySelect.disabled = !isScheduled;
    if (!isScheduled) {
      daySelect.value = "";
    }
  }

  if (mealPeriodSelect) {
    mealPeriodSelect.disabled = !isScheduled;
    if (!isScheduled) {
      mealPeriodSelect.value = "";
    }
  }
}

function openCartModal(hotelId) {
  if (!isHotelOpenForCustomers(hotelId)) {
    state.activeHotelMenuId = null;
    showToast("This hotel is not available right now.", "info");
    syncUi();
    return;
  }

  const cart = getCart(hotelId);
  if (!cart.length) {
    alert("Cart is empty.");
    return;
  }

  const hotel = getHotelById(hotelId);
  const draft = getCheckoutDraft(hotelId);
  const cartItemCount = getCartItemCount(cart);
  const serviceFee = getServiceFeeForHotel(hotel);
  const hasHotelCoordinates = Boolean(getHotelCoordinates(hotel));
  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + serviceFee;

  elements.cartModalContent.innerHTML = `
    <div class="stack">
      <div class="split-row">
        <div>
          <p class="eyebrow">Cart</p>
          <h3 id="modalTitle" class="card-title">${escapeHtml(hotel.name)}</h3>
        </div>
        <span class="summary-chip">${cartItemCount} item${cartItemCount === 1 ? "" : "s"}</span>
        <button class="button button-outline button-small" id="closeCartModal" type="button">Close</button>
      </div>

      <div class="menu-list">
        ${cart
          .map(
            (item, index) => `
              <div class="order-item">
                <div class="split-row">
                  <strong>${escapeHtml(`${item.qty} x ${item.name}`)}</strong>
                  <div class="inline-list">
                    <span class="item-price">${formatCurrency(item.price * item.qty)}</span>
                    <button
                      class="button button-danger-soft button-small removeItem"
                      data-hotel="${escapeHtml(hotelId)}"
                      data-index="${escapeHtml(String(index))}"
                      type="button"
                      aria-label="Remove ${escapeHtml(item.name)} from cart"
                    >
                      X
                    </button>
                  </div>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="summary-list">
        <div class="summary-item"><span>Items total</span><strong>${formatCurrency(itemsTotal)}</strong></div>
        <div class="summary-item"><span>${hasHotelCoordinates ? "Estimated service fee" : "Service fee"}</span><strong>${formatCurrency(serviceFee)}</strong></div>
        <div class="summary-item"><span>${hasHotelCoordinates ? "Estimated total" : "Total"}</span><strong>${formatCurrency(total)}</strong></div>
      </div>

      <div class="cart-alert">
        <strong>Before placing order</strong>
        <p>
          Please call
          <a href="tel:${escapeHtml(hotel.phone || "")}">${escapeHtml(hotel.phone || "the hotel")}</a>
          before placing order for food confirmation.
        </p>
        <p class="tiny">${
          hasHotelCoordinates
            ? `Allow location access when confirming so the final delivery fee is calculated from your distance to ${escapeHtml(hotel.name)}.`
            : `${escapeHtml(hotel.name)} has not saved a map point yet, so the base service fee will be used for this order.`
        }</p>
        <p class="tiny">Pay the delivery fee in till ${escapeHtml(SERVICE_FEE_TILL)}.</p>
      </div>

      <div class="info-box">
        <p><strong>${escapeHtml(hotel.name)}</strong> location: ${escapeHtml(getHotelLocation(hotel))}</p>
        <p><strong>${escapeHtml(hotel.name)}</strong> phone: ${escapeHtml(hotel.phone || "N/A")}</p>
        <p><strong>${escapeHtml(hotel.name)}</strong> food till: ${escapeHtml(hotel.till || "N/A")}</p>
        <p class="tiny">Service fee till: ${escapeHtml(SERVICE_FEE_TILL)}</p>
      </div>

      <div class="field-grid">
        <label class="field">
          <span class="field-label">M-PESA name</span>
          <input
            class="input checkout-input"
            data-field="mpesaName"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="Name used for payment"
            value="${escapeHtml(draft.mpesaName)}"
          />
        </label>

        <label class="field">
          <span class="field-label">M-PESA number</span>
          <input
            class="input checkout-input"
            data-field="mpesaNumber"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="07XXXXXXXX"
            value="${escapeHtml(draft.mpesaNumber)}"
          />
        </label>

        <label class="field">
          <span class="field-label">Your name</span>
          <input
            class="input checkout-input"
            data-field="custName"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="Customer name"
            value="${escapeHtml(draft.custName)}"
          />
        </label>

        <label class="field">
          <span class="field-label">Your phone</span>
          <input
            class="input checkout-input"
            data-field="custPhone"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="07XXXXXXXX"
            value="${escapeHtml(draft.custPhone)}"
          />
        </label>
      </div>

      <div class="info-box">
        <div class="split-row">
          <div class="stack">
            <p class="eyebrow">Delivery point</p>
            <p class="tiny" data-customer-geo-status data-hotel="${escapeHtml(hotelId)}">${escapeHtml(getCheckoutLocationStatusCopy(hotelId))}</p>
          </div>
          <button
            class="button button-secondary button-small button-compact captureCustomerLocationBtn"
            data-hotel="${escapeHtml(hotelId)}"
            type="button"
          >
            Use My Current Location
          </button>
        </div>

        <label class="field">
          <span class="field-label">Area / building</span>
          <input
            class="input checkout-input"
            data-field="customerArea"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="Hostel, building, or nearby place"
            value="${escapeHtml(draft.customerArea)}"
          />
        </label>

        <label class="field">
          <span class="field-label">Specific area (edit text)</span>
          <input
            class="input checkout-input"
            data-field="customerSpecificArea"
            data-hotel="${escapeHtml(hotelId)}"
            placeholder="Room, block, gate, floor, or exact stay point"
            value="${escapeHtml(draft.customerSpecificArea || "")}"
          />
        </label>
      </div>

      <div class="button-row">
        <button class="button button-primary" data-hotel="${escapeHtml(hotelId)}" id="confirmOrderBtn" type="button">
          Confirm Order
        </button>
        <button class="button button-outline" id="closeCartModal" type="button">Keep Shopping</button>
      </div>

      <p class="tiny">You can continue payment details here without scrolling down the page.</p>
    </div>
  `;

  elements.cartModalContainer.classList.remove("is-hidden");
  elements.cartModalContainer.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  const firstInput = elements.cartModalContent.querySelector(".input");
  if (firstInput) {
    firstInput.focus();
  }
}

function closeCartModal() {
  elements.cartModalContainer.classList.add("is-hidden");
  elements.cartModalContainer.setAttribute("aria-hidden", "true");
  elements.cartModalContent.innerHTML = "";
  document.body.classList.remove("modal-open");
}

async function handlePlaceOrder(hotelId, options = { clearCartAfter: false, closeModal: true }) {
  if (!isHotelOpenForCustomers(hotelId)) {
    if (options.closeModal) {
      closeCartModal();
    }

    state.activeHotelMenuId = null;
    showToast("This hotel is not available right now.", "info");
    syncUi();
    return;
  }

  const cart = getCart(hotelId);
  if (!cart.length) {
    if (options.closeModal) {
      closeCartModal();
    }

    alert("Cart is empty.");
    return;
  }

  const draft = getCheckoutDraft(hotelId);
  const mpesaName = draft.mpesaName.trim();
  const mpesaNumber = draft.mpesaNumber.trim();
  const customerName = draft.custName.trim();
  const customerPhone = draft.custPhone.trim();

  if (!customerName || !customerPhone) {
    alert("Fill your name and phone.");
    return;
  }

  if (!mpesaName || !mpesaNumber) {
    alert("Enter M-PESA name and number.");
    return;
  }

  const snapshot = await getDocs(collection(db, "orders"));
  const allOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const pendingOrders = allOrders.filter((item) => (item.status || "Pending") !== "Paid").length;

  if (pendingOrders >= 100) {
    alert("Maximum pending orders reached. Try again later.");
    return;
  }

  const hotel = getHotelById(hotelId);
  let customerCoordinates = readCheckoutCustomerCoordinates(hotelId);
  let customerArea = getCheckoutCustomerArea(hotelId);
  const customerSpecificArea = getCheckoutCustomerSpecificArea(hotelId);

  if (!customerCoordinates) {
    const liveCoordinates = await requestCurrentCoordinates();
    if (liveCoordinates) {
      const detectedArea = customerArea || (await resolveCustomerAreaLabel(liveCoordinates));
      setCheckoutCustomerLocationDraft(hotelId, liveCoordinates, detectedArea);
      customerCoordinates = liveCoordinates;
      customerArea = getCheckoutCustomerArea(hotelId);
    }
  }

  const feeDetails = await resolveOrderFeeDetails(hotel, customerCoordinates, customerArea, customerSpecificArea);
  if (!customerCoordinates && feeDetails.customerCoordinates) {
    setCheckoutCustomerLocationDraft(hotelId, feeDetails.customerCoordinates, customerArea);
    customerCoordinates = feeDetails.customerCoordinates;
    customerArea = getCheckoutCustomerArea(hotelId);
  }
  const serviceFee = feeDetails.serviceFee;
  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + serviceFee;
  const resolvedCustomerCoordinates = normalizeCoordinates(feeDetails.customerCoordinates || customerCoordinates);
  const [customerCounty, hotelCounty] = await Promise.all([
    resolveOrderCustomerCounty(customerArea, customerSpecificArea, resolvedCustomerCoordinates),
    resolveHotelCounty(hotel),
  ]);
  const deliveryCounty = customerCounty || hotelCounty || detectCountyFromText([customerSpecificArea, customerArea].join(" "));

  if (feeDetails.serviceFeeSource !== "distance") {
    showToast("Distance could not be confirmed from location or typed area. Delivery fee used base amount.", "warn");
  }

  const orderPayload = {
    createdAt: Date.now(),
    customerId: CUSTOMER_ID,
    customerName,
    customerPhone,
    ...(customerArea ? { customerArea } : {}),
    ...(customerCounty ? {
      customerCounty,
      normalizedCustomerCounty: normalizeCountyKey(customerCounty),
    } : {}),
    ...(customerSpecificArea ? { customerSpecificArea } : {}),
    ...(deliveryCounty ? {
      county: deliveryCounty,
      deliveryCounty,
      normalizedCounty: normalizeCountyKey(deliveryCounty),
      normalizedDeliveryCounty: normalizeCountyKey(deliveryCounty),
    } : {}),
    ...(hotelCounty ? {
      hotelCounty,
      normalizedHotelCounty: normalizeCountyKey(hotelCounty),
    } : {}),
    hotelId,
    items: cart.map((item) => ({
      name: item.name,
      price: Number(item.price || 0),
      qty: Number(item.qty || 1),
    })),
    ...(feeDetails.customerCoordinates ? { customerCoordinates: feeDetails.customerCoordinates } : {}),
    itemsTotal,
    ...(Number.isFinite(feeDetails.distanceKm) ? { distanceKm: feeDetails.distanceKm } : {}),
    ...(feeDetails.hotelCoordinates ? { hotelCoordinates: feeDetails.hotelCoordinates } : {}),
    mpesaName,
    mpesaNumber,
    serviceFeeBand: feeDetails.serviceFeeBand,
    serviceFeeLabel: feeDetails.serviceFeeLabel,
    serviceFeeSource: feeDetails.serviceFeeSource,
    serviceFee,
    serviceFeeBase: getServiceFeeForHotel(hotel),
    serviceFeeTill: SERVICE_FEE_TILL,
    status: "Pending",
    total,
  };

  state.currentCustomer = { name: customerName, phone: customerPhone };
  saveCustomerProfile(state.currentCustomer);
  saveOrderProfile({
    custName: customerName,
    custPhone: customerPhone,
    mpesaName,
    mpesaNumber,
  });

  void registerPushSubscription(CUSTOMER_ID, customerName, {
    customerId: CUSTOMER_ID,
    requestPermission: getNotificationPermissionState() === "default",
    role: "customer",
    silent: true,
  });

  let notificationSent = false;
  let createdOrderId = "";

  try {
    const orderRef = await addDoc(collection(db, "orders"), orderPayload);
    createdOrderId = orderRef.id;
    await writeImmediateOrderNotifications({
      customerName,
      hotelId,
      hotelName: hotel.name,
      orderId: createdOrderId,
    }).catch((error) => {
      console.warn("Immediate order notification write failed", error);
      return false;
    });
    sendSimulatedHotelSMS(hotelId, {
      customerName,
      customerPhone,
      distanceKm: feeDetails.distanceKm,
      total,
    });
    notificationSent = await dispatchOrderNotification(orderRef.id, "order", {
      customerId: CUSTOMER_ID,
      hotelId,
    });
    if (!notificationSent) {
      console.warn("Order notification dispatch did not confirm delivery.");
    }
    showToast(
      Number.isFinite(feeDetails.distanceKm)
        ? `Order placed. Delivery fee ${formatCurrency(serviceFee)} for ${formatDistanceKm(feeDetails.distanceKm)}.`
        : "Order placed successfully.",
      "success",
    );
  } catch (error) {
    console.error("Order write failed", error);
    showToast("Failed to place order.", "error");
    return;
  }

  const notificationMessage = `${customerName} placed an order for ${hotel.name}.`;

  if (!notificationSent) {
    try {
      const adminNotification = {
        message: notificationMessage,
        read: false,
        ...(createdOrderId ? { refId: createdOrderId } : {}),
        timestamp: Date.now(),
        to: "admin",
        type: "order",
      };
      const adminNotificationId = buildNotificationDocId(adminNotification);
      if (adminNotificationId) {
        await setDoc(doc(db, "notifications", adminNotificationId), adminNotification, { merge: true });
      } else {
        await addDoc(collection(db, "notifications"), adminNotification);
      }

      const hotelNotification = {
        message: notificationMessage,
        read: false,
        ...(createdOrderId ? { refId: createdOrderId } : {}),
        timestamp: Date.now(),
        to: hotelId,
        type: "order",
      };
      const hotelNotificationId = buildNotificationDocId(hotelNotification);
      if (hotelNotificationId) {
        await setDoc(doc(db, "notifications", hotelNotificationId), hotelNotification, { merge: true });
      } else {
        await addDoc(collection(db, "notifications"), hotelNotification);
      }

      if (createdOrderId) {
        await updateDoc(doc(db, "orders", createdOrderId), {
          notificationAdminDispatchedAt: Date.now(),
          notificationHotelDispatchedAt: Date.now(),
        }).catch(() => undefined);
      }
    } catch (error) {
      console.warn("Notification write failed", error);
    }
  }

  if (options.clearCartAfter) {
    state.cartByHotel[hotelId] = [];
  }

  if (options.closeModal) {
    closeCartModal();
  }

  switchTab("orders");
}

function sendSimulatedHotelSMS(hotelId, order) {
  if (!SMS_SIMULATION_ENABLED) {
    return;
  }

  const hotel = getHotelById(hotelId);
  if (!hotel.phone || hotel.phone === "N/A") {
    console.warn("Hotel phone missing, SMS not sent.");
    return;
  }

  const message = [
    "NEW ORDER RECEIVED",
    `Hotel: ${hotel.name}`,
    `Customer: ${order.customerName}`,
    `Customer Phone: ${order.customerPhone}`,
    ...(Number.isFinite(order.distanceKm) ? [`Distance: ${formatDistanceKm(order.distanceKm)}`] : []),
    `Total Amount: ${formatCurrency(order.total)}`,
    "Please check your dashboard.",
  ].join("\n");

  const sms = {
    hotelId,
    message,
    time: new Date().toLocaleString("en-KE", { hour12: false }),
    to: hotel.phone,
  };

  const inbox = JSON.parse(localStorage.getItem("SIMULATED_SMS_INBOX") || "[]");
  inbox.push(sms);
  localStorage.setItem("SIMULATED_SMS_INBOX", JSON.stringify(inbox));

  console.log("Simulated SMS:", sms);
}

function viewSimulatedSMSInbox() {
  const inbox = JSON.parse(localStorage.getItem("SIMULATED_SMS_INBOX") || "[]");
  console.table(inbox);
  showToast(inbox.length ? "Simulated SMS inbox printed to console." : "No simulated SMS messages yet.", "info");
}

window.viewSimulatedSMSInbox = viewSimulatedSMSInbox;
