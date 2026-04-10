import { DEFAULT_HOTEL_LOCATION } from "./config.js";
import { loadSavedCustomerProfile, loadSavedOrderProfile, getCustomerId } from "./storage.js";

export const CUSTOMER_ID = getCustomerId();

export const state = {
  hotels: [],
  restaurants: [],
  orders: [],
  ummaShopOrders: [],
  feedbacks: [],
  notifications: [],
  employees: [],
  cartByHotel: {},
  checkoutDrafts: {},
  activeHotelMenuId: null,
  locationDirectoryOpen: false,
  restaurantDirectoryOpen: false,
  currentTab: "restaurants",
  currentInfoSection: null,
  selectedLocation: null,
  currentHotelId: null,
  hotelAuthView: "login",
  currentAdmin: false,
  adminPanelSection: "dashboard",
  adminSidebarOpen: false,
  currentCustomer: loadSavedCustomerProfile(),
};

export const elements = {
  app: document.getElementById("app"),
  brandHome: document.getElementById("brandHome"),
  cartModalContainer: document.getElementById("cartModalContainer"),
  cartModalContent: document.getElementById("cartModalContent"),
  footer: document.getElementById("footer"),
  mainContent: document.getElementById("mainContent"),
  installAppButton: document.getElementById("installAppButton"),
  notificationPromptButton: document.getElementById("notificationPromptButton"),
  heroHotelCount: document.getElementById("heroHotelCount"),
  heroOrderCount: document.getElementById("heroOrderCount"),
  heroRestaurantCount: document.getElementById("heroRestaurantCount"),
  hotelNotifBadge: document.getElementById("hotelNotifBadge"),
  noticeText: document.getElementById("noticeText"),
  noticeTextClone: document.getElementById("noticeTextClone"),
  restBadge: document.getElementById("restBadge"),
  serviceFeeAmount: document.getElementById("serviceFeeAmount"),
  serviceFeeTill: document.getElementById("serviceFeeTill"),
  siteInfoShell: document.getElementById("siteInfoShell"),
  toastContainer: document.getElementById("toastContainer"),
  year: document.getElementById("year"),
};

function isTrueFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function isHotelOpenForCustomers(hotelOrId) {
  const hotel = typeof hotelOrId === "string" ? getHotelById(hotelOrId) : hotelOrId;
  return Boolean(hotel?.id) && isTrueFlag(hotel.approved) && !isTrueFlag(hotel.blocked);
}

export function normalizeHotelLocation(location) {
  return String(location || "").trim().replace(/\s+/g, " ") || DEFAULT_HOTEL_LOCATION;
}

export function getHotelLocation(hotelOrId) {
  const hotel = typeof hotelOrId === "string" ? getHotelById(hotelOrId) : hotelOrId;
  return normalizeHotelLocation(hotel?.location);
}

export function getVisibleRestaurants(location = state.selectedLocation) {
  const normalizedLocation = location ? normalizeHotelLocation(location) : null;
  return state.hotels
    .filter((hotel) => isHotelOpenForCustomers(hotel))
    .filter((hotel) => !normalizedLocation || getHotelLocation(hotel) === normalizedLocation)
    .map((hotel) => {
      const restaurant = getRestaurantByHotelId(hotel.id);
      return {
        hotelId: hotel.id,
        id: restaurant?.id || hotel.id,
        menu: Array.isArray(restaurant?.menu) ? restaurant.menu : [],
      };
    })
    .sort((left, right) => getHotelById(left.hotelId).name.localeCompare(getHotelById(right.hotelId).name));
}

export function getLocationCards() {
  const cards = new Map();

  state.hotels
    .filter((hotel) => isHotelOpenForCustomers(hotel))
    .forEach((hotel) => {
      const location = getHotelLocation(hotel);
      const restaurant = getRestaurantByHotelId(hotel.id);

      if (!cards.has(location)) {
        cards.set(location, {
          hotelCount: 0,
          hotels: [],
          menuCount: 0,
          name: location,
        });
      }

      const card = cards.get(location);
      card.hotelCount += 1;
      card.menuCount += Array.isArray(restaurant?.menu) ? restaurant.menu.length : 0;
      card.hotels.push(hotel.name);
    });

  return [...cards.values()].sort((left, right) => {
    if (left.name === DEFAULT_HOTEL_LOCATION && right.name !== DEFAULT_HOTEL_LOCATION) {
      return -1;
    }

    if (right.name === DEFAULT_HOTEL_LOCATION && left.name !== DEFAULT_HOTEL_LOCATION) {
      return 1;
    }

    if (right.hotelCount !== left.hotelCount) {
      return right.hotelCount - left.hotelCount;
    }

    if (right.menuCount !== left.menuCount) {
      return right.menuCount - left.menuCount;
    }

    return left.name.localeCompare(right.name);
  });
}

