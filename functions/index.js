const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

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
