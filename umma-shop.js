import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { SERVICE_FEE_TILL } from "./config.js";
import { auth, db } from "./firebase.js";
import { escapeHtml } from "./helpers.js";
import { dispatchOrderNotification } from "./notification-api.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";

const ACTIVE_CLASS = "is-active";
const HIDDEN_CLASS = "is-hidden";
const LOCATION_NAME = "Around Umma University";
const CUSTOMER_EMAIL_STORAGE_KEY = "UMMA_SHOP_CUSTOMER_EMAIL";

const ordersCollection = collection(db, "ummaShopOrders");
const feedbackCollection = collection(db, "ummaShopFeedbacks");

const elements = {
  addItemBtn: document.getElementById("addItemBtn"),
  adminEmailInput: document.getElementById("adminEmailInput"),
  adminFeedbackList: document.getElementById("adminFeedbackList"),
  adminLoginBtn: document.getElementById("adminLoginBtn"),
  adminLoginForm: document.getElementById("shopAdminLoginForm"),
  adminLoginSection: document.getElementById("adminLoginSection"),
  adminLoginStatus: document.getElementById("adminLoginStatus"),
  adminOrdersList: document.getElementById("adminOrdersList"),
  adminPanel: document.getElementById("adminPanel"),
  adminPasswordInput: document.getElementById("adminPasswordInput"),
  backBtn: document.getElementById("backBtn"),
  customerEmail: document.getElementById("customerEmail"),
  customerName: document.getElementById("customerName"),
  customerOrders: document.getElementById("customerOrders"),
  customerSection: document.getElementById("customerSection"),
  fbEmail: document.getElementById("fbEmail"),
  fbMessage: document.getElementById("fbMessage"),
  fbName: document.getElementById("fbName"),
  fbStatus: document.getElementById("fbStatus"),
  feedbackBtn: document.getElementById("feedbackBtn"),
  feedbackSection: document.getElementById("feedbackSection"),
  footerTrigger: document.getElementById("footerTrigger"),
  itemsList: document.getElementById("itemsList"),
  itemsTextarea: document.getElementById("itemsTextarea"),
  logoutAdminBtn: document.getElementById("logoutAdminBtn"),
  mpesaCode: document.getElementById("mpesaCode"),
  orderSection: document.getElementById("orderSection"),
  orderStatus: document.getElementById("orderStatus"),
  ordersBtn: document.getElementById("ordersBtn"),
  paymentGuideBtn: document.getElementById("paymentGuideBtn"),
  paymentGuideSection: document.getElementById("paymentGuideSection"),
  shopName: document.getElementById("shopName"),
  submitFeedbackBtn: document.getElementById("submitFeedbackBtn"),
  submitOrderBtn: document.getElementById("submitOrderBtn"),
  serviceFeeTillTargets: document.querySelectorAll("[data-service-fee-till]"),
  totalAmount: document.getElementById("totalAmount"),
};

let footerClickCount = 0;
let orderItems = [];
let unsubscribeCustomerOrders = null;
let unsubscribeAdminOrders = null;
let unsubscribeAdminFeedbacks = null;
const adminShopOrderAlertTracker = {
  ids: new Set(),
  ready: false,
};

function readShopStorage(key) {
  try {
    return String(localStorage.getItem(key) || "");
  } catch {
    return "";
  }
}

function writeShopStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn("Shop storage write failed", error);
    return false;
  }
}

function getOrderSubmitErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) {
    return "Failed to submit order.";
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("missing required shop here order fields")) {
    return "Some required order details are missing. Fill all fields and try again.";
  }

  if (normalized.includes("missing required environment variable: firebase_service_account_json")) {
    return "Server order API is not configured. Contact support.";
  }

  if (normalized.includes("insufficient permissions") || normalized.includes("permission")) {
    return "Order save is blocked by Firestore permissions. Contact admin.";
  }

  if (normalized.includes("networkerror") || normalized.includes("failed to fetch")) {
    return "Network problem while submitting order. Check connection and retry.";
  }

  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

bootstrap();

