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
  } catch {
    // Ignore storage write failures (private mode / blocked storage).
  }
}

function createRandomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCustomerId() {
  let customerId = safeGetStorageItem("CUSTOMER_ID");
  if (!customerId) {
    customerId = `cust_${createRandomId()}`;
    safeSetStorageItem("CUSTOMER_ID", customerId);
  }

  return customerId;
}

export function loadSavedCustomerProfile() {
  try {
    return JSON.parse(safeGetStorageItem("CUSTOMER_PROFILE") || "null");
  } catch {
    return null;
  }
}

export function saveCustomerProfile(profile) {
  safeSetStorageItem("CUSTOMER_PROFILE", JSON.stringify(profile));
}

export function loadSavedOrderProfile() {
  try {
    return JSON.parse(safeGetStorageItem("ORDER_PROFILE") || "{}");
  } catch {
    return {};
  }
}

export function saveOrderProfile(profile) {
  safeSetStorageItem("ORDER_PROFILE", JSON.stringify(profile));
}
