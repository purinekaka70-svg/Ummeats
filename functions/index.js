const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

function normalizePushSubscriptionData(data = {}) {
  const label = String(data.label || "").trim().slice(0, 160);
  const target = String(data.target || "").trim().slice(0, 160);
  const token = String(data.token || "").trim();

  if (!target || !token) {
    throw new HttpsError("invalid-argument", "Push subscription target and token are required.");
  }

  return { label, target, token };
}

exports.upsertPushSubscription = onCall(async (request) => {
  const { label, target, token } = normalizePushSubscriptionData(request.data);
  const snapshot = await db.collection("pushSubscriptions").where("token", "==", token).get();
  const match = snapshot.docs.find((item) => item.data().target === target);
  const payload = {
    label,
    target,
    token,
    updatedAt: Date.now(),
  };

  if (match) {
    await match.ref.update(payload);
    return { ok: true, mode: "updated" };
  }

  await db.collection("pushSubscriptions").add({
    ...payload,
    createdAt: Date.now(),
  });

  return { ok: true, mode: "created" };
});

exports.removePushSubscription = onCall(async (request) => {
  const { target, token } = normalizePushSubscriptionData(request.data);
  const snapshot = await db.collection("pushSubscriptions").where("token", "==", token).get();
  const deletions = [];

  snapshot.forEach((item) => {
    if (item.data().target === target) {
      deletions.push(item.ref.delete());
    }
  });

  await Promise.all(deletions);
  return { ok: true, deleted: deletions.length };
});

exports.sendOrderPushNotifications = onDocumentCreated("orders/{orderId}", async (event) => {
  const order = event.data?.data();
  if (!order) {
    return;
  }

  const targets = ["admin"];
  if (order.hotelId) {
    targets.push(order.hotelId);
  }

  const subscriptionSnapshot = await db
    .collection("pushSubscriptions")
    .where("target", "in", targets)
    .get();

  if (subscriptionSnapshot.empty) {
    return;
  }

  let hotelName = "selected hotel";
  if (order.hotelId) {
    const hotelSnapshot = await db.collection("hotels").doc(order.hotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = hotelSnapshot.data().name || hotelName;
    }
  }

  const cleanTokens = [];
  const refsByToken = new Map();

  subscriptionSnapshot.forEach((docSnapshot) => {
    const token = docSnapshot.data().token;
    if (!token) {
      return;
    }

    cleanTokens.push(token);
    refsByToken.set(token, refsByToken.get(token) || []);
    refsByToken.get(token).push(docSnapshot.ref);
  });

  if (!cleanTokens.length) {
    return;
  }

  const title = "New order received";
  const body = `${order.customerName || "A customer"} placed an order for ${hotelName}.`;

  const response = await messaging.sendEachForMulticast({
    tokens: cleanTokens,
    data: {
      body,
      title,
      type: "order",
    },
  });

  const invalidCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]);

  const deletions = [];
  response.responses.forEach((item, index) => {
    if (!item.success && invalidCodes.has(item.error?.code)) {
      const token = cleanTokens[index];
      const refs = refsByToken.get(token) || [];
      refs.forEach((ref) => deletions.push(ref.delete()));
    }
  });

  await Promise.all(deletions);
});
