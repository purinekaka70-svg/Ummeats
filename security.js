import {
  getIdToken,
  getIdTokenResult,
  signInAnonymously,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { auth } from "./firebase.js";

const DEFAULT_API_ORIGIN = "https://ummeats.vercel.app";

function buildApiUrls(pathname) {
  const normalizedPath = String(pathname || "").trim();
  if (!normalizedPath) {
    return [];
  }

  const urls = [new URL(normalizedPath, window.location.origin).href];
  const fallbackUrl = new URL(normalizedPath, DEFAULT_API_ORIGIN).href;
  if (!urls.includes(fallbackUrl)) {
    urls.push(fallbackUrl);
  }

  return urls;
}

async function postJson(pathname, payload, options = {}) {
  const urls = buildApiUrls(pathname);
  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        body: JSON.stringify(payload || {}),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {}),
        },
        method: options.method || "POST",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || `Request failed with ${response.status}.`);
      }

      return result || {};
    } catch (error) {
      errors.push(`${url} -> ${String(error?.message || "Request failed").trim()}`);
    }
  }

  throw new Error(errors.join(" | ") || "Request failed.");
}

export async function resolveAuthSession(user = auth.currentUser) {
  if (!user) {
    return {
      customerId: "",
      hotelId: "",
      role: "guest",
      user: null,
    };
  }

  const tokenResult = await getIdTokenResult(user).catch(() => null);
  const roleClaim = String(tokenResult?.claims?.role || "").trim().toLowerCase();
  const hotelIdClaim = String(tokenResult?.claims?.hotelId || "").trim();

  if (roleClaim === "hotel" && hotelIdClaim) {
    return {
      customerId: "",
      hotelId: hotelIdClaim,
      role: "hotel",
      user,
    };
  }

  if (user.isAnonymous) {
    return {
      customerId: user.uid,
      hotelId: "",
      role: "customer",
      user,
    };
  }

  return {
    customerId: user.uid,
    hotelId: "",
    role: roleClaim || "user",
    user,
  };
}

export async function ensureCustomerSession() {
  const activeUser = auth.currentUser;
  if (activeUser) {
    const session = await resolveAuthSession(activeUser);
    if (session.role === "customer") {
      return activeUser;
    }

    throw new Error("Hotel session is active on this page.");
  }

  const credentials = await signInAnonymously(auth);
  return credentials.user;
}

export async function loginHotelWithServer(name, password) {
  const payload = await postJson("/api/hotel-auth", {
    action: "login",
    name,
    password,
  });

  if (!payload.customToken) {
    throw new Error("Hotel login failed.");
  }

  await signInWithCustomToken(auth, payload.customToken);
  return payload;
}

export async function registerHotelWithServer(payload) {
  return postJson("/api/hotel-auth", {
    action: "register",
    ...payload,
  });
}

export async function ensureAdminAccess(user = auth.currentUser) {
  if (!user) {
    return { ok: false };
  }

  const idToken = await getIdToken(user, true);
  return postJson("/api/admin-access", {}, { idToken });
}

export async function getCurrentIdToken() {
  if (!auth.currentUser) {
    return "";
  }

  return getIdToken(auth.currentUser).catch(() => "");
}

export function isPermissionDeniedError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    code.includes("permission-denied") ||
    code.includes("permission_denied") ||
    message.includes("missing or insufficient permissions") ||
    message.includes("permission denied") ||
    message.includes("permission_denied")
  );
}
