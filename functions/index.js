const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

function normalizePushSubscriptionData(data = {}) {
  const label = String(data.label || "").trim().slice(0, 160);
  const target = String(data.target || "").trim().slice(0, 160);
  const token = String(data.token || "").trim();

  if (!target || !token) {
    throw new HttpsError("invalid-argument", "Push subscription target and token are required.");
  }

  return { label, target, token };
}

function buildTargetBuckets(snapshot, targets) {
  const buckets = new Map(targets.map((target) => [target, { refsByToken: new Map(), tokens: [] }]));

  snapshot.forEach((docSnapshot) => {
    const target = String(docSnapshot.data().target || "").trim();
    const token = String(docSnapshot.data().token || "").trim();

    if (!target || !token || !buckets.has(target)) {
      return;
    }

    const bucket = buckets.get(target);
    if (!bucket.refsByToken.has(token)) {
      bucket.tokens.push(token);
      bucket.refsByToken.set(token, []);
    }

    bucket.refsByToken.get(token).push(docSnapshot.ref);
  });

  return buckets;
}

async function sendPushToTargets({ title, body, data = {}, linksByTarget = {}, targets = [] }) {
  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  if (!uniqueTargets.length) {
    return;
  }

  const subscriptionSnapshot = await db
    .collection("pushSubscriptions")
    .where("target", "in", uniqueTargets)
    .get();

  if (subscriptionSnapshot.empty) {
    return;
  }

  const buckets = buildTargetBuckets(subscriptionSnapshot, uniqueTargets);
  const deletions = [];

  for (const target of uniqueTargets) {
    const bucket = buckets.get(target);
    if (!bucket?.tokens.length) {
      continue;
    }

    const response = await messaging.sendEachForMulticast({
      tokens: bucket.tokens,
      data: {
        ...data,
        body,
        link: linksByTarget[target] || "./",
        target,
        title,
      },
    });

    response.responses.forEach((item, index) => {
      if (!item.success && INVALID_TOKEN_CODES.has(item.error?.code)) {
        const token = bucket.tokens[index];
        const refs = bucket.refsByToken.get(token) || [];
        refs.forEach((ref) => deletions.push(ref.delete()));
      }
    });
  }

  await Promise.all(deletions);
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

  const orderId = String(event.params.orderId || "");

  let hotelName = "selected hotel";
  if (order.hotelId) {
    const hotelSnapshot = await db.collection("hotels").doc(order.hotelId).get();
    if (hotelSnapshot.exists) {
      hotelName = hotelSnapshot.data().name || hotelName;
    }
  }

  const title = "New order received";
  const body = `${order.customerName || "A customer"} placed an order for ${hotelName}.`;
  const targets = ["admin"];
  const linksByTarget = {
    admin: "./admin.html",
  };

  if (order.hotelId) {
    targets.push(order.hotelId);
    linksByTarget[order.hotelId] = "./index.html";
  }

  await sendPushToTargets({
    title,
    body,
    targets,
    linksByTarget,
    data: {
      hotelId: String(order.hotelId || ""),
      orderId,
      tag: `order-${orderId}`,
      type: "order",
    },
  });
});

exports.sendUmmaShopOrderPushNotifications = onDocumentCreated("ummaShopOrders/{orderId}", async (event) => {
  const order = event.data?.data();
  if (!order) {
    return;
  }

  const orderId = String(event.params.orderId || "");
  const shopName = String(order.shopName || "Around Umma University");
  const title = "New Shop Here order";
  const body = `${order.customerName || "A customer"} submitted a Shop Here order for ${shopName}.`;

  await sendPushToTargets({
    title,
    body,
    targets: ["admin"],
    linksByTarget: {
      admin: "./umma-shop.html",
    },
    data: {
      orderId,
      shopName,
      tag: `umma-shop-order-${orderId}`,
      type: "umma-shop-order",
    },
  });
});