export function getVisibleOrders() {
  if (state.currentAdmin) {
    return [...state.orders];
  }

  if (state.currentHotelId) {
    return state.orders.filter((order) => order.hotelId === state.currentHotelId);
  }

  return state.orders.filter((order) => order.customerId === CUSTOMER_ID);
}

function normalizeNotificationTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

<<<<<<< HEAD
function createNotificationFingerprint(item) {
  const type = String(item?.type || "").trim().toLowerCase();
  const message = String(item?.message || "").trim();
  const timestamp = normalizeNotificationTimestamp(item?.timestamp);
  return `${type}|${message}|${timestamp}`;
=======
function normalizeNotificationRefId(value) {
  return String(value || "").trim().slice(0, 180);
}

function normalizeNotificationMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 500);
}

function createNotificationFingerprint(item) {
  const target = String(item?.to || "").trim();
  const type = String(item?.type || "").trim().toLowerCase();
  const refId = normalizeNotificationRefId(item?.refId);
  if (refId) {
    return `${target}|${type}|${refId}`;
  }

  const message = normalizeNotificationMessage(item?.message);
  return `${target}|${type}|${message}`;
}

function dedupeNotifications(items) {
  const list = Array.isArray(items) ? items : [];
  const bestByFingerprint = new Map();

  list.forEach((item) => {
    const fingerprint = createNotificationFingerprint(item);
    if (!fingerprint) {
      return;
    }

    const existing = bestByFingerprint.get(fingerprint);
    if (!existing) {
      bestByFingerprint.set(fingerprint, item);
      return;
    }

    const existingTimestamp = normalizeNotificationTimestamp(existing?.timestamp);
    const nextTimestamp = normalizeNotificationTimestamp(item?.timestamp);
    if (nextTimestamp >= existingTimestamp) {
      bestByFingerprint.set(fingerprint, item);
    }
  });

  return [...bestByFingerprint.values()];
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
}

function buildAdminFallbackNotifications() {
  const orderNotifications = state.orders.map((order) => {
    const hotelName = getHotelById(order.hotelId).name;
    const customerName = String(order.customerName || "A customer").trim() || "A customer";
    return {
      fallback: true,
      id: `fallback-admin-order-${order.id}`,
      message: `${customerName} placed an order for ${hotelName}.`,
      read: true,
<<<<<<< HEAD
=======
      refId: order.id,
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
      timestamp: normalizeNotificationTimestamp(order.createdAt),
      to: "admin",
      type: "order",
    };
  });

  const shopOrderNotifications = state.ummaShopOrders.map((order) => {
    const customerName = String(order.customerName || "A customer").trim() || "A customer";
    const shopName = String(order.shopName || "Around Umma University").trim() || "Around Umma University";
    return {
      fallback: true,
      id: `fallback-admin-shop-${order.id}`,
      message: `${customerName} submitted a Shop Here order for ${shopName}.`,
      read: true,
<<<<<<< HEAD
=======
      refId: order.id,
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
      timestamp: normalizeNotificationTimestamp(order.createdAt),
      to: "admin",
      type: "umma-shop-order",
    };
  });

  const feedbackNotifications = state.feedbacks.map((feedback) => {
    const sender = String(feedback.name || "Anonymous").trim() || "Anonymous";
    const phone = String(feedback.phone || "N/A").trim() || "N/A";
    return {
      fallback: true,
      id: `fallback-admin-feedback-${feedback.id}`,
      message: `New feedback from ${sender} (${phone})`,
      read: true,
<<<<<<< HEAD
=======
      refId: feedback.id,
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
      timestamp: normalizeNotificationTimestamp(feedback.createdAt),
      to: "admin",
      type: "feedback",
    };
  });

  return [...orderNotifications, ...shopOrderNotifications, ...feedbackNotifications];
}

