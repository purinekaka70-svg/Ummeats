import { loadSavedCustomerProfile, loadSavedOrderProfile, getCustomerId } from "./storage.js";

export const CUSTOMER_ID = getCustomerId();

export const state = {
  hotels: [],
  restaurants: [],
  orders: [],
  feedbacks: [],
  notifications: [],
  cartByHotel: {},
  checkoutDrafts: {},
  activeHotelMenuId: null,
  restaurantDirectoryOpen: false,
  currentTab: "restaurants",
  currentInfoSection: null,
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

export function getVisibleRestaurants() {
  return state.restaurants
    .filter((restaurant) => isHotelOpenForCustomers(restaurant.hotelId))
    .sort((left, right) => getHotelById(left.hotelId).name.localeCompare(getHotelById(right.hotelId).name));
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
    mpesaName: draft.mpesaName ?? saved.mpesaName ?? "",
    mpesaNumber: draft.mpesaNumber ?? saved.mpesaNumber ?? "",
  };
}
