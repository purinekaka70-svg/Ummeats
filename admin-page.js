import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { ADMIN_CRED } from "./config.js";
import { db } from "./firebase.js";
import { inferToastTone } from "./helpers.js";
import { elements, getRestaurantByHotelId, state } from "./state.js";
import { showToast } from "./ui.js";
import { renderAdmin } from "./view-admin.js";

bootstrap();

function bootstrap() {
  state.currentAdmin = false;
  state.adminPanelSection = "dashboard";
  state.adminSidebarOpen = false;
  bindEvents();
  hydrateShell();
  subscribeToCollections();
  renderAdmin();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
}

function hydrateShell() {
  const year = document.getElementById("year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  window.alert = (message) => {
    showToast(String(message ?? ""), inferToastTone(String(message ?? "")));
  };
}

function subscribeToCollections() {
  onSnapshot(collection(db, "hotels"), (snapshot) => {
    state.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "restaurants"), (snapshot) => {
    state.restaurants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "orders"), (snapshot) => {
    state.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "notifications"), (snapshot) => {
    state.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });
}

async function handleClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.id === "adminMenuToggle") {
    state.adminSidebarOpen = !state.adminSidebarOpen;
    renderAdmin();
    return;
  }

  if (button.id === "adminSidebarClose" || button.id === "adminSidebarBackdrop") {
    state.adminSidebarOpen = false;
    renderAdmin();
    return;
  }

  if (button.classList.contains("adminNavBtn")) {
    state.adminPanelSection = button.dataset.section || "dashboard";
    state.adminSidebarOpen = false;
    renderAdmin();
    return;
  }

  if (button.classList.contains("toggleBlock")) {
    await toggleHotelBlock(button.dataset.id);
    return;
  }

  if (button.classList.contains("approveHotel")) {
    await approveHotel(button.dataset.id);
    return;
  }

  if (button.classList.contains("activateSub")) {
    await activateSubscription(button.dataset.id);
    return;
  }

  if (button.classList.contains("expireSub")) {
    await expireSubscription(button.dataset.id);
    return;
  }

  if (button.id === "clearAll") {
    await clearAllData();
    return;
  }

  if (button.classList.contains("markPaid")) {
    await markOrderPaid(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteOrder")) {
    await deleteOrder(button.dataset.id);
    return;
  }

  if (button.id === "logoutAdmin") {
    state.currentAdmin = false;
    state.adminPanelSection = "dashboard";
    state.adminSidebarOpen = false;
    renderAdmin();
    return;
  }

  if (button.classList.contains("markNotifRead")) {
    await updateDoc(doc(db, "notifications", button.dataset.id), { read: true });
    return;
  }

  if (button.dataset.togglePanel) {
    const panel = document.getElementById(button.dataset.togglePanel);
    if (panel) {
      panel.classList.toggle("is-hidden");
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id !== "adminLogin") {
    return;
  }

  const user = form.elements.adminUser.value.trim();
  const pass = form.elements.adminPass.value.trim();

  if (user === ADMIN_CRED.user && pass === ADMIN_CRED.pass) {
    state.currentAdmin = true;
    state.adminPanelSection = "dashboard";
    state.adminSidebarOpen = false;
    showToast("Admin login successful.", "success");
    renderAdmin();
    return;
  }

  alert("Wrong admin credentials.");
}

async function toggleHotelBlock(hotelId) {
  const hotel = state.hotels.find((item) => item.id === hotelId);
  if (!hotel) {
    return;
  }

  await updateDoc(doc(db, "hotels", hotelId), { blocked: !hotel.blocked });
  showToast(hotel.blocked ? "Hotel unblocked." : "Hotel blocked.", "success");
}

async function approveHotel(hotelId) {
  await updateDoc(doc(db, "hotels", hotelId), { approved: true });

  const restaurant = getRestaurantByHotelId(hotelId);
  if (!restaurant) {
    await setDoc(doc(db, "restaurants", hotelId), { hotelId, menu: [] });
  }

  showToast("Hotel approved.", "success");
}

async function activateSubscription(hotelId) {
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

  try {
    await updateDoc(doc(db, "hotels", hotelId), { subscriptionExpiry: expiry });
    showToast("Subscription activated for 30 days.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to activate subscription.", "error");
  }
}

async function expireSubscription(hotelId) {
  try {
    await updateDoc(doc(db, "hotels", hotelId), { subscriptionExpiry: Date.now() - 1000 });
    showToast("Subscription expired.", "warn");
  } catch (error) {
    console.error(error);
    showToast("Failed to expire subscription.", "error");
  }
}

async function markOrderPaid(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Paid" });
    showToast("Order marked as paid.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to mark order as paid.", "error");
  }
}

async function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
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

async function clearAllData() {
  if (!window.confirm("Delete all hotels, restaurants, orders, and notifications?")) {
    return;
  }

  const collections = ["hotels", "restaurants", "orders", "notifications"];
  for (const collectionName of collections) {
    const snapshot = await getDocs(collection(db, collectionName));
    for (const item of snapshot.docs) {
      await deleteDoc(doc(db, collectionName, item.id));
    }
  }

  showToast("All platform data cleared.", "success");
}
