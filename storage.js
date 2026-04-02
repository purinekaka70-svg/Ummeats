export function getCustomerId() {
  let customerId = localStorage.getItem("CUSTOMER_ID");
  if (!customerId) {
    customerId = `cust_${crypto.randomUUID()}`;
    localStorage.setItem("CUSTOMER_ID", customerId);
  }

  return customerId;
}

export function loadSavedCustomerProfile() {
  try {
    return JSON.parse(localStorage.getItem("CUSTOMER_PROFILE") || "null");
  } catch {
    return null;
  }
}

export function saveCustomerProfile(profile) {
  localStorage.setItem("CUSTOMER_PROFILE", JSON.stringify(profile));
}

export function loadSavedOrderProfile() {
  try {
    return JSON.parse(localStorage.getItem("ORDER_PROFILE") || "{}");
  } catch {
    return {};
  }
}

export function saveOrderProfile(profile) {
  localStorage.setItem("ORDER_PROFILE", JSON.stringify(profile));
}
