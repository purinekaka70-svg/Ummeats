import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  ref as rtdbRef,
  remove as removeRtdb,
  set as setRtdb,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { auth, db, rtdb } from "./firebase.js";
import { inferToastTone } from "./helpers.js";
import { showToast } from "./ui.js";
import { renderEmployeePortal } from "./view-employee.js";

const EMPLOYEE_ID_CARD_MAX_BYTES = 5 * 1024 * 1024;
const EMPLOYEE_AUTH_VIEW_STORAGE_KEY = "EMPLOYEE_AUTH_VIEW";
const EMPLOYEE_AUTH_EMAIL_STORAGE_KEY = "EMPLOYEE_AUTH_EMAIL";
const EMPLOYEE_PORTAL_FALLBACK_MESSAGE = "Employee portal could not load fully. You can still login or refresh this page.";
const EMPLOYEE_PROFILE_LOAD_STALL_MS = 5000;

function safeGetStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadEmployeeAuthView() {
  const value = String(safeGetStorageItem(EMPLOYEE_AUTH_VIEW_STORAGE_KEY) || "").trim().toLowerCase();
  return value === "register" ? "register" : "login";
}

function saveEmployeeAuthView(view) {
  const normalizedView = view === "register" ? "register" : "login";
  safeSetStorageItem(EMPLOYEE_AUTH_VIEW_STORAGE_KEY, normalizedView);
}

function loadEmployeeAuthEmail() {
  return String(safeGetStorageItem(EMPLOYEE_AUTH_EMAIL_STORAGE_KEY) || "").trim();
}

function saveEmployeeAuthEmail(email) {
  const normalizedEmail = String(email || "").trim().slice(0, 160);
  safeSetStorageItem(EMPLOYEE_AUTH_EMAIL_STORAGE_KEY, normalizedEmail);
}

function getEmployeeAppElement() {
  return document.getElementById("app");
}

