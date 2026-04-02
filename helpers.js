export function formatCurrency(value) {
  return `KSh ${Number(value || 0).toLocaleString("en-KE")}`;
}

export function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    });
  } catch {
    return String(timestamp || "");
  }
}

export function formatDateOnly(timestamp) {
  if (!timestamp) {
    return "Not set";
  }

  try {
    return new Date(timestamp).toLocaleDateString("en-KE");
  } catch {
    return "Not set";
  }
}

export function pluralize(count) {
  return Number(count) === 1 ? "" : "s";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function inferStatusTone(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("active")) {
    return "active";
  }

  if (normalized.includes("block")) {
    return "blocked";
  }

  if (normalized.includes("expire")) {
    return "expired";
  }

  if (normalized.includes("open")) {
    return "inactive";
  }

  return "pending";
}

export function inferToastTone(message) {
  const value = String(message || "").toLowerCase();

  if (/(success|placed|paid|approved|activated|login|added|removed|deleted|unblocked)/.test(value)) {
    return "success";
  }

  if (/(expired|pending|max|warning)/.test(value)) {
    return "warn";
  }

  if (/(fail|error|wrong|blocked|permission)/.test(value)) {
    return "error";
  }

  return "info";
}