function bootstrap() {
  bindEvents();
  bindPushSyncEvents();
  hydrateStaticCopy();
  renderItems();
  hydrateCustomerOrders();
  subscribeToAdminAuth();
  setViewMode("orders");
  window.setUmmaShopView = setViewMode;
}

function hydrateStaticCopy() {
  elements.serviceFeeTillTargets.forEach((element) => {
    element.textContent = SERVICE_FEE_TILL;
  });
}

function bindEvents() {
  document.addEventListener("click", handleTopViewClick);

  elements.backBtn?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });

  elements.addItemBtn?.addEventListener("click", addItemsFromTextarea);
  elements.submitOrderBtn?.addEventListener("click", submitOrder);
  elements.submitFeedbackBtn?.addEventListener("click", submitFeedback);
  elements.adminLoginForm?.addEventListener("submit", handleAdminLoginSubmit);
  elements.logoutAdminBtn?.addEventListener("click", logoutAdmin);

  elements.customerEmail?.addEventListener("change", () => {
    const email = elements.customerEmail.value.trim();
    if (!email) {
      return;
    }

    writeShopStorage(CUSTOMER_EMAIL_STORAGE_KEY, email);
    listenForCustomerOrders(email);
  });

  elements.footerTrigger?.addEventListener("click", () => {
    footerClickCount += 1;
    if (footerClickCount < 4) {
      return;
    }

    footerClickCount = 0;
    showAdminLogin();
  });
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
  if (!user) {
    return;
  }

  void registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: false,
    role: "admin",
    silent: true,
  });
}

function handleTopViewClick(event) {
  const button = event.target.closest("[data-shop-view]");
  if (!button) {
    return;
  }

  const view = button.dataset.shopView;
  if (!view) {
    return;
  }

  setViewMode(view);
}

function hydrateCustomerOrders() {
  const savedEmail = readShopStorage(CUSTOMER_EMAIL_STORAGE_KEY);
  if (!savedEmail) {
    renderCustomerOrders([]);
    return;
  }

  elements.customerEmail.value = savedEmail;
  listenForCustomerOrders(savedEmail);
}

function subscribeToAdminAuth() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      void registerPushSubscription("admin", user.email || "Admin", {
        requestPermission: false,
        role: "admin",
        silent: true,
      });

      showAdminPanel();
      listenForAdminOrders();
      listenForAdminFeedbacks();
      return;
    }

    if (unsubscribeAdminOrders) {
      unsubscribeAdminOrders();
      unsubscribeAdminOrders = null;
    }

    if (unsubscribeAdminFeedbacks) {
      unsubscribeAdminFeedbacks();
      unsubscribeAdminFeedbacks = null;
    }

    hideElement(elements.adminPanel);
  });
}

function setTopAction(target) {
  [elements.ordersBtn, elements.paymentGuideBtn, elements.feedbackBtn].forEach((button) => {
    button.classList.toggle(ACTIVE_CLASS, button === target);
  });
}

function showElement(element) {
  if (!element) {
    return;
  }

  element.classList.remove(HIDDEN_CLASS);
}

function hideElement(element) {
  if (!element) {
    return;
  }

  element.classList.add(HIDDEN_CLASS);
}

function setViewMode(view) {
  if (view === "payment") {
    setTopAction(elements.paymentGuideBtn);
    showElement(elements.paymentGuideSection);
    hideElement(elements.feedbackSection);
    hideElement(elements.orderSection);
    hideElement(elements.customerSection);
    hideElement(elements.adminLoginSection);
    hideElement(elements.adminPanel);
    return;
  }

  if (view === "feedback") {
    setTopAction(elements.feedbackBtn);
    hideElement(elements.paymentGuideSection);
    showElement(elements.feedbackSection);
    hideElement(elements.orderSection);
    hideElement(elements.customerSection);
    hideElement(elements.adminLoginSection);
    hideElement(elements.adminPanel);
    return;
  }

  setTopAction(elements.ordersBtn);
  hideElement(elements.paymentGuideSection);
  hideElement(elements.feedbackSection);
  showElement(elements.orderSection);
  showElement(elements.customerSection);
  hideElement(elements.adminLoginSection);
  hideElement(elements.adminPanel);
}

