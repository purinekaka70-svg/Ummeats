const { getFirestore, sendJson } = require("./_lib/push");

const LOCATION_NAME = "Around Umma University";
const SERVICE_FEE_TILL = "7312380";

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

function sanitizeText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      name: sanitizeText(item?.name, 160),
      qty: Math.max(1, Number.parseInt(item?.qty || "1", 10) || 1),
    }))
    .filter((item) => item.name);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    const customerName = sanitizeText(body.customerName, 120);
    const customerEmail = sanitizeText(body.customerEmail, 160);
    const shopName = sanitizeText(body.shopName, 160);
    const mpesaCode = sanitizeText(body.mpesaCode, 80);
    const totalAmount = Number(body.totalAmount);
    const items = sanitizeItems(body.items);

    if (!customerName || !customerEmail || !shopName || !mpesaCode || !items.length || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      sendJson(res, 400, { error: "Missing required Shop Here order fields." });
      return;
    }

    const firestore = getFirestore();
    const orderPayload = {
      createdAt: Date.now(),
      customerEmail,
      customerName,
      delivered: false,
      items,
      location: sanitizeText(body.location, 160) || LOCATION_NAME,
      mpesaCode,
      paymentTargets: Array.isArray(body.paymentTargets) && body.paymentTargets.length
        ? body.paymentTargets.map((item) => sanitizeText(item, 120)).filter(Boolean)
        : [`Till ${sanitizeText(body.serviceFeeTill, 40) || SERVICE_FEE_TILL}`],
      paid: false,
      serviceFeeTill: sanitizeText(body.serviceFeeTill, 40) || SERVICE_FEE_TILL,
      shopName,
      source: "shop-here",
      totalAmount,
    };

    const orderRef = await firestore.collection("ummaShopOrders").add(orderPayload);
    sendJson(res, 200, { id: orderRef.id, ok: true });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Failed to submit Shop Here order." });
  }
};
