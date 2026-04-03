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
import { ANNOUNCEMENT_TEXT, SERVICE_FEE, SERVICE_FEE_TILL, SMS_SIMULATION_ENABLED } from "./config.js";
import { db } from "./firebase.js";
import { escapeHtml, formatCurrency, inferToastTone } from "./helpers.js";
import { registerPushSubscription, unregisterPushSubscription } from "./push.js";
import {
  CUSTOMER_ID,
  elements,
  getCart,
  getCartItemsTotal,
  getCheckoutDraft,
  getHotelById,
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

bootstrap();

function bootstrap() {
  bindStaticEvents();
  bindInstallFlow();
  hydrateStaticShell();
  registerAppServiceWorker();
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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCartModal();
    }
  });
}

function bindInstallFlow() {
  if (elements.installAppButton) {
    elements.installAppButton.textContent = "Install Tamu App";
    elements.installAppButton.addEventListener("click", handleInstallClick);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installAppButton?.classList.remove("is-hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.installAppButton?.classList.add("is-hidden");
    showToast("Tamu Express is ready to open from your device.", "success");
  });
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
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferredInstallPrompt = null;
  elements.installAppButton?.classList.add("is-hidden");

  if (result.outcome === "accepted") {
    showToast("Install started. You can pin Tamu Express on this device.", "success");
  }
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
    await handlePlaceOrder(button.dataset.hotel, { clearCartAfter: false, closeModal: true });
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

  if (button.id === "logoutHotel") {
    await unregisterPushSubscription(state.currentHotelId);
    state.currentHotelId = null;
    state.currentAdmin = false;
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

  try {
    await addDoc(collection(db, "feedbacks"), feedbackPayload);
  } catch (error) {
    console.error("Feedback write failed", error);
    showToast("Failed to send feedback.", "error");
    return;
  }

  try {
    await addDoc(collection(db, "notifications"), {
      message: `New feedback from ${name} (${phone})`,
      read: false,
      timestamp: Date.now(),
      to: "admin",
      type: "feedback",
    });
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

  showToast("Item added to cart. Please call before placing order for food confirmation.", "warn");
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

  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Paid" });
    showToast("Order marked as paid.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to mark order as paid.", "error");
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
  const location = normalizeHotelLocation(form.elements.hotelLocation?.value);
  const normalizedName = normalizeHotelAccountName(name);

  if (!name || !phone || !pass || !till) {
    alert("Fill in all hotel details.");
    return;
  }

  if (state.hotels.some((item) => normalizeHotelAccountName(item.name) === normalizedName)) {
    alert("A hotel with this name is already registered.");
    return;
  }

  try {
    const docRef = await addDoc(collection(db, "hotels"), {
      name,
      phone,
      pass,
      till,
      location,
      approved: false,
      blocked: false,
      subscriptionExpiry: null,
    });

    await setDoc(doc(db, "restaurants", docRef.id), {
      hotelId: docRef.id,
      menu: [],
    });

    try {
      await addDoc(collection(db, "notifications"), {
        message: `New hotel registration: ${name} (${phone})`,
        read: false,
        timestamp: Date.now(),
        to: "admin",
        type: "hotel",
      });
    } catch (error) {
      console.warn("Hotel registration notification write failed", error);
    }

    form.reset();
    showToast("Hotel registered. Wait for admin approval and subscription activation.", "success");
  } catch (error) {
    console.error(error);
    showToast("Registration failed.", "error");
  }
}

async function loginHotel(form) {
  const name = form.elements.hotelName.value.trim();
  const pass = form.elements.hotelPass.value.trim();
  const normalizedName = normalizeHotelAccountName(name);

  if (!name || !pass) {
    alert("Enter hotel name and password.");
    return;
  }

  const hotel = state.hotels.find(
    (item) => normalizeHotelAccountName(item.name) === normalizedName && item.pass === pass,
  );
  if (!hotel) {
    alert("Wrong hotel name or password.");
    return;
  }

  if (!hotel.approved) {
    alert("Hotel not approved yet.");
    return;
  }

  if (hotel.blocked) {
    alert("Hotel is blocked.");
    return;
  }

  if (!hotel.subscriptionExpiry || hotel.subscriptionExpiry < Date.now()) {
    alert("Subscription expired. Contact admin.");
    return;
  }

  state.currentHotelId = hotel.id;
  state.currentAdmin = false;
  await registerPushSubscription(hotel.id, hotel.name);
  switchTab("hotel");
  showToast("Hotel login successful.", "success");
}

async function addMenuItem(form) {
  const name = form.elements.itemName.value.trim();
  const price = Number.parseFloat(form.elements.itemPrice.value);

  if (!name || Number.isNaN(price)) {
    alert("Fill a valid menu item and price.");
    return;
  }

  const restaurant = getRestaurantByHotelId(state.currentHotelId);
  const nextMenu = [...(restaurant?.menu || []), { name, price }];
  const docId = restaurant?.id || state.currentHotelId;

  await setDoc(doc(db, "restaurants", docId), {
    hotelId: state.currentHotelId,
    menu: nextMenu,
  });

  form.reset();
  showToast("Menu item added.", "success");
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
  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + SERVICE_FEE;

  elements.cartModalContent.innerHTML = `
    <div class="stack">
      <div class="split-row">
        <div>
          <p class="eyebrow">Confirm order</p>
          <h3 id="modalTitle" class="card-title">${escapeHtml(hotel.name)}</h3>
        </div>
        <button class="button button-outline button-small" id="closeCartModal" type="button">Close</button>
      </div>

      <div class="menu-list">
        ${cart
          .map(
            (item) => `
              <div class="order-item">
                <div class="split-row">
                  <strong>${escapeHtml(`${item.qty} x ${item.name}`)}</strong>
                  <span class="item-price">${formatCurrency(item.price * item.qty)}</span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="summary-list">
        <div class="summary-item"><span>Items total</span><strong>${formatCurrency(itemsTotal)}</strong></div>
        <div class="summary-item"><span>Service fee</span><strong>${formatCurrency(SERVICE_FEE)}</strong></div>
        <div class="summary-item"><span>Total</span><strong>${formatCurrency(total)}</strong></div>
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

      <div class="button-row">
        <button class="button button-primary" data-hotel="${escapeHtml(hotelId)}" id="confirmOrderBtn" type="button">
          Confirm Order
        </button>
        <button class="button button-outline" id="closeCartModal" type="button">Return to Cart</button>
      </div>

      <p class="tiny">Closing the dialog returns you to the cart so you can keep editing the order.</p>
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

  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + SERVICE_FEE;
  const hotel = getHotelById(hotelId);

  const orderPayload = {
    createdAt: Date.now(),
    customerId: CUSTOMER_ID,
    customerName,
    customerPhone,
    hotelId,
    items: cart.map((item) => ({
      name: item.name,
      price: Number(item.price || 0),
      qty: Number(item.qty || 1),
    })),
    itemsTotal,
    mpesaName,
    mpesaNumber,
    serviceFee: SERVICE_FEE,
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

  try {
    await addDoc(collection(db, "orders"), orderPayload);
    sendSimulatedHotelSMS(hotelId, {
      customerName,
      customerPhone,
      total,
    });
    showToast("Order placed successfully.", "success");
  } catch (error) {
    console.error("Order write failed", error);
    showToast("Failed to place order.", "error");
    return;
  }

  const message = `New order from ${customerName} (${customerPhone}) - ${formatCurrency(total)} for ${hotel.name}`;

  try {
    await addDoc(collection(db, "notifications"), {
      message,
      read: false,
      timestamp: Date.now(),
      to: "admin",
      type: "order",
    });

    await addDoc(collection(db, "notifications"), {
      message,
      read: false,
      timestamp: Date.now(),
      to: hotelId,
      type: "order",
    });
  } catch (error) {
    console.warn("Notification write failed", error);
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