function showAdminLogin() {
  if (auth.currentUser) {
    showAdminPanel();
    return;
  }

  setTopAction(null);
  hideElement(elements.paymentGuideSection);
  hideElement(elements.feedbackSection);
  hideElement(elements.orderSection);
  hideElement(elements.customerSection);
  hideElement(elements.adminPanel);
  showElement(elements.adminLoginSection);
  setStatusLine(elements.adminLoginStatus, "", "");
}

function showAdminPanel() {
  setTopAction(null);
  hideElement(elements.paymentGuideSection);
  hideElement(elements.feedbackSection);
  hideElement(elements.orderSection);
  hideElement(elements.customerSection);
  hideElement(elements.adminLoginSection);
  showElement(elements.adminPanel);
}

function setStatusLine(element, message, tone) {
  element.textContent = message;
  element.className = "tiny shop-status-line";

  if (!message) {
    return;
  }

  if (tone === "success") {
    element.classList.add("shop-status-line--success");
    return;
  }

  if (tone === "error") {
    element.classList.add("shop-status-line--error");
  }
}

function addItemsFromTextarea() {
  const rawText = elements.itemsTextarea.value.trim();
  if (!rawText) {
    window.alert("Enter at least one item.");
    return;
  }

  const lines = rawText.split("\n");
  if (lines.length > 10) {
    window.alert("Max 10 lines per addition.");
    return;
  }

  let added = false;
  lines.forEach((line) => {
    const text = line.trim();
    if (!text) {
      return;
    }

    orderItems.push({ name: text, qty: 1 });
    added = true;
  });

  if (!added) {
    window.alert("No valid items.");
    return;
  }

  elements.itemsTextarea.value = "";
  renderItems();
}

function renderItems() {
  if (!orderItems.length) {
    elements.itemsList.innerHTML = `
      <li class="order-item shop-item-row shop-item-row--empty">
        <div>
          <p class="card-title">No items added yet</p>
          <p class="tiny">Added items will appear here before you submit the order.</p>
        </div>
      </li>
    `;
    return;
  }

  elements.itemsList.innerHTML = "";

  orderItems.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "order-item shop-item-row";
    li.innerHTML = `
      <div class="split-row">
        <div>
          <p class="card-title">${escapeHtml(item.name)}</p>
          <p class="tiny">Quantity ${escapeHtml(String(item.qty || 1))}</p>
        </div>
        <button class="button button-danger-soft button-small" type="button">Remove</button>
      </div>
    `;

    li.querySelector("button").addEventListener("click", () => {
      orderItems.splice(index, 1);
      renderItems();
    });

    elements.itemsList.appendChild(li);
  });
}