function buildHotelFallbackNotifications(hotelId) {
  return state.orders
    .filter((order) => String(order.hotelId || "").trim() === hotelId)
    .map((order) => {
      const customerName = String(order.customerName || "A customer").trim() || "A customer";
      const normalizedStatus = String(order.status || "Pending").trim().toLowerCase();
      const isPaid = normalizedStatus === "paid";

      return {
        fallback: true,
        id: `fallback-hotel-order-${hotelId}-${order.id}`,
        message: isPaid
          ? `Order for ${customerName} has been marked as paid.`
          : `${customerName} placed a new order.`,
        read: true,
<<<<<<< HEAD
=======
        refId: order.id,
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
        timestamp: normalizeNotificationTimestamp(order.createdAt),
        to: hotelId,
        type: isPaid ? "order-paid" : "order",
      };
    });
}

function buildCustomerFallbackNotifications(customerId) {
  return state.orders
    .filter((order) => String(order.customerId || "").trim() === customerId)
    .map((order) => {
      const hotelName = getHotelById(order.hotelId).name;
      const normalizedStatus = String(order.status || "Pending").trim().toLowerCase();
      const isPaid = normalizedStatus === "paid";

      return {
        fallback: true,
        id: `fallback-customer-order-${customerId}-${order.id}`,
        message: isPaid
          ? `Your order for ${hotelName} has been marked as paid.`
          : `Your order for ${hotelName} has been received.`,
        read: true,
<<<<<<< HEAD
=======
        refId: order.id,
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
        timestamp: normalizeNotificationTimestamp(order.createdAt),
        to: customerId,
        type: isPaid ? "order-paid" : "order",
      };
    });
}

function buildFallbackNotificationsForTarget(target) {
  if (!target) {
    return [];
  }

  if (target === "admin") {
    return buildAdminFallbackNotifications();
  }

  if (state.hotels.some((hotel) => hotel.id === target)) {
    return buildHotelFallbackNotifications(target);
  }

  return buildCustomerFallbackNotifications(target);
}

export function getNotificationsForTarget(target) {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return [];
  }

<<<<<<< HEAD
  const directNotifications = state.notifications.filter(
    (item) => String(item.to || "").trim() === normalizedTarget,
=======
  const directNotifications = dedupeNotifications(
    state.notifications.filter((item) => String(item.to || "").trim() === normalizedTarget),
>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
  );
  const fallbackNotifications = buildFallbackNotificationsForTarget(normalizedTarget);

  if (!directNotifications.length) {
    return fallbackNotifications;
  }

  if (!fallbackNotifications.length) {
    return directNotifications;
  }

  const fingerprints = new Set(directNotifications.map(createNotificationFingerprint));
  const merged = [...directNotifications];

  fallbackNotifications.forEach((item) => {
    const fingerprint = createNotificationFingerprint(item);
    if (fingerprints.has(fingerprint)) {
      return;
    }

    fingerprints.add(fingerprint);
    merged.push(item);
  });

  return merged;
}

export function getHotelById(id) {
  return (
    state.hotels.find((hotel) => hotel.id === id) || {
      id: "",
      location: DEFAULT_HOTEL_LOCATION,
      name: "Unknown hotel",
      phone: "N/A",
      till: "N/A",
      approved: false,
      blocked: false,
    }
  );
}

export function getRestaurantByHotelId(hotelId) {
  return state.restaurants.find((restaurant) => restaurant.hotelId === hotelId);
}

export function getCart(hotelId) {
  return state.cartByHotel[hotelId] || [];
}

export function getCartItemCount(items) {
  return items.reduce((total, item) => total + Number(item.qty || 1), 0);
}

export function getCartItemsTotal(items) {
  return items.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 1), 0);
}

export function getCheckoutDraft(hotelId) {
  const saved = loadSavedOrderProfile();
  const draft = state.checkoutDrafts[hotelId] || {};

  return {
    custName: draft.custName ?? saved.custName ?? state.currentCustomer?.name ?? "",
    custPhone: draft.custPhone ?? saved.custPhone ?? state.currentCustomer?.phone ?? "",
    customerAccuracy: draft.customerAccuracy ?? "",
    customerArea: draft.customerArea ?? "",
    customerSpecificArea: draft.customerSpecificArea ?? "",
    customerLatitude: draft.customerLatitude ?? "",
    customerLocationLabel: draft.customerLocationLabel ?? "",
    customerLongitude: draft.customerLongitude ?? "",
    mpesaName: draft.mpesaName ?? saved.mpesaName ?? "",
    mpesaNumber: draft.mpesaNumber ?? saved.mpesaNumber ?? "",
  };
}
