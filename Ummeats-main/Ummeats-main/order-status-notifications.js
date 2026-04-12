import { addDoc, collection } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { dispatchOrderNotification } from "./notification-api.js";

export async function notifyPaidOrderStatus(order, hotelName) {
  const normalizedHotelName = String(hotelName || "selected hotel").trim() || "selected hotel";
  const customerName = String(order.customerName || "A customer").trim() || "A customer";
  let dispatchSucceeded = false;
  if (order.id) {
    dispatchSucceeded = await dispatchOrderNotification(order.id, "order_paid", {
      customerId: order.customerId,
      hotelId: order.hotelId,
    });
  }

  if (dispatchSucceeded) {
    return;
  }

  const timestamp = Date.now();
  const writes = [];

  if (order.customerId) {
    writes.push(
      addDoc(collection(db, "notifications"), {
        message: `Your order for ${normalizedHotelName} has been marked as paid.`,
        read: false,
        timestamp,
        to: order.customerId,
        type: "order-paid",
      }),
    );
  }

  if (order.hotelId) {
    writes.push(
      addDoc(collection(db, "notifications"), {
        message: `Order for ${customerName} at ${normalizedHotelName} has been marked as paid.`,
        read: false,
        timestamp,
        to: order.hotelId,
        type: "order-paid",
      }),
    );
  }

  writes.push(
    addDoc(collection(db, "notifications"), {
      message: `Order for ${customerName} at ${normalizedHotelName} has been marked as paid.`,
      read: false,
      timestamp,
      to: "admin",
      type: "order-paid",
    }),
  );

  try {
    await Promise.all(writes);
  } catch (error) {
    console.warn("Paid order fallback notification write failed", error);
    throw new Error("Failed to send paid order notifications.");
  }
}

function resolveShopStatusConfig(statusType) {
  const normalizedType = String(statusType || "").trim().toLowerCase();
  if (normalizedType === "delivered") {
    return {
      customerType: "umma-shop-order-delivered",
      dispatchType: "umma-shop-delivered",
      statusLabel: "delivered",
      title: "Shop Here order marked as delivered",
    };
  }

  return {
    customerType: "umma-shop-order-paid",
    dispatchType: "umma-shop-paid",
    statusLabel: "paid",
    title: "Shop Here order marked as paid",
  };
}

export async function notifyShopOrderStatus(order, statusType = "paid") {
  const config = resolveShopStatusConfig(statusType);
  const customerName = String(order?.customerName || "A customer").trim() || "A customer";
  const shopName = String(order?.shopName || "Around Umma University").trim() || "Around Umma University";
  const customerTarget = String(order?.customerEmail || "").trim();
  const customerMessage = `Your Shop Here order for ${shopName} has been marked as ${config.statusLabel}.`;
  const adminMessage = `Shop Here order for ${customerName} at ${shopName} has been marked as ${config.statusLabel}.`;

  let dispatchSucceeded = false;
  if (order?.id) {
    dispatchSucceeded = await dispatchOrderNotification(order.id, config.dispatchType, {
      customerId: customerTarget,
    });
  }

  if (dispatchSucceeded) {
    return;
  }

  const timestamp = Date.now();
  const writes = [
    addDoc(collection(db, "notifications"), {
      message: adminMessage,
      read: false,
      timestamp,
      to: "admin",
      type: config.customerType,
    }),
  ];

  if (customerTarget) {
    writes.push(
      addDoc(collection(db, "notifications"), {
        message: customerMessage,
        read: false,
        timestamp,
        to: customerTarget,
        type: config.customerType,
      }),
    );
  }

  try {
    await Promise.all(writes);
  } catch (error) {
    console.warn("Shop order status fallback notification write failed", error);
    throw new Error(`Failed to send Shop Here ${config.statusLabel} notifications.`);
  }
}
