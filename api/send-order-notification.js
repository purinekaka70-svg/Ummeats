const {
  admin,
  getFirestore,
  getOneSignalAppId,
  getSiteUrl,
  sendJson,
  sendPushMessage,
} = require("./_lib/push");

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

function nowTimestamp() {
  return Date.now();
}

async function writeNotification(firestore, payload) {
  await firestore.collection("notifications").add({
    message: String(payload.message || "Notification"),
    read: false,
    timestamp: payload.timestamp || nowTimestamp(),
    to: String(payload.to || "").trim(),
    type: String(payload.type || "order").trim(),
  });
}

function parseRecipientCount(result) {
  const candidate = result?.recipients ?? result?.total ?? result?.successful;
  const count = Number(candidate);
  return Number.isFinite(count) ? count : null;
}

function hasPushRecipients(result) {
  const recipientCount = parseRecipientCount(result);
  if (recipientCount === null) {
    return true;
  }

  return recipientCount > 0;
}

function buildTagEqualsFilter(key, value) {
  const normalizedKey = String(key || "").trim();
  const normalizedValue = String(value || "").trim();
  if (!normalizedKey || !normalizedValue) {
    return [];
  }

  return [
    {
      field: "tag",
      key: normalizedKey,
      relation: "=",
      value: normalizedValue,
    },
  ];
}

async function trySendPush(payload) {
  try {
    const result = await sendPushMessage(payload);
    if (!hasPushRecipients(result)) {
      console.warn("Push notification had zero recipients", {
        aliases: payload.aliases || [],
        filters: payload.filters || [],
      });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Push notification send failed", error);
    return false;
  }
}

async function sendPushWithFallbackTargets({ aliasTargets = [], appId, body, filterSets = [], title, url }) {
  const normalizedAliases = [...new Set(aliasTargets.map((item) => String(item || "").trim()).filter(Boolean))];
  if (normalizedAliases.length) {
    const aliasSent = await trySendPush({
      aliases: normalizedAliases,
      appId,
      body,
      title,
      url,
    });
    if (aliasSent) {
      return true;
    }
  }

  for (const filters of filterSets) {
    if (!Array.isArray(filters) || !filters.length) {
      continue;
    }

    const filterSent = await trySendPush({
      appId,
      body,
      filters,
      title,
      url,
    });
    if (filterSent) {
      return true;
    }
  }

  return false;
}

async function dispatchStandardOrder({ appId, firestore, hotelId, orderId, siteUrl }) {
  const orderRef = firestore.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    return { error: "Order not found.", statusCode: 404 };
  }

  const order = orderSnapshot.data() || {};
  const updates = {};
  const customerName = String(order.customerName || "A customer");
  const targetHotelId = String(order.hotelId || hotelId || "").trim();
  let hotelName = "selected hotel";

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = String(hotelSnapshot.data().name || hotelName);
    }
  }

  const orderMessage = `${customerName} placed an order for ${hotelName}.`;
  const timestamp = nowTimestamp();
  let sentInApp = 0;
  let sentPush = 0;

  if (!order.notificationAdminDispatchedAt) {
    await writeNotification(firestore, {
      message: orderMessage,
      timestamp,
      to: "admin",
      type: "order",
    });
    updates.notificationAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (targetHotelId && !order.notificationHotelDispatchedAt) {
    await writeNotification(firestore, {
      message: orderMessage,
      timestamp,
      to: targetHotelId,
      type: "order",
    });
    updates.notificationHotelDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.onesignalAdminDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: orderMessage,
        filterSets: [buildTagEqualsFilter("notification_target", "admin"), buildTagEqualsFilter("role", "admin")],
        title: "New order received",
        url: `${siteUrl}/admin.html`,
      })
    ) {
      updates.onesignalAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (targetHotelId && !order.onesignalHotelDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetHotelId],
        appId,
        body: orderMessage,
        filterSets: [
          buildTagEqualsFilter("hotel_id", targetHotelId),
          buildTagEqualsFilter("notification_target", targetHotelId),
        ],
        title: "New order received",
        url: `${siteUrl}/index.html`,
      })
    ) {
      updates.onesignalHotelDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sentInApp, sentPush, statusCode: 200 };
}

