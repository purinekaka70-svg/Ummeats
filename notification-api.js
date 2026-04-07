export async function dispatchOrderNotification(orderId, type = "order", details = {}) {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    return false;
  }

  try {
    const response = await fetch("/api/send-order-notification", {
      body: JSON.stringify({
        customerId: String(details.customerId || "").trim() || undefined,
        hotelId: String(details.hotelId || "").trim() || undefined,
        orderId: normalizedOrderId,
        type,
      }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result?.error || `Notification dispatch failed with ${response.status}.`;
      throw new Error(message);
    }

    if (result?.ok === false) {
      throw new Error(result.error || "Notification dispatch failed.");
    }

    return true;
  } catch (error) {
    console.warn("Order notification dispatch failed", error);
    return false;
  }
}
