const crypto = require("crypto");
const { admin, getFirestore, getRealtimeDatabase, getSiteUrl, requireEnv, sendJson } = require("./push");

const HOTEL_PASSWORD_ITERATIONS = 120000;
const HOTEL_PASSWORD_KEY_BYTES = 64;
const HOTEL_PASSWORD_DIGEST = "sha512";
const HOTEL_LOGIN_MAX_FAILURES = 5;
const HOTEL_LOGIN_LOCK_MS = 15 * 60 * 1000;

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function sanitizeText(value, maxLength = 200) {
  return normalizeWhitespace(value).slice(0, maxLength);
}

function normalizeHotelAccountName(value) {
  return sanitizeText(value, 120).toLowerCase();
}

function getAllowedOriginSet() {
  const siteUrlOrigin = (() => {
    try {
      return new URL(getSiteUrl()).origin;
    } catch {
      return "";
    }
  })();

  const explicitOrigins = String(process.env.ALLOWED_WEB_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return new Set([
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    siteUrlOrigin,
    ...explicitOrigins,
  ].filter(Boolean));
}

function isAllowedOrigin(origin) {
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) {
    return true;
  }

  const allowedOrigins = getAllowedOriginSet();
  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  try {
    const parsed = new URL(normalizedOrigin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res, methods = "POST, OPTIONS") {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (isAllowedOrigin(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", methods);
}

function rejectDisallowedOrigin(req, res) {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (!isAllowedOrigin(requestOrigin)) {
    sendJson(res, 403, { error: "Origin not allowed." });
    return true;
  }

  return false;
}

function createPasswordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(
    String(password || ""),
    String(salt || ""),
    HOTEL_PASSWORD_ITERATIONS,
    HOTEL_PASSWORD_KEY_BYTES,
    HOTEL_PASSWORD_DIGEST,
  ).toString("hex");
}

function createPasswordRecord(password) {
  const salt = createPasswordSalt();
  return {
    iterations: HOTEL_PASSWORD_ITERATIONS,
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
  };
}

function passwordsMatch(password, passwordHash, passwordSalt) {
  const expected = Buffer.from(String(passwordHash || ""), "hex");
  const candidate = Buffer.from(hashPassword(password, passwordSalt), "hex");
  if (!expected.length || expected.length !== candidate.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, candidate);
}

function nowTimestamp() {
  return Date.now();
}

function isHotelPasswordStrong(password) {
  const value = String(password || "");
  return (
    value.length >= 10 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value)
  );
}

async function verifyBearerIdToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const idToken = authorization.slice(7).trim();
  if (!idToken) {
    throw new Error("Missing bearer token.");
  }

  return admin.auth().verifyIdToken(idToken);
}

function parseAdminAllowlist() {
  return new Set(
    String(process.env.ADMIN_EMAIL_ALLOWLIST || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isEmailAllowedForAdmin(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  return parseAdminAllowlist().has(normalizedEmail);
}

async function ensureAdminRecord(firestore, decodedToken) {
  const normalizedUid = String(decodedToken?.uid || "").trim();
  if (!normalizedUid) {
    return null;
  }

  const adminRef = firestore.collection("admins").doc(normalizedUid);
  const adminSnapshot = await adminRef.get();
  const normalizedEmail = sanitizeText(decodedToken?.email, 160).toLowerCase();
  // Allow admin access for any authenticated email/password user.
  // This keeps admin logins "normal" without a manual approval list.
  if (!normalizedEmail) {
    return null;
  }

  const payload = {
    email: normalizedEmail,
    lastValidatedAt: nowTimestamp(),
    uid: normalizedUid,
  };

  if (!adminSnapshot.exists) {
    payload.createdAt = nowTimestamp();
  }

  await adminRef.set(payload, { merge: true });
  return {
    ...(adminSnapshot.data() || {}),
    ...payload,
  };
}

function buildHotelUid(hotelId) {
  return `hotel:${String(hotelId || "").trim()}`;
}

module.exports = {
  HOTEL_LOGIN_LOCK_MS,
  HOTEL_LOGIN_MAX_FAILURES,
  admin,
  buildHotelUid,
  createPasswordRecord,
  getFirestore,
  getRealtimeDatabase,
  getSiteUrl,
  hashPassword,
  ensureAdminRecord,
  isEmailAllowedForAdmin,
  isHotelPasswordStrong,
  normalizeHotelAccountName,
  nowTimestamp,
  passwordsMatch,
  rejectDisallowedOrigin,
  requireEnv,
  sanitizeText,
  sendJson,
  setCorsHeaders,
  verifyBearerIdToken,
};