async function dispatchShopOrder({ appId, firestore, orderId, siteUrl }) {
  const orderRef = firestore.collection("ummaShopOrders").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    return { error: "Shop order not found.", statusCode: 404 };
  }

  const order = orderSnapshot.data() || {};
  const updates = {};
  const customerName = String(order.customerName || "A customer");
  const shopName = String(order.shopName || "Around Umma University");
  const message = `${customerName} submitted a Shop Here order for ${shopName}.`;
  const timestamp = nowTimestamp();
  let sentInApp = 0;
  let sentPush = 0;

  if (!order.notificationAdminDispatchedAt) {
    await writeNotification(firestore, {
      message,
      timestamp,
      to: "admin",
      type: "umma-shop-order",
    });
    updates.notificationAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.onesignalAdminDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: message,
        filterSets: [buildTagEqualsFilter("notification_target", "admin"), buildTagEqualsFilter("role", "admin")],
        title: "New Shop Here order",
        url: `${siteUrl}/umma-shop.html`,
      })
    ) {
      updates.onesignalAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sentInApp, sentPush, statusCode: 200 };
}

async function dispatchPaidOrder({ appId, customerId, firestore, hotelId, orderId, siteUrl }) {
  const orderRef = firestore.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    return { error: "Order not found.", statusCode: 404 };
  }

  const order = orderSnapshot.data() || {};
  const updates = {};
  const customerName = String(order.customerName || "A customer");
  const targetHotelId = String(order.hotelId || hotelId || "").trim();
  const targetCustomerId = String(order.customerId || customerId || "").trim();
  let hotelName = "selected hotel";

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = String(hotelSnapshot.data().name || hotelName);
    }
  }

  const customerMessage = `Your order for ${hotelName} has been marked as paid.`;
  const adminHotelMessage = `Order for ${customerName} at ${hotelName} has been marked as paid.`;
  const timestamp = nowTimestamp();
  let sentInApp = 0;
  let sentPush = 0;

  if (targetCustomerId && !order.notificationCustomerPaidDispatchedAt) {
    await writeNotification(firestore, {
      message: customerMessage,
      timestamp,
      to: targetCustomerId,
      type: "order-paid",
    });
    updates.notificationCustomerPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.notificationAdminPaidDispatchedAt) {
    await writeNotification(firestore, {
      message: adminHotelMessage,
      timestamp,
      to: "admin",
      type: "order-paid",
    });
    updates.notificationAdminPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (targetHotelId && !order.notificationHotelPaidDispatchedAt) {
    await writeNotification(firestore, {
      message: adminHotelMessage,
      timestamp,
      to: targetHotelId,
      type: "order-paid",
    });
    updates.notificationHotelPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (targetCustomerId && !order.onesignalCustomerPaidDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetCustomerId],
        appId,
        body: customerMessage,
        filterSets: [
          buildTagEqualsFilter("customer_id", targetCustomerId),
          buildTagEqualsFilter("notification_target", targetCustomerId),
        ],
        title: "Order marked as paid",
        url: `${siteUrl}/index.html`,
      })
    ) {
      updates.onesignalCustomerPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (!order.onesignalAdminPaidDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: adminHotelMessage,
        filterSets: [buildTagEqualsFilter("notification_target", "admin"), buildTagEqualsFilter("role", "admin")],
        title: "Order marked as paid",
        url: `${siteUrl}/admin.html`,
      })
    ) {
      updates.onesignalAdminPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (targetHotelId && !order.onesignalHotelPaidDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetHotelId],
        appId,
        body: adminHotelMessage,
        filterSets: [
          buildTagEqualsFilter("hotel_id", targetHotelId),
          buildTagEqualsFilter("notification_target", targetHotelId),
        ],
        title: "Order marked as paid",
        url: `${siteUrl}/index.html`,
      })
    ) {
      updates.onesignalHotelPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sentInApp, sentPush, statusCode: 200 };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    const customerId = String(body.customerId || "").trim();
    const hotelId = String(body.hotelId || "").trim();
    const orderId = String(body.orderId || "").trim();
    const type = String(body.type || "order").trim().toLowerCase();

    if (!orderId) {
      sendJson(res, 400, { error: "orderId is required." });
      return;
    }

    const appId = getOneSignalAppId();
    const firestore = getFirestore();
    const siteUrl = getSiteUrl();

    let result;
    if (type === "umma-shop-order") {
      result = await dispatchShopOrder({ appId, firestore, orderId, siteUrl });
    } else if (type === "order-paid" || type === "order_paid") {
      result = await dispatchPaidOrder({ appId, customerId, firestore, hotelId, orderId, siteUrl });
    } else {
      result = await dispatchStandardOrder({ appId, firestore, hotelId, orderId, siteUrl });
    }

    sendJson(res, result.statusCode || 200, result);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Notification dispatch failed." });
  }
};
