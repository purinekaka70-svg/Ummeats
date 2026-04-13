const {
  ensureAdminRecord,
  getFirestore,
  rejectDisallowedOrigin,
  sendJson,
  setCorsHeaders,
  verifyBearerIdToken,
} = require("./_lib/security");

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
    const decodedToken = await verifyBearerIdToken(req);
    const firestore = getFirestore();
    const adminRecord = await ensureAdminRecord(firestore, decodedToken);
    if (!adminRecord) {
      sendJson(res, 403, { error: "This account is not approved for admin access." });
      return;
    }

    sendJson(res, 200, { ok: true, role: "admin" });
  } catch (error) {
    console.error(error);
    sendJson(res, 401, { error: "Admin verification failed." });
  }
};
