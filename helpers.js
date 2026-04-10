export function formatCurrency(value) {
  return `KSh ${Number(value || 0).toLocaleString("en-KE")}`;
}

export function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const MENU_DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const MENU_MEAL_PERIOD_OPTIONS = [
  "Breakfast",
  "Lunch",
  "Supper",
];

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

export function normalizeCoordinates(value) {
  const latitude = toFiniteNumber(value?.latitude ?? value?.lat);
  const longitude = toFiniteNumber(value?.longitude ?? value?.lng);
  const accuracy = toFiniteNumber(value?.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    ...(Number.isFinite(accuracy) ? { accuracy } : {}),
    latitude: Math.max(-90, Math.min(90, latitude)),
    longitude: Math.max(-180, Math.min(180, longitude)),
  };
}

export function calculateDistanceKm(origin, destination) {
  const start = normalizeCoordinates(origin);
  const end = normalizeCoordinates(destination);

  if (!start || !end) {
    return null;
  }

  const earthRadiusKm = 6371;
  const latDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const lonDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLat = (start.latitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

export function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return "Unknown";
  }

  if (distanceKm < 1) {
    return `${Math.max(50, Math.round(distanceKm * 1000))} m`;
  }

  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
}

export function formatCoordinatePair(value) {
  const coordinates = normalizeCoordinates(value);
  if (!coordinates) {
    return "Unknown";
  }

  return `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`;
}

export function pluralize(count) {
  return Number(count) === 1 ? "" : "s";
}

export function normalizeMenuDay(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return MENU_DAY_OPTIONS.find((item) => item.toLowerCase() === normalizedValue) || "";
}

export function normalizeMenuMealPeriod(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return MENU_MEAL_PERIOD_OPTIONS.find((item) => item.toLowerCase() === normalizedValue) || "";
}

export function getMenuScheduleDetails(item) {
  const day = normalizeMenuDay(item?.day);
  const mealPeriod = normalizeMenuMealPeriod(item?.mealPeriod);
  const isScheduled = Boolean(day || mealPeriod);
  const label = day
    ? `${day}${mealPeriod ? ` ${mealPeriod}` : ""}`
    : mealPeriod
      ? mealPeriod
      : "Daily menu";

  return {
    day,
    isScheduled,
    label,
    mealPeriod,
  };
}

<<<<<<< HEAD
=======
function sanitizeNotificationKeyPart(value) {
  return String(value || "").trim().replace(/\//g, "_").slice(0, 400);
}

export function buildNotificationDocId({ to, type, refId }) {
  const normalizedTo = sanitizeNotificationKeyPart(to);
  const normalizedType = sanitizeNotificationKeyPart(type).toLowerCase();
  const normalizedRefId = sanitizeNotificationKeyPart(refId);

  if (!normalizedTo || !normalizedType || !normalizedRefId) {
    return "";
  }

  return `${normalizedTo}__${normalizedType}__${normalizedRefId}`;
}

>>>>>>> a647933bd6aefe8a9a13f3420ffb090b4827b629
export function sortMenuItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftSchedule = getMenuScheduleDetails(left);
    const rightSchedule = getMenuScheduleDetails(right);

    if (leftSchedule.isScheduled !== rightSchedule.isScheduled) {
      return leftSchedule.isScheduled ? 1 : -1;
    }

    const leftDayIndex = leftSchedule.day ? MENU_DAY_OPTIONS.indexOf(leftSchedule.day) : -1;
    const rightDayIndex = rightSchedule.day ? MENU_DAY_OPTIONS.indexOf(rightSchedule.day) : -1;
    if (leftDayIndex !== rightDayIndex) {
      return leftDayIndex - rightDayIndex;
    }

    const leftMealIndex = leftSchedule.mealPeriod
      ? MENU_MEAL_PERIOD_OPTIONS.indexOf(leftSchedule.mealPeriod)
      : -1;
    const rightMealIndex = rightSchedule.mealPeriod
      ? MENU_MEAL_PERIOD_OPTIONS.indexOf(rightSchedule.mealPeriod)
      : -1;
    if (leftMealIndex !== rightMealIndex) {
      return leftMealIndex - rightMealIndex;
    }

    const nameCompare = String(left?.name || "").localeCompare(String(right?.name || ""));
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return Number(left?.price || 0) - Number(right?.price || 0);
  });
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
