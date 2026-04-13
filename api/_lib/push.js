const admin = require("firebase-admin");

const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications?c=push";
const DEFAULT_ONESIGNAL_APP_ID = "8a058e59-ba58-44ae-a3fb-2f8c53778035";
const DEFAULT_SITE_URL = "https://ummeats.vercel.app";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getSiteUrl() {
  return String(process.env.SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
}

function getOneSignalAppId() {
  return String(process.env.ONESIGNAL_APP_ID || DEFAULT_ONESIGNAL_APP_ID).trim();
}

function getServiceAccount() {
  return JSON.parse(requireEnv("FIREBASE_SERVICE_ACCOUNT_JSON"));
}

function getDatabaseUrl(serviceAccount) {
  const explicitUrl = String(process.env.FIREBASE_DATABASE_URL || "").trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const projectId = String(serviceAccount?.project_id || "").trim();
  if (!projectId) {
    return "";
  }

  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

function getAdminApp() {
  const serviceAccount = getServiceAccount();

  if (!admin.apps.length) {
    const databaseURL = getDatabaseUrl(serviceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      ...(databaseURL ? { databaseURL } : {}),
    });
  }

  return admin.app();
}

function getFirestore() {
  getAdminApp();
  return admin.firestore();
}

function getRealtimeDatabase() {
  getAdminApp();
  return admin.database();
}

async function sendPushMessage({ aliases = [], appId, body, data = null, filters = null, title, url }) {
  const restApiKey = requireEnv("ONESIGNAL_REST_API_KEY");

  const hasAliases = Array.isArray(aliases) && aliases.length > 0;
  const hasFilters = Array.isArray(filters) && filters.length > 0;
  if (!hasAliases && !hasFilters) {
    return null;
  }

  const payload = {
    app_id: appId,
    contents: {
      en: body,
    },
    ...(data && typeof data === "object" ? { data } : {}),
    headings: {
      en: title,
    },
    target_channel: "push",
    url,
  };

  if (hasAliases) {
    payload.include_aliases = {
      external_id: aliases,
    };
  }

  if (hasFilters) {
    payload.filters = filters;
  }

  const response = await fetch(ONESIGNAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${restApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`OneSignal send failed (${response.status}): ${responseText}`);
  }

  return response.json();
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = {
  admin,
  getAdminApp,
  getFirestore,
  getOneSignalAppId,
  getRealtimeDatabase,
  getSiteUrl,
  requireEnv,
  sendJson,
  sendPushMessage,
};
