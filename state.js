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
  restaurantSearchOpen: false,
  restaurantSearchQuery: "",
  currentTab: "restaurants",
  currentInfoSection: null,
  selectedLocation: null,
  currentHotelId: null,
  hotelAuthView: "login",
  currentAdmin: false,
  adminAccessStatus: "signed_out",
  adminAccessMessage: "",
  adminUserEmail: "",
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
  mombasa: [
    "mombasa",
    "mombasa cbd",
    "nyali",
    "bamburi",
    "likoni",
    "kisauni",
    "changamwe",
    "shanzu",
    "mtwapa",
    "tudor",
    "mikindani",
  ],
};

function normalizeLocationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayCountyName(value) {
  const normalizedValue = normalizeLocationKey(value);
  if (!normalizedValue) {
    return "";
  }

  return COUNTY_NAMES.find((county) => normalizeLocationKey(county) === normalizedValue) || "";
}

function detectCountyFromText(value) {
  const normalizedValue = normalizeLocationKey(value);
  if (!normalizedValue) {
    return "";
  }

  for (const [countyKey, aliases] of Object.entries(COUNTY_TEXT_ALIAS_MAP)) {
    if (aliases.some((alias) => normalizedValue.includes(normalizeLocationKey(alias)))) {
      return toDisplayCountyName(countyKey);
    }
  }

  return COUNTY_NAMES.find((county) => normalizedValue.includes(normalizeLocationKey(county))) || "";
}

function matchesDefaultHotelLocation(value) {
  const normalizedValue = normalizeHotelLocation(value).toLowerCase();
  return normalizedValue === DEFAULT_HOTEL_LOCATION.toLowerCase() || normalizedValue.includes("umma universit");
}

function getHotelLocationCardName(hotel) {
  const location = getHotelLocation(hotel);
  if (matchesDefaultHotelLocation(location)) {
    return DEFAULT_HOTEL_LOCATION;
  }

  const county = toDisplayCountyName(hotel?.county || hotel?.normalizedCounty) || detectCountyFromText(location);
  return location || county || DEFAULT_HOTEL_LOCATION;
}

export function getHotelLocation(hotelOrId) {
  const hotel = typeof hotelOrId === "string" ? getHotelById(hotelOrId) : hotelOrId;
  return normalizeHotelLocation(hotel?.location);
}

export function getHotelCountyName(hotelOrId) {
  const hotel = typeof hotelOrId === "string" ? getHotelById(hotelOrId) : hotelOrId;
  const location = getHotelLocation(hotel);
  return toDisplayCountyName(hotel?.county || hotel?.normalizedCounty) || detectCountyFromText(location);
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSearchText(values, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = values.map(normalizeSearchText).filter(Boolean).join(" ");
  return normalizedQuery.split(" ").every((term) => haystack.includes(term));
}

function normalizeMenuItems(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return {
            name: String(item || "").trim(),
            price: "",
          };
        }

        return {
          ...item,
          name: item.name ?? item.title ?? item.itemName ?? item.foodName ?? item.dishName ?? "",
          price: item.price ?? item.amount ?? item.cost ?? item.value ?? "",
        };
      })
      .filter((item) => {
        if (!item || typeof item !== "object") {
          return false;
        }

        return String(item.name || "").trim();
      });
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        if (item && typeof item === "object") {
          return {
            id: item.id ?? key,
            ...item,
            name: item.name ?? item.title ?? item.itemName ?? item.foodName ?? item.dishName ?? key,
            price: item.price ?? item.amount ?? item.cost ?? item.value ?? "",
          };
        }

        return {
          id: key,
          name: key,
          price: item,
        };
      })
      .filter((item) => String(item.name || "").trim());
  }

  return [];
}

function getRestaurantMenuItems(restaurant) {
  return normalizeMenuItems(
    restaurant?.menu ??
      restaurant?.menus ??
      restaurant?.items ??
      restaurant?.products ??
      restaurant?.dishes ??
      restaurant?.foodItems,
  );
}

function normalizeMatchKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function restaurantMatchesHotel(restaurant, hotel) {
  if (!restaurant || !hotel?.id) {
    return false;
  }

  const hotelId = String(hotel.id || "").trim();
  const hotelName = normalizeMatchKey(hotel.name);
  const restaurantHotelIds = [
    restaurant.hotelId,
    restaurant.hotelID,
    restaurant.hotel_id,
    restaurant.hotel,
    restaurant.ownerHotelId,
    restaurant.restaurantId,
    restaurant.id,
  ].map((item) => String(item || "").trim());

  if (restaurantHotelIds.some((item) => item === hotelId)) {
    return true;
  }

  const restaurantHotelNames = [
    restaurant.hotelName,
    restaurant.restaurantName,
    restaurant.name,
    restaurant.title,
    restaurant.id,
  ].map(normalizeMatchKey);

  return Boolean(hotelName) && restaurantHotelNames.some((item) => item === hotelName);
}

export function hotelMatchesSearch(hotelOrId, query) {
  const hotel = typeof hotelOrId === "string" ? getHotelById(hotelOrId) : hotelOrId;
  const restaurant = getRestaurantByHotelId(hotel?.id);
  const menuNames = restaurant?.menu.map((item) => item?.name) || [];

  return matchesSearchText([
    hotel?.name,
    hotel?.phone,
    hotel?.till,
    hotel?.county,
    hotel?.normalizedCounty,
    getHotelCountyName(hotel),
    getHotelLocation(hotel),
    ...menuNames,
  ], query);
}