function renderEmployeeStartupFallback(message = EMPLOYEE_PORTAL_FALLBACK_MESSAGE) {
  const appElement = getEmployeeAppElement();
  if (!appElement) {
    return;
  }

  appElement.innerHTML = `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <p class="eyebrow">Employee workspace</p>
          <h2 class="view-title">Employee Portal</h2>
          <p class="view-copy">${String(message || EMPLOYEE_PORTAL_FALLBACK_MESSAGE)}</p>
        </div>
      </div>
      <div class="auth-flow-grid employee-portal-grid">
        <article class="card auth-card">
          <p class="eyebrow">Quick actions</p>
          <h3 class="card-title">Reload Portal</h3>
          <p class="tiny">Refresh to retry loading login and registration forms.</p>
          <div class="button-row">
            <button class="button button-primary" id="employeePortalReload" type="button">Refresh</button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderEmployeeView() {
  try {
    renderEmployeePortal(portalState);
  } catch (error) {
    console.error("Employee portal render failed", error);
    renderEmployeeStartupFallback("Employee portal failed to render. Refresh page to retry.");
  }
}

const portalState = {
  authEmailDraft: loadEmployeeAuthEmail(),
  authView: loadEmployeeAuthView(),
  currentUser: null,
  employeeProfile: null,
  employeeSection: "dashboard",
  employeeSidebarOpen: false,
  hotels: [],
  mapMode: "road",
  mapModal: null,
  orders: [],
  profileStatus: "idle",
  pendingRegistration: false,
  ummaShopOrders: [],
};

let unsubscribeEmployeeProfile = null;
let employeeProfileLoadTimer = null;

function clearEmployeeProfileLoadTimer() {
  if (employeeProfileLoadTimer) {
    window.clearTimeout(employeeProfileLoadTimer);
    employeeProfileLoadTimer = null;
  }
}

function scheduleEmployeeProfileLoadTimeout(uid) {
  clearEmployeeProfileLoadTimer();
  if (!uid) {
    return;
  }

  employeeProfileLoadTimer = window.setTimeout(() => {
    employeeProfileLoadTimer = null;
    if (!portalState.currentUser || portalState.currentUser.uid !== uid) {
      return;
    }

    if (portalState.profileStatus !== "loading") {
      return;
    }

    portalState.profileStatus = "stalled";
    showToast("Employee profile check is taking too long. Use refresh or logout to continue.", "warn");
    renderEmployeeView();
  }, EMPLOYEE_PROFILE_LOAD_STALL_MS);
}

safeBootstrap();

function safeBootstrap() {
  try {
    bootstrap();
  } catch (error) {
    console.error("Employee portal bootstrap failed", error);
    renderEmployeeStartupFallback();
  }
}

function bootstrap() {
  bindEvents();
  hydrateShell();
  subscribeToAuth();
  subscribeToCollections();
  renderEmployeeView();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
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
    portalState.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee hotels subscription failed", error);
  });

  onSnapshot(collection(db, "orders"), (snapshot) => {
    portalState.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee orders subscription failed", error);
  });

  onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
    portalState.ummaShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeeView();
  }, (error) => {
    console.warn("Employee shop orders subscription failed", error);
  });
}

function subscribeToAuth() {
  onAuthStateChanged(auth, (user) => {
    portalState.currentUser = user;
    clearEmployeeProfileLoadTimer();

    if (unsubscribeEmployeeProfile) {
      unsubscribeEmployeeProfile();
      unsubscribeEmployeeProfile = null;
    }

    if (!user) {
      portalState.employeeProfile = null;
      portalState.employeeSection = "dashboard";
      portalState.employeeSidebarOpen = false;
      portalState.mapMode = "road";
      portalState.mapModal = null;
      portalState.profileStatus = "idle";
      portalState.pendingRegistration = false;
      portalState.authView = loadEmployeeAuthView();
      renderEmployeeView();
      return;
    }

    portalState.profileStatus = "loading";
    if (!portalState.pendingRegistration) {
      scheduleEmployeeProfileLoadTimeout(user.uid);
    }
    renderEmployeeView();

    unsubscribeEmployeeProfile = onSnapshot(doc(db, "employees", user.uid), (snapshot) => {
      clearEmployeeProfileLoadTimer();
      portalState.employeeProfile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      portalState.profileStatus = snapshot.exists() ? "ready" : portalState.pendingRegistration ? "loading" : "missing";
      if (portalState.profileStatus === "loading" && !portalState.pendingRegistration) {
        scheduleEmployeeProfileLoadTimeout(user.uid);
      }
      renderEmployeeView();
    }, (error) => {
      console.warn("Employee profile subscription failed", error);
      clearEmployeeProfileLoadTimer();
      portalState.profileStatus = "missing";
      renderEmployeeView();
    });
  }, (error) => {
    console.error("Employee auth subscription failed", error);
    clearEmployeeProfileLoadTimer();
    renderEmployeeStartupFallback("Employee auth could not initialize. Refresh and try again.");
  });
}

async function handleClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.id === "employeePortalReload") {
    window.location.reload();
    return;
  }

  if (button.id === "retryEmployeeSession") {
    window.location.reload();
    return;
  }

  if (button.classList.contains("employeeAuthSwitchBtn")) {
    portalState.authView = button.dataset.authView === "register" ? "register" : "login";
    saveEmployeeAuthView(portalState.authView);
    renderEmployeeView();
    return;
  }

  if (button.id === "employeeMenuToggle") {
    portalState.employeeSidebarOpen = !portalState.employeeSidebarOpen;
    renderEmployeeView();
    return;
  }

  if (button.id === "employeeSidebarClose" || button.id === "employeeSidebarBackdrop") {
    portalState.employeeSidebarOpen = false;
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("employeeNavBtn")) {
    portalState.employeeSection = button.dataset.section || "dashboard";
    portalState.employeeSidebarOpen = false;
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("viewCustomerMapBtn")) {
    openCustomerMap(button);
    return;
  }

  if (button.classList.contains("employeeMapModeBtn")) {
    portalState.mapMode = button.dataset.mode === "satellite" ? "satellite" : "road";
    renderEmployeeView();
    return;
  }

  if (button.classList.contains("employeeDeleteShopOrderBtn")) {
    await deleteEmployeeShopOrder(button.dataset.orderId || "");
    return;
  }

  if (button.id === "closeEmployeeMap" || button.id === "employeeMapBackdrop") {
    closeCustomerMap();
    return;
  }

  if (button.id === "logoutEmployee") {
    await signOut(auth);
    showToast("Employee logged out.", "info");
  }
}

async function deleteEmployeeShopOrder(orderIdValue) {
  const orderId = String(orderIdValue || "").trim();
  if (!orderId) {
    showToast("Order ID is missing.", "warn");
    return;
  }

  if (!window.confirm("Delete this Shop Here order?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "ummaShopOrders", orderId));
    showToast("Shop Here order deleted.", "success");
  } catch (error) {
    console.error("Employee delete Shop Here order failed", error);
    showToast("Failed to delete Shop Here order.", "error");
  }
}

function openCustomerMap(button) {
  const latitude = Number.parseFloat(button.dataset.latitude || "");
  const longitude = Number.parseFloat(button.dataset.longitude || "");

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showToast("Customer map point is not available for this order.", "warn");
    return;
  }

  portalState.mapModal = {
    customerArea: String(button.dataset.customerArea || "").trim(),
    customerName: String(button.dataset.customerName || "").trim(),
    latitude,
    longitude,
  };
  portalState.mapMode = "road";
  renderEmployeeView();
}

function closeCustomerMap() {
  if (!portalState.mapModal) {
    return;
  }

  portalState.mapModal = null;
  renderEmployeeView();
}

function handleInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (!portalState.currentUser && input.name === "employeeEmail") {
    portalState.authEmailDraft = String(input.value || "").trim();
    saveEmployeeAuthEmail(portalState.authEmailDraft);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id === "employeeLogin") {
    await loginEmployee(form);
    return;
  }

  if (form.id === "employeeRegister") {
    await registerEmployee(form);
  }
}

async function loginEmployee(form) {
  const email = form.elements.employeeEmail.value.trim();
  const password = form.elements.employeePass.value.trim();

  if (!email || !password) {
    alert("Enter employee email and password.");
    return;
  }

  try {
    saveEmployeeAuthEmail(email);
    portalState.authEmailDraft = email;
    portalState.authView = "login";
    saveEmployeeAuthView(portalState.authView);
    await signInWithEmailAndPassword(auth, email, password);
    form.reset();
    showToast("Employee login successful.", "success");
  } catch (error) {
    console.error(error);
    showToast(getAuthErrorMessage(error, "login"), "error");
  }
}

async function registerEmployee(form) {
  const fullName = form.elements.employeeName.value.trim();
  const email = form.elements.employeeEmail.value.trim();
  const idNumber = form.elements.employeeIdNumber.value.trim();
  const password = form.elements.employeePass.value.trim();
  const confirmPassword = form.elements.employeePassConfirm.value.trim();
  const idCardFile = form.elements.employeeIdCard.files?.[0];

  if (!fullName || !email || !idNumber || !password || !confirmPassword) {
    alert("Fill all employee account details.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  validateIdCardFile(idCardFile);

  portalState.pendingRegistration = true;
  portalState.profileStatus = "loading";
  saveEmployeeAuthEmail(email);
  portalState.authEmailDraft = email;
  renderEmployeeView();

  let credentials = null;
  let uploadResult = null;

  try {
    credentials = await createUserWithEmailAndPassword(auth, email, password);
    uploadResult = await uploadEmployeeIdCard(credentials.user.uid, idCardFile);

    await setDoc(doc(db, "employees", credentials.user.uid), {
      createdAt: Date.now(),
      email: credentials.user.email || email,
      fullName,
      idCardFileName: idCardFile.name,
      idCardDatabasePath: uploadResult.path,
      idCardUploaded: true,
      idNumber,
      role: "employee",
      status: "active",
      uid: credentials.user.uid,
    });

    try {
      await addDoc(collection(db, "notifications"), {
        message: `New employee account created: ${fullName} (${email})`,
        read: false,
        timestamp: Date.now(),
        to: "admin",
        type: "employee",
      });
    } catch (error) {
      console.warn("Employee notification write failed", error);
    }

    portalState.pendingRegistration = false;
    portalState.authView = "login";
    saveEmployeeAuthView(portalState.authView);
    form.reset();
    showToast("Employee account created successfully.", "success");
  } catch (error) {
    console.error(error);
    portalState.pendingRegistration = false;
    portalState.profileStatus = auth.currentUser ? "loading" : "idle";

    if (uploadResult?.path) {
      await removeRtdb(rtdbRef(rtdb, uploadResult.path)).catch(() => undefined);
    }

    if (credentials?.user) {
      await deleteUser(credentials.user).catch(() => undefined);
      if (auth.currentUser?.uid === credentials.user.uid) {
        await signOut(auth).catch(() => undefined);
      }
    }

    showToast(getAuthErrorMessage(error, "register"), "error");
    renderEmployeeView();
  }
}

function validateIdCardFile(file) {
  if (!file) {
    throw createEmployeeError("employee/id-card-required", "Upload one PDF that contains both front and back of the ID.");
  }

  const fileName = String(file.name || "").trim().toLowerCase();
  const fileType = String(file.type || "").trim().toLowerCase();
  const isPdf = fileType === "application/pdf" || fileName.endsWith(".pdf");
  if (!isPdf) {
    throw createEmployeeError("employee/id-card-pdf-required", "Only PDF is allowed. Upload one scanned PDF with both front and back.");
  }

  if (file.size > EMPLOYEE_ID_CARD_MAX_BYTES) {
    throw createEmployeeError("employee/id-card-too-large", "ID card file is too large. Use a file under 5 MB.");
  }
}

async function uploadEmployeeIdCard(uid, file) {
  const fileName = sanitizeStorageFileName(file.name || "id-card");
  const dataUrl = await readFileAsDataUrl(file);
  const base64Content = extractBase64Payload(dataUrl);
  const path = `employeeIdCards/${uid}`;
  await setRtdb(rtdbRef(rtdb, path), {
    base64: base64Content,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: Number(file.size || 0),
    uploadedAt: Date.now(),
  });

  return {
    path,
  };
}

function sanitizeStorageFileName(value) {
  return String(value || "file")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(createEmployeeError("employee/id-card-upload-failed", "Failed to read ID card file."));
    reader.readAsDataURL(file);
  });
}

function extractBase64Payload(dataUrl) {
  const normalized = String(dataUrl || "").trim();
  const marker = ";base64,";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) {
    throw createEmployeeError("employee/id-card-upload-failed", "Failed to process ID card PDF.");
  }

  const payload = normalized.slice(markerIndex + marker.length).trim();
  if (!payload) {
    throw createEmployeeError("employee/id-card-upload-failed", "Failed to process ID card PDF.");
  }

  return payload;
}

function createEmployeeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getAuthErrorMessage(error, mode) {
  const code = String(error?.code || "").toLowerCase();

  if (
    code === "employee/id-card-required" ||
    code === "employee/id-card-pdf-required" ||
    code === "employee/id-card-too-large" ||
    code === "employee/id-card-upload-failed"
  ) {
    return String(error.message || "ID card upload failed.");
  }

  if (code.includes("invalid-email")) {
    return "Enter a valid email address.";
  }

  if (code.includes("missing-password")) {
    return "Enter a password.";
  }

  if (code.includes("email-already-in-use")) {
    return "This email is already used by another account.";
  }

  if (code.includes("weak-password")) {
    return "Password should be at least 6 characters.";
  }

  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Wrong email or password.";
  }

  if (code.includes("too-many-requests")) {
    return "Too many attempts. Try again later.";
  }

  if (code.includes("database/permission-denied") || code.includes("permission_denied")) {
    return "ID card upload was blocked by Realtime Database rules.";
  }

  if (code.includes("database/network-error")) {
    return "Network error while uploading ID card. Try again.";
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("permission_denied")) {
    return "ID card upload was blocked by Realtime Database rules.";
  }

  if (message.includes("network error")) {
    return "ID card upload failed due to network error. Try again.";
  }

  if (mode === "register") {
    return "Failed to create the employee account.";
  }

  return "Failed to log in to the employee portal.";
}
