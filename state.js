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
  cartByHotel: {},
  checkoutDrafts: {},
  activeHotelMenuId: null,
  locationDirectoryOpen: false,
  restaurantDirectoryOpen: false,
  currentTab: "restaurants",
  currentInfoSection: null,
  selectedLocation: null,
  currentHotelId: null,
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

export function getNotificationsForTarget(target) {
  return state.notifications.filter((item) => item.to === target);
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