async function createShopOrder(orderPayload) {
  let apiError = null;

  try {
    const response = await fetch("/api/submit-umma-shop-order", {
      body: JSON.stringify(orderPayload),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false || !result?.id) {
      throw new Error(result?.error || `Shop Here order submit failed with ${response.status}.`);
    }

    return {
      id: result.id,
      mode: "api",
    };
  } catch (error) {
    apiError = error;
    console.warn("Shop Here API submit failed, trying direct Firestore write", error);
  }

  try {
    const orderRef = await addDoc(ordersCollection, orderPayload);
    return {
      id: orderRef.id,
      mode: "firestore",
    };
  } catch (firestoreError) {
    const apiMessage = String(apiError?.message || "").trim();
    const firestoreMessage = String(firestoreError?.message || "").trim();
    const details = [
      apiMessage ? `API: ${apiMessage}` : "",
      firestoreMessage ? `Firestore: ${firestoreMessage}` : "",
    ].filter(Boolean).join(" | ");

    throw new Error(details ? `Order submission failed. ${details}` : "Order submission failed.");
  }
}

async function submitFeedback() {
  const name = elements.fbName.value.trim();
  const email = elements.fbEmail.value.trim();
  const message = elements.fbMessage.value.trim();

  if (!name || !email || !message) {
    window.alert("Fill all feedback fields.");
    return;
  }

  try {
    await addDoc(feedbackCollection, {
      createdAt: Date.now(),
      email,
      location: LOCATION_NAME,
      message,
      name,
      reviewed: false,
    });

    setStatusLine(elements.fbStatus, "Feedback submitted successfully.", "success");
    elements.fbName.value = "";
    elements.fbEmail.value = "";
    elements.fbMessage.value = "";
  } catch (error) {
    console.error(error);
    setStatusLine(elements.fbStatus, "Failed to submit feedback.", "error");
  }
}

async function submitOrder() {
  const customerName = elements.customerName.value.trim();
  const customerEmail = elements.customerEmail.value.trim();
  const shopName = elements.shopName.value.trim();
  const totalAmount = Number.parseFloat(elements.totalAmount.value.trim().replaceAll(",", ""));
  const mpesaCode = elements.mpesaCode.value.trim();

  if (!customerName || !customerEmail || !shopName || !mpesaCode || !orderItems.length) {
    window.alert("Fill all fields and add items before submitting.");
    return;
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    window.alert("Enter a valid amount paid or to send.");
    return;
  }

  const orderPayload = {
    createdAt: Date.now(),
    customerEmail,
    customerName,
    delivered: false,
    items: orderItems.map((item) => ({ name: item.name, qty: item.qty })),
    location: LOCATION_NAME,
    mpesaCode,
    paymentTargets: [`Till ${SERVICE_FEE_TILL}`],
    paid: false,
    serviceFeeTill: SERVICE_FEE_TILL,
    shopName,
    source: "shop-here",
    totalAmount,
  };

  try {
    const createdOrder = await createShopOrder(orderPayload);
    const notificationSent = await dispatchOrderNotification(createdOrder.id, "umma-shop-order");
    if (!notificationSent) {
      try {
        await addDoc(collection(db, "notifications"), {
          message: `${customerName} submitted a Shop Here order for ${shopName}.`,
          read: false,
          timestamp: Date.now(),
          to: "admin",
          type: "umma-shop-order",
        });
      } catch (error) {
        console.warn("Shop Here fallback notification write failed", error);
      }
    }

    writeShopStorage(CUSTOMER_EMAIL_STORAGE_KEY, customerEmail);
    listenForCustomerOrders(customerEmail);

    setStatusLine(elements.orderStatus, "Order submitted successfully.", "success");
    elements.customerName.value = "";
    elements.customerEmail.value = customerEmail;
    elements.shopName.value = "";
    elements.totalAmount.value = "";
    elements.mpesaCode.value = "";
    orderItems = [];
    renderItems();
    setViewMode("orders");
  } catch (error) {
    console.error(error);
    setStatusLine(elements.orderStatus, getOrderSubmitErrorMessage(error), "error");
  }
}

function listenForCustomerOrders(customerEmail) {
  if (unsubscribeCustomerOrders) {
    unsubscribeCustomerOrders();
  }

  const ordersQuery = query(ordersCollection, where("customerEmail", "==", customerEmail));
  unsubscribeCustomerOrders = onSnapshot(ordersQuery, (snapshot) => {
    const orders = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

    renderCustomerOrders(orders);
  });
}

function renderCustomerOrders(orders) {
  if (!orders.length) {
    elements.customerOrders.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>No customer orders yet</h3>
          <p>Your submitted orders for this shop page will appear here once you use the same email address.</p>
        </div>
      </div>
    `;
    return;
  }

  elements.customerOrders.innerHTML = orders
    .map((order) => {
      const itemsText = (order.items || []).map((item) => `${item.qty || 1} x ${item.name}`).join(", ");
      const paidText = renderStatusPill(order.paid ? "Paid" : "Pending Payment", order.paid ? "paid" : "pending");
      const deliveredText = renderStatusPill(order.delivered ? "Delivered" : "Preparing", order.delivered ? "active" : "inactive");

      return `
        <article class="order-item order-card">
          <div class="order-header">
            <div>
              <p class="eyebrow">Shop Here order</p>
              <h3>${escapeHtml(order.customerName || "N/A")}</h3>
              <p class="muted">${escapeHtml(order.shopName || "N/A")}</p>
            </div>
            <p class="tiny">${escapeHtml(formatTime(order.createdAt))}</p>
          </div>

          <div class="meta-pills">
            ${paidText}
            ${deliveredText}
          </div>

          <div class="order-meta-grid">
            <div class="meta-block">
              <span>Items</span>
              <strong>${escapeHtml(itemsText || "N/A")}</strong>
            </div>
            <div class="meta-block">
              <span>Amount paid</span>
              <strong>KES ${escapeHtml(String(order.totalAmount || "0"))}</strong>
            </div>
            <div class="meta-block">
              <span>Payment code</span>
              <strong>${escapeHtml(order.mpesaCode || "N/A")}</strong>
            </div>
            <div class="meta-block">
              <span>Location</span>
              <strong>${escapeHtml(order.location || LOCATION_NAME)}</strong>
            </div>
            <div class="meta-block">
              <span>Paid to</span>
              <strong>${escapeHtml(formatPaymentTargets(order.paymentTargets))}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function handleAdminLoginSubmit(event) {
  event.preventDefault();
  await loginAdmin();
}

async function loginAdmin() {
  const email = elements.adminEmailInput.value.trim();
  const password = elements.adminPasswordInput.value.trim();

  if (!email || !password) {
    setStatusLine(elements.adminLoginStatus, "Enter admin email and password.", "error");
    return;
  }

  try {
    const credentials = await signInWithEmailAndPassword(auth, email, password);
    await registerPushSubscription("admin", credentials.user.email || email, {
      requestPermission: true,
      role: "admin",
      silent: false,
    });
    elements.adminEmailInput.value = "";
    elements.adminPasswordInput.value = "";
    setStatusLine(elements.adminLoginStatus, "Admin login successful.", "success");
    showAdminPanel();
  } catch (error) {
    console.error(error);
    setStatusLine(elements.adminLoginStatus, "Wrong admin email or password.", "error");
  }
}

async function logoutAdmin() {
  await unregisterPushSubscription("admin");
  await signOut(auth);
  hideElement(elements.adminPanel);
  setViewMode("orders");
}

function listenForAdminOrders() {
  if (unsubscribeAdminOrders) {
    unsubscribeAdminOrders();
  }

  unsubscribeAdminOrders = onSnapshot(ordersCollection, (snapshot) => {
    handleAdminOrderAlerts(snapshot);
    const orders = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

    renderAdminOrders(orders);
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
  if (!auth.currentUser) {
    collectNewSnapshotDocs(snapshot, adminShopOrderAlertTracker);
    return;
  }

  const newOrders = collectNewSnapshotDocs(snapshot, adminShopOrderAlertTracker);
  newOrders.forEach((order) => {
    const tag = `umma-shop-order-${order.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    const title = "New Shop Here order";
    const body = `${order.customerName || "A customer"} submitted an order for ${order.shopName || LOCATION_NAME}.`;
    void showBrowserNotification(title, body, {
      link: "./umma-shop.html",
      tag,
    });
  });
}

function listenForAdminFeedbacks() {
  if (unsubscribeAdminFeedbacks) {
    unsubscribeAdminFeedbacks();
  }

  unsubscribeAdminFeedbacks = onSnapshot(feedbackCollection, (snapshot) => {
    const feedbacks = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

    renderAdminFeedbacks(feedbacks);
  });
}

function renderAdminOrders(orders) {
  if (!orders.length) {
    elements.adminOrdersList.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>No orders yet</h3>
          <p>New Umma shop orders will appear here for admin review.</p>
        </div>
      </div>
    `;
    return;
  }

  elements.adminOrdersList.innerHTML = orders
    .map((order) => {
      const itemsText = (order.items || []).map((item) => `${item.qty || 1} x ${item.name}`).join(", ");
      return `
        <article class="order-item order-card">
          <div class="order-header">
            <div>
              <p class="eyebrow">Shop Here order</p>
              <h3>${escapeHtml(order.customerName || "N/A")}</h3>
              <p class="muted">${escapeHtml(order.customerEmail || "N/A")}</p>
            </div>
            <div class="meta-pills">
              ${renderStatusPill(order.paid ? "Paid" : "Pending", order.paid ? "paid" : "pending")}
              ${renderStatusPill(order.delivered ? "Delivered" : "Not Delivered", order.delivered ? "active" : "inactive")}
            </div>
          </div>

          <div class="order-meta-grid">
            <div class="meta-block">
              <span>Shop</span>
              <strong>${escapeHtml(order.shopName || "N/A")}</strong>
            </div>
            <div class="meta-block">
              <span>Location</span>
              <strong>${escapeHtml(order.location || LOCATION_NAME)}</strong>
            </div>
            <div class="meta-block">
              <span>Amount paid</span>
              <strong>KES ${escapeHtml(String(order.totalAmount || "0"))}</strong>
            </div>
            <div class="meta-block">
              <span>Payment code</span>
              <strong>${escapeHtml(order.mpesaCode || "N/A")}</strong>
            </div>
            <div class="meta-block shop-meta-block--wide">
              <span>Items</span>
              <strong>${escapeHtml(itemsText || "N/A")}</strong>
            </div>
            <div class="meta-block">
              <span>Paid to</span>
              <strong>${escapeHtml(formatPaymentTargets(order.paymentTargets))}</strong>
            </div>
            <div class="meta-block">
              <span>Submitted</span>
              <strong>${escapeHtml(formatTime(order.createdAt))}</strong>
            </div>
          </div>

          <div class="button-row shop-action-row">
            ${
              order.paid
                ? ""
                : `<button class="button button-success button-small mark-paid" data-id="${escapeHtml(order.id)}" type="button">Mark Paid</button>`
            }
            ${
              order.delivered
                ? ""
                : `<button class="button button-secondary button-small mark-delivered" data-id="${escapeHtml(order.id)}" type="button">Mark Delivered</button>`
            }
            <button class="button button-danger button-small delete-order" data-id="${escapeHtml(order.id)}" type="button">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");

  elements.adminOrdersList.querySelectorAll(".mark-paid").forEach((button) => {
    button.addEventListener("click", async () => {
      await updateDoc(doc(db, "ummaShopOrders", button.dataset.id), { paid: true });
    });
  });

  elements.adminOrdersList.querySelectorAll(".mark-delivered").forEach((button) => {
    button.addEventListener("click", async () => {
      await updateDoc(doc(db, "ummaShopOrders", button.dataset.id), { delivered: true });
    });
  });

  elements.adminOrdersList.querySelectorAll(".delete-order").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this order?")) {
        return;
      }

      await deleteDoc(doc(db, "ummaShopOrders", button.dataset.id));
    });
  });
}

function renderAdminFeedbacks(feedbacks) {
  if (!feedbacks.length) {
    elements.adminFeedbackList.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>No feedback yet</h3>
          <p>Customer feedback and complaints for this shop page will appear here.</p>
        </div>
      </div>
    `;
    return;
  }

  elements.adminFeedbackList.innerHTML = feedbacks
    .map(
      (feedback) => `
        <article class="notification-item feedback-message-card">
          <div class="split-row">
            <div>
              <strong>${escapeHtml(feedback.name || "N/A")}</strong>
              <p class="tiny">${escapeHtml(feedback.email || "N/A")}</p>
            </div>
            ${renderStatusPill(feedback.reviewed ? "Reviewed" : "Received", feedback.reviewed ? "active" : "pending")}
          </div>
          <p>${escapeHtml(feedback.message || "N/A")}</p>
          <p class="tiny">${escapeHtml(formatTime(feedback.createdAt))}</p>
        </article>
      `,
    )
    .join("");
}

function renderStatusPill(label, tone) {
  const toneMap = {
    active: "status-pill--active",
    inactive: "status-pill--inactive",
    paid: "status-pill--paid",
    pending: "status-pill--pending",
  };

  const className = toneMap[tone] || "status-pill--inactive";
  return `<span class="status-pill ${className}">${escapeHtml(label)}</span>`;
}

function formatPaymentTargets(targets) {
  if (Array.isArray(targets) && targets.length) {
    return targets.join(" / ");
  }

  if (typeof targets === "string" && targets.trim()) {
    return targets.trim();
  }

  return `Till ${SERVICE_FEE_TILL}`;
}

function formatTime(value) {
  if (!value) {
    return "Unknown time";
  }

  return new Date(value).toLocaleString("en-KE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}