export function locationCardMatchesSearch(card, query) {
  const hotelNames = Array.isArray(card?.hotels) ? card.hotels : [];
  const areas = Array.isArray(card?.areas) ? card.areas : [];
  const hotelPlaces = Array.isArray(card?.hotelPlaces) ? card.hotelPlaces : [];

  return matchesSearchText([
    card?.name,
    ...hotelNames,
    ...areas,
    ...hotelPlaces.flatMap((place) => [place?.name, place?.area, place?.county]),
  ], query);
}

export function getVisibleRestaurants(location = state.selectedLocation) {
  const normalizedLocation = location ? normalizeHotelLocation(location) : null;
  return state.hotels
    .filter((hotel) => isHotelOpenForCustomers(hotel))
    .filter((hotel) => !normalizedLocation || getHotelLocationCardName(hotel) === normalizedLocation)
    .filter((hotel) => hotelMatchesSearch(hotel, state.restaurantSearchQuery))
    .map((hotel) => {
      const restaurant = getRestaurantByHotelId(hotel.id);
      return {
        hotelId: hotel.id,
        id: restaurant?.id || hotel.id,
        menu: restaurant?.menu || [],
      };
    })
    .sort((left, right) => getHotelById(left.hotelId).name.localeCompare(getHotelById(right.hotelId).name));
}

export function getLocationCards() {
  const cards = new Map();

  state.hotels
    .filter((hotel) => isHotelOpenForCustomers(hotel))
    .forEach((hotel) => {
      const location = getHotelLocationCardName(hotel);
      const area = getHotelLocation(hotel);
      const restaurant = getRestaurantByHotelId(hotel.id);

      if (!cards.has(location)) {
        cards.set(location, {
          areas: [],
          hotelCount: 0,
          hotelPlaces: [],
          hotels: [],
          menuCount: 0,
          name: location,
        });
      }

      const card = cards.get(location);
      card.hotelCount += 1;
      card.menuCount += restaurant?.menu.length || 0;
      card.hotels.push(hotel.name);
      card.hotelPlaces.push({
        area,
        county: getHotelCountyName(hotel),
        name: hotel.name,
      });
      if (!card.areas.includes(area)) {
        card.areas.push(area);
      }
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
}

function buildAdminFallbackNotifications() {
  const orderNotifications = state.orders
    .filter((order) => !order.notificationAdminDispatchedAt)
    .map((order) => {
    const hotelName = getHotelById(order.hotelId).name;
    const customerName = String(order.customerName || "A customer").trim() || "A customer";
    return {
      fallback: true,
      id: `fallback-admin-order-${order.id}`,
      message: `${customerName} placed an order for ${hotelName}.`,
      read: true,
      refId: order.id,
      timestamp: normalizeNotificationTimestamp(order.createdAt),
      to: "admin",
      type: "order",
    };
    });

  const shopOrderNotifications = state.ummaShopOrders
    .filter((order) => !order.notificationAdminDispatchedAt)
    .map((order) => {
    const customerName = String(order.customerName || "A customer").trim() || "A customer";
    const shopName = String(order.shopName || "Around Umma University").trim() || "Around Umma University";
    return {
      fallback: true,
      id: `fallback-admin-shop-${order.id}`,
      message: `${customerName} submitted a Shop Here order for ${shopName}.`,
      read: true,
      refId: order.id,
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
      refId: feedback.id,
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
    .filter((order) => {
      const normalizedStatus = String(order.status || "Pending").trim().toLowerCase();
      return normalizedStatus === "paid"
        ? !order.notificationHotelPaidDispatchedAt
        : !order.notificationHotelDispatchedAt;
    })
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
        refId: order.id,
        timestamp: normalizeNotificationTimestamp(order.createdAt),
        to: hotelId,
        type: isPaid ? "order-paid" : "order",
      };
    });
}

function buildCustomerFallbackNotifications(customerId) {
  return state.orders
    .filter((order) => String(order.customerId || "").trim() === customerId)
    .filter((order) => {
      const normalizedStatus = String(order.status || "Pending").trim().toLowerCase();
      return normalizedStatus === "paid" ? !order.notificationCustomerPaidDispatchedAt : true;
    })
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
        refId: order.id,
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

  const directNotifications = dedupeNotifications(
    state.notifications.filter((item) => String(item.to || "").trim() === normalizedTarget),
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
  const hotel = getHotelById(hotelId);
  const matches = state.restaurants
    .filter((restaurant) => restaurantMatchesHotel(restaurant, hotel))
    .map((restaurant) => ({
      ...restaurant,
      menu: getRestaurantMenuItems(restaurant),
    }));

  matches.sort((left, right) => {
    const leftHasMenu = left.menu.length ? 1 : 0;
    const rightHasMenu = right.menu.length ? 1 : 0;
    if (rightHasMenu !== leftHasMenu) {
      return rightHasMenu - leftHasMenu;
    }

    const leftExactId = left.id === hotel.id || left.hotelId === hotel.id ? 1 : 0;
    const rightExactId = right.id === hotel.id || right.hotelId === hotel.id ? 1 : 0;
    return rightExactId - leftExactId;
  });

  if (matches[0]) {
    return matches[0];
  }

  const hotelMenu = getRestaurantMenuItems(hotel);
  return hotelMenu.length
    ? {
        id: hotel.id,
        hotelId: hotel.id,
        menu: hotelMenu,
      }
    : undefined;
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
