import { addDoc, collection } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { dispatchOrderNotification } from "./notification-api.js";

export async function notifyPaidOrderStatus(order, hotelName) {
  const normalizedHotelName = String(hotelName || "selected hotel").trim() || "selected hotel";
  const customerName = String(order.customerName || "A customer").trim() || "A customer";
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

  await Promise.all(writes);

  if (order.id) {
    await dispatchOrderNotification(order.id, "order_paid", {
      customerId: order.customerId,
      hotelId: order.hotelId,
    });
  }
}
