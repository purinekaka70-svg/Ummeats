import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  ref as rtdbRef,
  remove as removeRtdb,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { auth, db, rtdb } from "./firebase.js";
import { inferToastTone } from "./helpers.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";
import { notifyPaidOrderStatus, notifyShopOrderStatus } from "./order-status-notifications.js";
import { elements, getRestaurantByHotelId, state } from "./state.js";
import { showToast } from "./ui.js";
import { renderAdmin } from "./view-admin.js";

const adminNotificationAlertTracker = new Set();
const adminNotificationPromptButton = document.getElementById("adminNotificationPromptButton");
let adminCollectionUnsubscribers = [];

bootstrap();

function bootstrap() {
  state.currentAdmin = false;
  state.adminPanelSection = "dashboard";
  state.adminSidebarOpen = false;
  bindEvents();
  bindPushSyncEvents();
  hydrateShell();
  subscribeToAuth();
  renderAdmin();
}

function stopAdminCollectionSubscriptions() {
  adminCollectionUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      // ignore
    }
  });
  adminCollectionUnsubscribers = [];

  state.hotels = [];
  state.restaurants = [];
  state.orders = [];
  state.ummaShopOrders = [];
  state.feedbacks = [];
  state.notifications = [];
  state.employees = [];
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);

  if (adminNotificationPromptButton) {
    adminNotificationPromptButton.addEventListener("click", handleAdminNotificationPromptClick);
  }
}

function bindPushSyncEvents() {
  window.addEventListener("focus", () => {
    syncAdminPushSubscription();
    updateAdminNotificationPromptButtonState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncAdminPushSubscription();
      updateAdminNotificationPromptButtonState();
    }
  });
}

