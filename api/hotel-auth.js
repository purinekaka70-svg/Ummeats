const {
  admin,
  buildHotelUid,
  createPasswordRecord,
  getFirestore,
  isHotelPasswordStrong,
  normalizeHotelAccountName,
  nowTimestamp,
  passwordsMatch,
  rejectDisallowedOrigin,
  sanitizeText,
  sendJson,
  setCorsHeaders,
  HOTEL_LOGIN_LOCK_MS,
  HOTEL_LOGIN_MAX_FAILURES,
} = require("./_lib/security");

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function sanitizeCoordinates(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  const accuracy = Number(value?.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    ...(Number.isFinite(accuracy) && accuracy > 0 ? { accuracy } : {}),
    latitude,
    longitude,
  };
}

async function findHotelByNormalizedName(firestore, normalizedName) {
  if (!normalizedName) {
    return null;
  }

  const directMatchSnapshot = await firestore
    .collection("hotels")
    .where("normalizedName", "==", normalizedName)
    .limit(1)
    .get();

  if (!directMatchSnapshot.empty) {
    return directMatchSnapshot.docs[0];
  }

  const legacySnapshot = await firestore.collection("hotels").limit(200).get();
  return legacySnapshot.docs.find((item) => normalizeHotelAccountName(item.data()?.name) === normalizedName) || null;
}

async function registerHotel(body, res) {
  const firestore = getFirestore();
  const name = sanitizeText(body.name, 120);
  const normalizedName = normalizeHotelAccountName(name);
  const phone = sanitizeText(body.phone, 40);
  const password = String(body.password || "");
  const till = sanitizeText(body.till, 40);
  const location = sanitizeText(body.location, 160) || "Around Umma University";
  const county = sanitizeText(body.county, 80);
  const normalizedCounty = county ? sanitizeText(body.normalizedCounty, 80).toLowerCase() : "";
  const coordinates = sanitizeCoordinates(body.coordinates);

  if (!name || !phone || !password || !till || !coordinates) {
    sendJson(res, 400, { error: "Missing required hotel registration details." });
    return;
  }

  if (!isHotelPasswordStrong(password)) {
    sendJson(res, 400, { error: "Use a stronger hotel password with at least 10 characters, upper/lowercase letters, and a number." });
    return;
  }

  const existingHotel = await findHotelByNormalizedName(firestore, normalizedName);
  if (existingHotel) {
    sendJson(res, 400, { error: "A hotel with this name is already registered." });
    return;
  }

  const aliasRef = firestore.collection("hotelAccountNames").doc(normalizedName);
  const hotelRef = firestore.collection("hotels").doc();
  const credentialRef = firestore.collection("hotelCredentials").doc(hotelRef.id);
  const restaurantRef = firestore.collection("restaurants").doc(hotelRef.id);

  try {
    await firestore.runTransaction(async (transaction) => {
      const aliasSnapshot = await transaction.get(aliasRef);
      if (aliasSnapshot.exists) {
        throw new Error("A hotel with this name is already registered.");
      }

      const passwordRecord = createPasswordRecord(password);
      const createdAt = nowTimestamp();

      transaction.set(aliasRef, {
        createdAt,
        hotelId: hotelRef.id,
        normalizedName,
      });
      transaction.set(hotelRef, {
        approved: false,
        blocked: false,
        coordinates,
        createdAt,
        ...(county ? { county } : {}),
        ...(normalizedCounty ? { normalizedCounty } : {}),
        location,
        name,
        normalizedName,
        phone,
        subscriptionExpiry: null,
        till,
      });
      transaction.set(credentialRef, {
        createdAt,
        failedAttempts: 0,
        iterations: passwordRecord.iterations,
        lockUntil: 0,
        normalizedName,
        passwordHash: passwordRecord.passwordHash,
        passwordSalt: passwordRecord.passwordSalt,
      });
      transaction.set(restaurantRef, {
        hotelId: hotelRef.id,
        menu: [],
      });
    });

    sendJson(res, 200, { hotelId: hotelRef.id, ok: true, pendingApproval: true });
  } catch (error) {
    console.error(error);
    sendJson(res, 400, { error: String(error?.message || "Hotel registration failed.").trim() || "Hotel registration failed." });
  }
}

