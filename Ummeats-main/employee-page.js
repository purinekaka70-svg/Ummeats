import {
  addDoc,
  collection,
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
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";
import { inferToastTone } from "./helpers.js";
import { showToast } from "./ui.js";
import { renderEmployeePortal } from "./view-employee.js";

const EMPLOYEE_ID_CARD_MAX_BYTES = 5 * 1024 * 1024;
const portalState = {
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

bootstrap();

function bootstrap() {
  bindEvents();
  hydrateShell();
  subscribeToAuth();
  subscribeToCollections();
  renderEmployeePortal(portalState);
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
    portalState.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeePortal(portalState);
  });

  onSnapshot(collection(db, "orders"), (snapshot) => {
    portalState.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeePortal(portalState);
  });

  onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
    portalState.ummaShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderEmployeePortal(portalState);
  });
}

function subscribeToAuth() {
  onAuthStateChanged(auth, (user) => {
    portalState.currentUser = user;

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
      renderEmployeePortal(portalState);
      return;
    }

    portalState.profileStatus = "loading";
    renderEmployeePortal(portalState);

    unsubscribeEmployeeProfile = onSnapshot(doc(db, "employees", user.uid), (snapshot) => {
      portalState.employeeProfile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      portalState.profileStatus = snapshot.exists() ? "ready" : portalState.pendingRegistration ? "loading" : "missing";
      renderEmployeePortal(portalState);
    });
  });
}

async function handleClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.id === "employeeMenuToggle") {
    portalState.employeeSidebarOpen = !portalState.employeeSidebarOpen;
    renderEmployeePortal(portalState);
    return;
  }

  if (button.id === "employeeSidebarClose" || button.id === "employeeSidebarBackdrop") {
    portalState.employeeSidebarOpen = false;
    renderEmployeePortal(portalState);
    return;
  }

  if (button.classList.contains("employeeNavBtn")) {
    portalState.employeeSection = button.dataset.section || "dashboard";
    portalState.employeeSidebarOpen = false;
    renderEmployeePortal(portalState);
    return;
  }

  if (button.classList.contains("viewCustomerMapBtn")) {
    openCustomerMap(button);
    return;
  }

  if (button.classList.contains("employeeMapModeBtn")) {
    portalState.mapMode = button.dataset.mode === "satellite" ? "satellite" : "road";
    renderEmployeePortal(portalState);
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
  renderEmployeePortal(portalState);
}

function closeCustomerMap() {
  if (!portalState.mapModal) {
    return;
  }

  portalState.mapModal = null;
  renderEmployeePortal(portalState);
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
  renderEmployeePortal(portalState);

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
      idCardPath: uploadResult.path,
      idCardUrl: uploadResult.url,
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
    form.reset();
    showToast("Employee account created successfully.", "success");
  } catch (error) {
    console.error(error);
    portalState.pendingRegistration = false;
    portalState.profileStatus = auth.currentUser ? "loading" : "idle";

    if (uploadResult?.storageRef) {
      await deleteObject(uploadResult.storageRef).catch(() => undefined);
    }

    if (credentials?.user) {
      await deleteUser(credentials.user).catch(() => undefined);
      if (auth.currentUser?.uid === credentials.user.uid) {
        await signOut(auth).catch(() => undefined);
      }
    }

    showToast(getAuthErrorMessage(error, "register"), "error");
    renderEmployeePortal(portalState);
  }
}

function validateIdCardFile(file) {
  if (!file) {
    throw createEmployeeError("employee/id-card-required", "Upload an ID card file.");
  }

  if (file.size > EMPLOYEE_ID_CARD_MAX_BYTES) {
    throw createEmployeeError("employee/id-card-too-large", "ID card file is too large. Use a file under 5 MB.");
  }
}

async function uploadEmployeeIdCard(uid, file) {
  const fileName = sanitizeStorageFileName(file.name || "id-card");
  const storageRef = ref(storage, `employee-id-cards/${uid}/${Date.now()}-${fileName}`);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(storageRef);

  return {
    path: storageRef.fullPath,
    storageRef,
    url,
  };
}

function sanitizeStorageFileName(value) {
  return String(value || "file")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
}

function createEmployeeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getAuthErrorMessage(error, mode) {
  const code = String(error?.code || "");

  if (code === "employee/id-card-required" || code === "employee/id-card-too-large") {
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

  if (code.includes("storage/unauthorized")) {
    return "ID card upload was blocked by Firebase Storage rules.";
  }

  if (code.includes("storage/canceled")) {
    return "ID card upload was canceled.";
  }

  if (mode === "register") {
    return "Failed to create the employee account.";
  }

  return "Failed to log in to the employee portal.";
}