function syncAdminPushSubscription() {
  const user = auth.currentUser;
  if (!user || !state.currentAdmin) {
    return;
  }

  void registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: false,
    role: "admin",
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

  updateAdminNotificationPromptButtonState();
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

function updateAdminNotificationPromptButtonState() {
  if (!adminNotificationPromptButton) {
    return;
  }

  const permission = getNotificationPermissionState();

  if (!state.currentAdmin || permission === "unsupported" || permission === "granted") {
    adminNotificationPromptButton.classList.add("is-hidden");
    adminNotificationPromptButton.disabled = false;
    return;
  }

  adminNotificationPromptButton.classList.remove("is-hidden");
  adminNotificationPromptButton.disabled = false;

  if (permission === "denied") {
    adminNotificationPromptButton.textContent = "Notifications Blocked";
    adminNotificationPromptButton.setAttribute("aria-label", "Notifications are blocked in this browser");
    setNotificationButtonVariant(adminNotificationPromptButton, "button-danger-soft");
    return;
  }

  adminNotificationPromptButton.textContent = "Enable Notifications";
  adminNotificationPromptButton.setAttribute("aria-label", "Enable browser notifications for admin");
  setNotificationButtonVariant(adminNotificationPromptButton, "button-primary");
}

async function handleAdminNotificationPromptClick() {
  const permission = getNotificationPermissionState();
  if (permission === "unsupported") {
    showToast("This browser cannot enable web push notifications here.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  if (permission === "denied") {
    showToast("Notifications are blocked. Allow them in browser site settings, then refresh.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  const user = auth.currentUser;
  if (!state.currentAdmin || !user) {
    showToast("Login as admin first to enable notifications.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  await registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: true,
    role: "admin",
    silent: false,
  });
  updateAdminNotificationPromptButtonState();
}

function startAdminCollectionSubscriptions() {
  if (adminCollectionUnsubscribers.length) {
    return;
  }

  adminCollectionUnsubscribers = [
    onSnapshot(collection(db, "hotels"), (snapshot) => {
      state.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "restaurants"), (snapshot) => {
      state.restaurants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "orders"), (snapshot) => {
      state.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
      state.ummaShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "feedbacks"), (snapshot) => {
      state.feedbacks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "notifications"), (snapshot) => {
      handleAdminNotificationAlerts(snapshot);
      state.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "employees"), (snapshot) => {
      state.employees = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
  ];
}

function subscribeToAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.currentAdmin = false;
      state.adminPanelSection = "dashboard";
      state.adminSidebarOpen = false;
      stopAdminCollectionSubscriptions();
      renderAdmin();
      updateAdminNotificationPromptButtonState();
      return;
    }

    const allowed = await isAllowedAdmin(user.uid);
    state.currentAdmin = allowed;

    if (allowed) {
      startAdminCollectionSubscriptions();
      void registerPushSubscription("admin", user.email || "Admin", {
        requestPermission: false,
        role: "admin",
        silent: true,
      });
      renderAdmin();
      updateAdminNotificationPromptButtonState();
      return;
    }

    stopAdminCollectionSubscriptions();
    state.currentAdmin = false;
    state.adminPanelSection = "dashboard";
    state.adminSidebarOpen = false;
    // Do not force signOut to allow employee sessions to persist in other tabs
    renderAdmin();
    updateAdminNotificationPromptButtonState();
  });
}

function resolveAdminNotificationTitle(item) {
  const normalizedType = String(item?.type || "").trim().toLowerCase();
  if (normalizedType === "order-paid" || normalizedType === "order_paid") {
    return "Order update";
  }

  if (normalizedType === "order") {
    return "New order received";
  }

  if (normalizedType === "hotel") {
    return "New hotel registration";
  }

  if (normalizedType === "employee") {
    return "New employee registration";
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

  if (normalizedType === "feedback") {
    return "New feedback";
  }

  return "New notification";
}

function handleAdminNotificationAlerts(snapshot) {
  if (!auth.currentUser || !state.currentAdmin) {
    return;
  }

  snapshot.docs.forEach((docSnapshot) => {
    const item = docSnapshot.data() || {};
    if (String(item.to || "").trim() !== "admin" || item.read) {
      return;
    }

    if (adminNotificationAlertTracker.has(docSnapshot.id)) {
      return;
    }

    adminNotificationAlertTracker.add(docSnapshot.id);

    const title = resolveAdminNotificationTitle(item);
    const body = String(item.message || "You have a new update.");
    const refId = String(item.refId || "").trim();
    const type = String(item.type || "notification").trim().toLowerCase();
    const tag = refId ? `notif-${type}-${refId}` : `admin-notif-${docSnapshot.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./admin.html",
      tag,
    });
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

  if (button.classList.contains("deleteEmployee")) {
    await deleteEmployee(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteNotification")) {
    await deleteNotification(button.dataset.id);
    return;
  }

  if (button.id === "logoutAdmin") {
    await unregisterPushSubscription("admin");
    await signOut(auth);
    showToast("Admin logged out.", "info");
    updateAdminNotificationPromptButtonState();
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
    if (!(await isAllowedAdmin(credentials.user.uid))) {
      await signOut(auth).catch(() => undefined);
      alert("This account is registered as employee access, not admin.");
      return;
    }

    const pushEnabled = await registerPushSubscription("admin", credentials.user.email || user, {
      requestPermission: true,
      role: "admin",
      silent: false,
    });
    form.reset();
    showToast(
      pushEnabled
        ? "Admin login successful. Browser notifications enabled."
        : "Admin login successful. Tap Enable Notifications to allow browser alerts.",
      pushEnabled ? "success" : "warn",
    );
    updateAdminNotificationPromptButtonState();
  } catch (error) {
    console.error(error);
    alert("Wrong admin email or password.");
  }
}

async function isAllowedAdmin(uid) {
  if (!uid) {
    return false;
  }

  try {
    const employeeProfile = await getDoc(doc(db, "employees", uid));
    return !employeeProfile.exists();
  } catch (error) {
    console.warn("Admin access check failed", error);
    return false;
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
    const hotelName = state.hotels.find((item) => item.id === order.hotelId)?.name || "selected hotel";
    await notifyPaidOrderStatus(order, hotelName);
    showToast("Order marked as paid.", "success");
  } catch (error) {
    console.warn("Paid order notification failed", error);
    showToast("Order marked as paid, but notification delivery failed.", "warn");
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

  if (order.paid) {
    showToast("Shop Here order is already marked as paid.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { paid: true });
  } catch (error) {
    console.error(error);
    showToast("Failed to mark Shop Here order as paid.", "error");
    return;
  }

  try {
    await notifyShopOrderStatus({ ...order, paid: true }, "paid");
    showToast("Shop Here order marked as paid.", "success");
  } catch (error) {
    console.warn("Shop Here paid notification failed", error);
    showToast("Shop Here order marked as paid, but notification delivery failed.", "warn");
  }
}

async function markShopOrderDelivered(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  if (order.delivered) {
    showToast("Shop Here order is already marked as delivered.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { delivered: true });
  } catch (error) {
    console.error(error);
    showToast("Failed to update Shop Here order.", "error");
    return;
  }

  try {
    await notifyShopOrderStatus({ ...order, delivered: true }, "delivered");
    showToast("Shop Here order marked as delivered.", "success");
  } catch (error) {
    console.warn("Shop Here delivered notification failed", error);
    showToast("Shop Here order marked as delivered, but notification delivery failed.", "warn");
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

async function deleteEmployee(employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) {
    alert("Employee not found.");
    return;
  }

  if (!window.confirm("Delete this employee profile permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "employees", employeeId));
    await removeRtdb(rtdbRef(rtdb, `employeeIdCards/${employeeId}`)).catch(() => undefined);
    showToast("Employee profile deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete employee.", "error");
  }
}

async function deleteNotification(notificationId) {
  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification) {
    alert("Notification not found.");
    return;
  }

  if (!window.confirm("Delete this notification permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "notifications", notificationId));
    adminNotificationAlertTracker.delete(notificationId);
    showToast("Notification deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete notification.", "error");
  }
}

async function clearAllData() {
  if (!window.confirm("Delete all hotels, restaurants, orders, feedbacks, and notifications?")) {
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
  ];
  for (const collectionName of collections) {
    const snapshot = await getDocs(collection(db, collectionName));
    for (const item of snapshot.docs) {
      await deleteDoc(doc(db, collectionName, item.id));
    }
  }

  showToast("All platform data cleared.", "success");
}