async function loginHotel(body, res) {
  const firestore = getFirestore();
  const normalizedName = normalizeHotelAccountName(body.name);
  const password = String(body.password || "");

  if (!normalizedName || !password) {
    sendJson(res, 400, { error: "Hotel name and password are required." });
    return;
  }

  const aliasRef = firestore.collection("hotelAccountNames").doc(normalizedName);
  let aliasSnapshot = await aliasRef.get();
  let hotelId = String(aliasSnapshot.data()?.hotelId || "").trim();
  let hotelSnapshot = null;

  if (!hotelId) {
    const legacyHotelSnapshot = await findHotelByNormalizedName(firestore, normalizedName);
    if (!legacyHotelSnapshot?.exists) {
      sendJson(res, 401, { error: "Wrong hotel name or password." });
      return;
    }

    hotelSnapshot = legacyHotelSnapshot;
    hotelId = legacyHotelSnapshot.id;
    await aliasRef.set({
      createdAt: nowTimestamp(),
      hotelId,
      normalizedName,
    }, { merge: true });
    aliasSnapshot = await aliasRef.get();
  }

  const credentialRef = firestore.collection("hotelCredentials").doc(hotelId);
  const hotelRef = firestore.collection("hotels").doc(hotelId);
  const credentialSnapshot = await credentialRef.get();
  hotelSnapshot = hotelSnapshot || await hotelRef.get();

  if (!hotelSnapshot.exists) {
    sendJson(res, 401, { error: "Wrong hotel name or password." });
    return;
  }

  let credential = credentialSnapshot.data() || {};
  const hotel = hotelSnapshot.data() || {};
  const timestamp = nowTimestamp();

  if (!credentialSnapshot.exists) {
    const legacyPassword = String(hotel.pass || "");
    if (!legacyPassword || legacyPassword !== password) {
      sendJson(res, 401, { error: "Wrong hotel name or password." });
      return;
    }

    const passwordRecord = createPasswordRecord(password);
    await Promise.all([
      credentialRef.set({
        createdAt: timestamp,
        failedAttempts: 0,
        iterations: passwordRecord.iterations,
        lastLoginAt: timestamp,
        lockUntil: 0,
        normalizedName,
        passwordHash: passwordRecord.passwordHash,
        passwordSalt: passwordRecord.passwordSalt,
      }, { merge: true }),
      hotelRef.set({
        legacyPasswordMigratedAt: timestamp,
        normalizedName,
        pass: admin.firestore.FieldValue.delete(),
      }, { merge: true }),
      aliasRef.set({
        createdAt: Number(aliasSnapshot.data()?.createdAt || timestamp),
        hotelId,
        normalizedName,
      }, { merge: true }),
    ]);

    credential = {
      failedAttempts: 0,
      lockUntil: 0,
      ...passwordRecord,
    };
  }

  if (Number(credential.lockUntil || 0) > timestamp) {
    sendJson(res, 429, { error: "Too many failed hotel login attempts. Try again later." });
    return;
  }

  if (!passwordsMatch(password, credential.passwordHash, credential.passwordSalt)) {
    const nextFailures = Number(credential.failedAttempts || 0) + 1;
    await credentialRef.set({
      failedAttempts: nextFailures,
      lastFailedAt: timestamp,
      lockUntil: nextFailures >= HOTEL_LOGIN_MAX_FAILURES ? timestamp + HOTEL_LOGIN_LOCK_MS : 0,
    }, { merge: true });
    sendJson(res, 401, { error: "Wrong hotel name or password." });
    return;
  }

  if (!hotel.approved) {
    sendJson(res, 403, { error: "Hotel not approved yet." });
    return;
  }

  if (hotel.blocked) {
    sendJson(res, 403, { error: "Hotel is blocked." });
    return;
  }

  if (!hotel.subscriptionExpiry || Number(hotel.subscriptionExpiry) < timestamp) {
    sendJson(res, 403, { error: "Subscription expired. Contact admin." });
    return;
  }

  await credentialRef.set({
    failedAttempts: 0,
    lastLoginAt: timestamp,
    lockUntil: 0,
  }, { merge: true });

  const customToken = await admin.auth().createCustomToken(buildHotelUid(hotelId), {
    hotelId,
    role: "hotel",
  });

  sendJson(res, 200, {
    customToken,
    hotelId,
    hotelName: sanitizeText(hotel.name, 120),
    ok: true,
  });
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (rejectDisallowedOrigin(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    const action = String(body.action || "").trim().toLowerCase();

    if (action === "register") {
      await registerHotel(body, res);
      return;
    }

    if (action === "login") {
      await loginHotel(body, res);
      return;
    }

    sendJson(res, 400, { error: "Unsupported hotel auth action." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Hotel auth request failed." });
  }
};
