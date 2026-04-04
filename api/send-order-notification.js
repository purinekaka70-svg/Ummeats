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
    } catch (error) {
      return {};
    }
  }

  return req.body;
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
  let hotelName = "selected hotel";

  const targetHotelId = String(order.hotelId || hotelId || "").trim();

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = String(hotelSnapshot.data().name || hotelName);
    }
  }

  let sent = 0;
  if (!order.onesignalAdminDispatchedAt) {
    await sendPushMessage({
      appId,
      body: `${customerName} placed an order for ${hotelName}.`,
      filters: [
        { field: "tag", key: "role", relation: "=", value: "admin" },
      ],
      title: "New order received",
      url: `${siteUrl}/admin.html`,
    });
    updates.onesignalAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sent += 1;
  }

  if (targetHotelId && !order.onesignalHotelDispatchedAt) {
    await sendPushMessage({
      appId,
      body: `${customerName} placed an order for ${hotelName}.`,
      filters: [
        { field: "tag", key: "role", relation: "=", value: "hotel" },
        { operator: "AND" },
        { field: "tag", key: "hotel_id", relation: "=", value: targetHotelId },
      ],
      title: "New order received",
      url: `${siteUrl}/index.html`,
    });
    updates.onesignalHotelDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sent += 1;
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sent, statusCode: 200 };
}

async function dispatchShopOrder({ appId, firestore, orderId, siteUrl }) {
  const orderRef = firestore.collection("ummaShopOrders").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    return { error: "Shop order not found.", statusCode: 404 };
  }

  const order = orderSnapshot.data() || {};
  if (order.onesignalAdminDispatchedAt) {
    return { ok: true, sent: 0, statusCode: 200 };
  }

  const customerName = String(order.customerName || "A customer");
  const shopName = String(order.shopName || "Around Umma University");

  await sendPushMessage({
    appId,
    body: `${customerName} submitted a Shop Here order for ${shopName}.`,
    filters: [
      { field: "tag", key: "role", relation: "=", value: "admin" },
    ],
    title: "New Shop Here order",
    url: `${siteUrl}/umma-shop.html`,
  });

  await orderRef.update({
    onesignalAdminDispatchedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, sent: 1, statusCode: 200 };
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
  let hotelName = "selected hotel";

  const targetHotelId = String(order.hotelId || hotelId || "").trim();
  const targetCustomerId = String(order.customerId || customerId || "").trim();

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = String(hotelSnapshot.data().name || hotelName);
    }
  }

  let sent = 0;

  if (targetCustomerId && !order.onesignalCustomerPaidDispatchedAt) {
    await sendPushMessage({
      aliases: [targetCustomerId],
      appId,
      body: `Your order for ${hotelName} has been marked as paid.`,
      title: "Order marked as paid",
      url: `${siteUrl}/index.html`,
    });
    updates.onesignalCustomerPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sent += 1;
  }

  if (!order.onesignalAdminPaidDispatchedAt) {
    await sendPushMessage({
      appId,
      body: `Order for ${customerName} at ${hotelName} has been marked as paid.`,
      filters: [
        { field: "tag", key: "role", relation: "=", value: "admin" },
      ],
      title: "Order marked as paid",
      url: `${siteUrl}/admin.html`,
    });
    updates.onesignalAdminPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sent += 1;
  }

  if (targetHotelId && !order.onesignalHotelPaidDispatchedAt) {
    await sendPushMessage({
      appId,
      body: `Order for ${customerName} at ${hotelName} has been marked as paid.`,
      filters: [
        { field: "tag", key: "role", relation: "=", value: "hotel" },
        { operator: "AND" },
        { field: "tag", key: "hotel_id", relation: "=", value: targetHotelId },
      ],
      title: "Order marked as paid",
      url: `${siteUrl}/index.html`,
    });
    updates.onesignalHotelPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sent += 1;
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sent, statusCode: 200 };
}

module.exports = async (req, res) => {
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
