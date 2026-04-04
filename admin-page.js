import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { auth, db } from "./firebase.js";
import { inferToastTone } from "./helpers.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";
import { elements, getRestaurantByHotelId, state } from "./state.js";
import { showToast } from "./ui.js";
import { renderAdmin } from "./view-admin.js";

const adminOrderAlertTracker = {
  ids: new Set(),
  ready: false,
};

bootstrap();

function bootstrap() {
  state.currentAdmin = false;
  state.adminPanelSection = "dashboard";
  state.adminSidebarOpen = false;
  bindEvents();
  bindPushSyncEvents();
  hydrateShell();
  subscribeToAuth();
  subscribeToCollections();
  renderAdmin();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
}

function bindPushSyncEvents() {
  window.addEventListener("focus", syncAdminPushSubscription);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncAdminPushSubscription();
    }
  });
}

function syncAdminPushSubscription() {
  const user = auth.currentUser;
  if (!user || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }

  void registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: false,
    silent: true,
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
    handleAdminOrderAlerts(snapshot);
    state.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
    state.ummaShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "feedbacks"), (snapshot) => {
    state.feedbacks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });

  onSnapshot(collection(db, "notifications"), (snapshot) => {
    state.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAdmin();
  });
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

function handleAdminOrderAlerts(snapshot) {
  const user = auth.currentUser;
  const newOrders = collectNewSnapshotDocs(snapshot, adminOrderAlertTracker);
  if (!user || !newOrders.length) {
    return;
  }

  newOrders.forEach((order) => {
    const tag = `order-${order.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    const hotelName = state.hotels.find((item) => item.id === order.hotelId)?.name || "selected hotel";
    const title = "New order received";
    const body = `${order.customerName || "A customer"} placed an order for ${hotelName}.`;
    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./admin.html",
      tag,
    });
  });
}

function subscribeToAuth() {
  onAuthStateChanged(auth, (user) => {
    state.currentAdmin = Boolean(user);

    if (user && typeof Notification !== "undefined" && Notification.permission === "granted") {
      void registerPushSubscription("admin", user.email || "Admin", {
        requestPermission: false,
        silent: true,
      });
    }

    if (!user) {
      state.adminPanelSection = "dashboard";
      state.adminSidebarOpen = false;
    }

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

  if (button.classList.contains("markShopOrderPaid")) {
    await markShopOrderPaid(button.dataset.id);
    return;
  }

  if (button.classList.contains("markShopOrderDelivered")) {
    await markShopOrderDelivered(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteOrder")) {
    await deleteOrder(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteShopOrder")) {
    await deleteShopOrder(button.dataset.id);
    return;
  }

  if (button.classList.contains("resolveFeedback")) {
    await resolveFeedback(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteFeedback")) {
    await deleteFeedback(button.dataset.id);
    return;
  }

  if (button.id === "logoutAdmin") {
    await unregisterPushSubscription("admin");
    await signOut(auth);
    showToast("Admin logged out.", "info");
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

  const user = form.elements.adminEmail.value.trim();
  const pass = form.elements.adminPass.value.trim();

  if (!user || !pass) {
    alert("Enter admin email and password.");
    return;
  }

  try {
    const credentials = await signInWithEmailAndPassword(auth, user, pass);
    await registerPushSubscription("admin", credentials.user.email || user, {
      requestPermission: true,
      silent: false,
    });
    form.reset();
    showToast("Admin login successful.", "success");
  } catch (error) {
    console.error(error);
    alert("Wrong admin email or password.");
  }
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

async function markShopOrderPaid(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { paid: true });
    showToast("Shop Here order marked as paid.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to mark Shop Here order as paid.", "error");
  }
}

async function markShopOrderDelivered(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { delivered: true });
    showToast("Shop Here order marked as delivered.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to update Shop Here order.", "error");
  }
}

async function deleteShopOrder(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  if (!window.confirm("Delete this Shop Here order permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "ummaShopOrders", orderId));
    showToast("Shop Here order deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete Shop Here order.", "error");
  }
}

async function resolveFeedback(feedbackId) {
  const feedback = state.feedbacks.find((item) => item.id === feedbackId);
  if (!feedback) {
    alert("Feedback not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "feedbacks", feedbackId), { status: "Reviewed" });
    showToast("Feedback marked as reviewed.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to update feedback.", "error");
  }
}

async function deleteFeedback(feedbackId) {
  const feedback = state.feedbacks.find((item) => item.id === feedbackId);
  if (!feedback) {
    alert("Feedback not found.");
    return;
  }

  if (!window.confirm("Delete this feedback permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "feedbacks", feedbackId));
    showToast("Feedback deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete feedback.", "error");
  }
}

async function clearAllData() {
  if (!window.confirm("Delete all hotels, restaurants, orders, feedbacks, notifications, and push subscriptions?")) {
    return;
  }

  const collections = [
    "hotels",
    "restaurants",
    "orders",
    "ummaShopOrders",
    "feedbacks",
    "ummaShopFeedbacks",
    "notifications",
    "pushSubscriptions",
  ];
  for (const collectionName of collections) {
    const snapshot = await getDocs(collection(db, collectionName));
    for (const item of snapshot.docs) {
      await deleteDoc(doc(db, collectionName, item.id));
    }
  }

  showToast("All platform data cleared.", "success");
}
