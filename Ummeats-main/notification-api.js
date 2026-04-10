const NOTIFICATION_DISPATCH_FALLBACK_URL = "https://ummeats.vercel.app/api/send-order-notification";

async function postNotificationDispatch(url, payload) {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    keepalive: true,
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
}

export async function dispatchOrderNotification(orderId, type = "order", details = {}) {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    return false;
  }

  const payload = {
    customerId: String(details.customerId || "").trim() || undefined,
    hotelId: String(details.hotelId || "").trim() || undefined,
    orderId: normalizedOrderId,
    type,
  };
  const dispatchUrls = [new URL("/api/send-order-notification", window.location.origin).href];
  if (!dispatchUrls.includes(NOTIFICATION_DISPATCH_FALLBACK_URL)) {
    dispatchUrls.push(NOTIFICATION_DISPATCH_FALLBACK_URL);
  }

  try {
    for (const url of dispatchUrls) {
      try {
        await postNotificationDispatch(url, payload);
        return true;
      } catch (error) {
        if (url === dispatchUrls.at(-1)) {
          throw error;
        }
      }
    }
  } catch (error) {
    console.warn("Order notification dispatch failed", error);
    return false;
  }
}
