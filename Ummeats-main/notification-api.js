export async function dispatchOrderNotification(orderId, type = "order", details = {}) {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    return false;
  }

  try {
    const response = await fetch("./api/send-order-notification", {
      body: JSON.stringify({
        customerId: String(details.customerId || "").trim() || undefined,
        hotelId: String(details.hotelId || "").trim() || undefined,
        orderId: normalizedOrderId,
        type,
      }),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Notification dispatch failed with ${response.status}.`);
    }

    return true;
  } catch (error) {
    console.warn("Order notification dispatch failed", error);
    return false;
  }
}
