const {
  ensureAdminRecord,
  getFirestore,
  getRealtimeDatabase,
  rejectDisallowedOrigin,
  sanitizeText,
  sendJson,
  setCorsHeaders,
  verifyBearerIdToken,
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

    const body = parseBody(req);
    const action = sanitizeText(body.action, 40).toLowerCase() || "get";
    const employeeId = sanitizeText(body.employeeId, 160);
    if (!employeeId) {
      sendJson(res, 400, { error: "employeeId is required." });
      return;
    }

    const employeeSnapshot = await firestore.collection("employees").doc(employeeId).get();
    if (!employeeSnapshot.exists && action !== "delete") {
      sendJson(res, 404, { error: "Employee not found." });
      return;
    }

    const employee = employeeSnapshot.data() || {};
    const databasePath = sanitizeText(employee.idCardDatabasePath, 240) || `employeeIdCards/${employeeId}`;
    if (action === "delete") {
      await getRealtimeDatabase().ref(databasePath).remove();
      sendJson(res, 200, { employeeId, ok: true, removed: true });
      return;
    }

    const idCardSnapshot = await getRealtimeDatabase().ref(databasePath).get();
    if (!idCardSnapshot.exists()) {
      sendJson(res, 404, { error: "Employee ID PDF was not found." });
      return;
    }

    const idCard = idCardSnapshot.val() || {};
    const base64 = String(idCard.base64 || "").trim();
    if (!base64) {
      sendJson(res, 404, { error: "Employee ID PDF content is empty." });
      return;
    }

    sendJson(res, 200, {
      base64,
      employeeId,
      fileName: sanitizeText(
        idCard.fileName || employee.idCardFileName || `${employeeId}-id-card.pdf`,
        160,
      ) || `${employeeId}-id-card.pdf`,
      mimeType: sanitizeText(idCard.mimeType || "application/pdf", 80) || "application/pdf",
      ok: true,
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 401, { error: "Employee ID PDF request failed." });
  }
};
