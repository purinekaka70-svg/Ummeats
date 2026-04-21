const {
  admin,
  getFirestore,
  getOneSignalAppId,
  getSiteUrl,
  sendJson,
  sendPushMessage,
} = require("./_lib/push");
const COUNTY_NAMES = [
  "Baringo",
  "Bomet",
  "Bungoma",
  "Busia",
  "Elgeyo-Marakwet",
  "Embu",
  "Garissa",
  "Homa Bay",
  "Isiolo",
  "Kajiado",
  "Kakamega",
  "Kericho",
  "Kiambu",
  "Kilifi",
  "Kirinyaga",
  "Kisii",
  "Kisumu",
  "Kitui",
  "Kwale",
  "Laikipia",
  "Lamu",
  "Machakos",
  "Makueni",
  "Mandera",
  "Marsabit",
  "Meru",
  "Migori",
  "Mombasa",
  "Murang'a",
  "Nairobi",
  "Nakuru",
  "Nandi",
  "Narok",
  "Nyamira",
  "Nyandarua",
  "Nyeri",
  "Samburu",
  "Siaya",
  "Taita-Taveta",
  "Tana River",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Turkana",
  "Uasin Gishu",
  "Vihiga",
  "Wajir",
  "West Pokot",
];
const COUNTY_TEXT_ALIAS_MAP = {
  kajiado: [
    "kajiado",
    "kaijiado",
    "around umma university",
    "umma university",
    "my qwetu residence",
    "kajiado town",
    "kajiado cbd",
  ],
};

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

function normalizeCountyKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCountyFromText(value) {
  const normalizedValue = normalizeCountyKey(value);
  if (!normalizedValue) {
    return "";
  }

  for (const [countyKey, aliases] of Object.entries(COUNTY_TEXT_ALIAS_MAP)) {
    if (aliases.some((alias) => normalizedValue.includes(normalizeCountyKey(alias)))) {
      return COUNTY_NAMES.find((item) => normalizeCountyKey(item) === countyKey) || countyKey;
    }
  }

  for (const county of COUNTY_NAMES) {
    if (normalizedValue.includes(normalizeCountyKey(county))) {
      return county;
    }
  }

  return "";
}

function normalizeCounty(value) {
  const detectedCounty = detectCountyFromText(value);
  return normalizeCountyKey(detectedCounty || value);
}

function sanitizeNotificationKeyPart(value) {
  return String(value || "").trim().replace(/\//g, "_").slice(0, 400);
}

function buildNotificationDocId({ refId, to, type }) {
  const normalizedTo = sanitizeNotificationKeyPart(to);
  const normalizedType = sanitizeNotificationKeyPart(type).toLowerCase();
  const normalizedRefId = sanitizeNotificationKeyPart(refId);

  if (!normalizedTo || !normalizedType || !normalizedRefId) {
    return "";
  }

  return `${normalizedTo}__${normalizedType}__${normalizedRefId}`;
}

function buildWhatsAppLink(phone, message) {
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  if (!cleanPhone) {
    return "";
  }

  let formattedPhone = cleanPhone;
  if (cleanPhone.startsWith("0") && cleanPhone.length >= 10) {
    formattedPhone = `254${cleanPhone.slice(1)}`;
  } else if (cleanPhone.length === 9 && (cleanPhone.startsWith("7") || cleanPhone.startsWith("1"))) {
    formattedPhone = `254${cleanPhone}`;
  }

  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(String(message || "").trim())}`;
}

async function writeNotification(firestore, payload) {
  const data = {
    message: String(payload.message || "Notification"),
    read: false,
    ...(payload.refId ? { refId: String(payload.refId) } : {}),
    timestamp: payload.timestamp || nowTimestamp(),
    to: String(payload.to || "").trim(),
    type: String(payload.type || "order").trim(),
    ...(payload.waLink ? { waLink: String(payload.waLink) } : {}),
    ...(payload.waLabel ? { waLabel: String(payload.waLabel) } : {}),
  };

  const docId = buildNotificationDocId({
    refId: payload.refId,
    to: payload.to,
    type: payload.type,
  });

  if (docId) {
    await firestore.collection("notifications").doc(docId).set(data, { merge: true });
    return;
  }

  await firestore.collection("notifications").add(data);
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

function buildTagOrFilter(key, values) {
  const normalizedKey = String(key || "").trim();
  const normalizedValues = [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];

  if (!normalizedKey || !normalizedValues.length) {
    return [];
  }

  return normalizedValues.flatMap((value, index) => [
    ...(index > 0 ? [{ operator: "OR" }] : []),
    {
      field: "tag",
      key: normalizedKey,
      relation: "=",
      value,
    },
  ]);
}

function matchesEmployeeCounty(text, county) {
  const normalizedText = normalizeCountyKey(text);
  const normalizedCounty = normalizeCounty(county);

  if (!normalizedText || !normalizedCounty) {
    return false;
  }

  const detectedTextCounty = normalizeCounty(detectCountyFromText(text));
  if (detectedTextCounty) {
    return detectedTextCounty === normalizedCounty;
  }

  return normalizedText.includes(normalizedCounty);
}

function buildEmployeeAliasTargets(employees) {
  return [...new Set((Array.isArray(employees) ? employees : []).map((item) => String(item?.id || "").trim()).filter(Boolean))];
}

function buildEmployeeCountyTargets(employees) {
  return [...new Set(
    (Array.isArray(employees) ? employees : [])
      .map((item) => normalizeCounty(item?.normalizedCounty || item?.county))
      .filter(Boolean),
  )];
}

function buildEmployeePushFilterSets(employees) {
  const filterSets = [
    buildTagOrFilter("notification_target", buildEmployeeAliasTargets(employees)),
    buildTagOrFilter("employee_county", buildEmployeeCountyTargets(employees)),
  ].filter((filters) => Array.isArray(filters) && filters.length);

  return filterSets;
}

function buildOrderEmployeeMatchSources(order, hotelLocation = "") {
  return [
    order?.deliveryCounty,
    order?.normalizedDeliveryCounty,
    order?.customerCounty,
    order?.normalizedCustomerCounty,
    order?.county,
    order?.normalizedCounty,
    order?.hotelCounty,
    order?.normalizedHotelCounty,
    order?.customerArea,
    order?.customerSpecificArea,
    hotelLocation,
  ].filter(Boolean);
}

function buildShopEmployeeMatchSources(order) {
  return [
    order?.county,
    order?.normalizedCounty,
    order?.location,
    order?.shopName,
  ].filter(Boolean);
}

async function getMatchingEmployees(firestore, text) {
  const sources = (Array.isArray(text) ? text : [text])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!sources.length) {
    return [];
  }

  const normalizedText = sources.join(" ");
  const candidateCountyKeys = [...new Set(
    sources
      .map((item) => normalizeCounty(detectCountyFromText(item)))
      .filter(Boolean),
  )];

  const snapshot = await firestore.collection("employees").get();
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((employee) => String(employee.status || "active").trim().toLowerCase() !== "blocked")
    .filter((employee) => {
      const employeeCounty = normalizeCounty(employee.normalizedCounty || employee.county);
      if (!employeeCounty) {
        return false;
      }

      if (candidateCountyKeys.length) {
        return candidateCountyKeys.includes(employeeCounty);
      }

      return matchesEmployeeCounty(normalizedText, employeeCounty);
    });
}

async function writeEmployeeNotifications({ employees, firestore, message, refId, timestamp, type }) {
  const writes = (Array.isArray(employees) ? employees : []).map((employee) =>
    writeNotification(firestore, {
      message,
      refId,
      timestamp,
      to: employee.id,
      type,
    }),
  );

  if (writes.length) {
    await Promise.all(writes);
  }

  return writes.length;
}

/**
 * Helper to handle the common pattern of checking a dispatch flag, 
 * sending a push notification, and updating the document.
 */
async function tryDispatchPush({ order, field, updates, ...pushParams }) {
  if (order[field]) return 0;
  const sent = await sendPushWithFallbackTargets(pushParams);
  if (sent) {
    updates[field] = admin.firestore.FieldValue.serverTimestamp();
    return 1;
  }
  return 0;
}

/**
 * Helper to handle the common pattern of checking a dispatch flag,
 * writing an in-app notification, and updating the document.
 */
async function tryDispatchInApp({ firestore, order, field, updates, ...notifyParams }) {
  if (order[field]) return 0;
  await writeNotification(firestore, { ...notifyParams, timestamp: nowTimestamp() });
  updates[field] = admin.firestore.FieldValue.serverTimestamp();
  return 1;
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

async function sendPushWithFallbackTargets({ aliasTargets = [], appId, body, data = null, filterSets = [], title, url }) {
  const normalizedAliases = [...new Set(aliasTargets.map((item) => String(item || "").trim()).filter(Boolean))];
  if (normalizedAliases.length) {
    const aliasSent = await trySendPush({
      aliases: normalizedAliases,
      appId,
      body,
      ...(data && typeof data === "object" ? { data } : {}),
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
      ...(data && typeof data === "object" ? { data } : {}),
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
  const customerPhone = String(order.customerPhone || "").trim();
  const targetCustomerId = String(order.customerId || "").trim();
  const targetHotelId = String(order.hotelId || hotelId || "").trim();
  let hotelName = "selected hotel";
  let hotelLocation = "";
  let hotelPhone = "";

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      const hotelData = hotelSnapshot.data() || {};
      hotelName = String(hotelData.name || hotelName);
      hotelLocation = String(hotelData.location || "").trim();
      hotelPhone = String(hotelData.phone || "").trim();
    }
  }

  const orderMessage = `${customerName} placed an order for ${hotelName}.`;
  const employeeMessage = `${customerName} placed a hotel order for ${hotelName}.`;
  const timestamp = nowTimestamp();
  const customerMessage = `Order placed for ${hotelName}.`;
  let sentInApp = 0;
  let sentPush = 0;
  let matchingEmployees = null;

  const customerWhatsAppLink = hotelPhone
    ? buildWhatsAppLink(
      hotelPhone,
      `Hello ${hotelName}, I placed an order (${orderId}). Name: ${customerName}. Phone: ${customerPhone || "N/A"}.`,
    )
    : "";

  const hotelWhatsAppLink = customerPhone
    ? buildWhatsAppLink(
      customerPhone,
      `Hello ${customerName}, we received your order (${orderId}) for ${hotelName}. We will update you shortly.`,
    )
    : "";

  const adminWhatsAppLink = hotelPhone
    ? buildWhatsAppLink(
      hotelPhone,
      `New order (${orderId}) placed for ${hotelName}. Customer: ${customerName} (${customerPhone || "N/A"}). Please confirm on the admin dashboard.`,
    )
    : "";

  if (!order.notificationAdminDispatchedAt) {
    await writeNotification(firestore, {
      message: orderMessage,
      refId: orderId,
      timestamp,
      to: "admin",
      type: "order",
      ...(adminWhatsAppLink ? { waLabel: `WhatsApp ${hotelName}`, waLink: adminWhatsAppLink } : {}),
    });
    updates.notificationAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.notificationEmployeesDispatchedAt) {
    await writeNotification(firestore, {
      message: orderMessage,
      refId: orderId,
      timestamp,
      to: "employees",
      type: "order",
    });
    updates.notificationEmployeesDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (targetHotelId && !order.notificationHotelDispatchedAt) {
    await writeNotification(firestore, {
      message: orderMessage,
      refId: orderId,
      timestamp,
      to: targetHotelId,
      type: "order",
      ...(hotelWhatsAppLink ? { waLabel: `WhatsApp ${customerName}`, waLink: hotelWhatsAppLink } : {}),
    });
    updates.notificationHotelDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (targetCustomerId && !order.notificationCustomerDispatchedAt) {
    await writeNotification(firestore, {
      message: customerMessage,
      refId: orderId,
      timestamp,
      to: targetCustomerId,
      type: "order",
      ...(customerWhatsAppLink ? { waLabel: `WhatsApp ${hotelName}`, waLink: customerWhatsAppLink } : {}),
    });
    updates.notificationCustomerDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.notificationEmployeeDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildOrderEmployeeMatchSources(order, hotelLocation),
    );

    if (matchingEmployees.length) {
      sentInApp += await writeEmployeeNotifications({
        employees: matchingEmployees,
        firestore,
        message: employeeMessage,
        refId: orderId,
        timestamp,
        type: "order",
      });
      updates.notificationEmployeeDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  if (!order.onesignalAdminDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: orderMessage,
        data: { refId: orderId, type: "order" },
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
        data: { refId: orderId, type: "order" },
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

  if (targetCustomerId && !order.onesignalCustomerDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetCustomerId],
        appId,
        body: customerMessage,
        data: { refId: orderId, type: "order" },
        filterSets: [
          buildTagEqualsFilter("customer_id", targetCustomerId),
          buildTagEqualsFilter("notification_target", targetCustomerId),
        ],
        title: "Order placed",
        url: `${siteUrl}/index.html`,
      })
    ) {
      updates.onesignalCustomerDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (!order.onesignalEmployeeDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildOrderEmployeeMatchSources(order, hotelLocation),
    );

    if (
      matchingEmployees.length &&
      await sendPushWithFallbackTargets({
        aliasTargets: buildEmployeeAliasTargets(matchingEmployees),
        appId,
        body: employeeMessage,
        data: { refId: orderId, type: "order" },
        filterSets: buildEmployeePushFilterSets(matchingEmployees),
        title: "New hotel order",
        url: `${siteUrl}/employee.html`,
      })
    ) {
      updates.onesignalEmployeeDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += matchingEmployees.length;
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
  let matchingEmployees = null;

  if (!order.notificationAdminDispatchedAt) {
    await writeNotification(firestore, {
      message,
      refId: orderId,
      timestamp,
      to: "admin",
      type: "umma-shop-order",
    });
    updates.notificationAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.notificationEmployeeDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildShopEmployeeMatchSources(order),
    );

    if (matchingEmployees.length) {
      sentInApp += await writeEmployeeNotifications({
        employees: matchingEmployees,
        firestore,
        message,
        refId: orderId,
        timestamp,
        type: "umma-shop-order",
      });
      updates.notificationEmployeeDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  if (!order.onesignalAdminDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: message,
        data: { refId: orderId, type: "umma-shop-order" },
        filterSets: [buildTagEqualsFilter("notification_target", "admin"), buildTagEqualsFilter("role", "admin")],
        title: "New Shop Here order",
        url: `${siteUrl}/umma-shop.html`,
      })
    ) {
      updates.onesignalAdminDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (!order.onesignalEmployeeDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildShopEmployeeMatchSources(order),
    );

    if (
      matchingEmployees.length &&
      await sendPushWithFallbackTargets({
        aliasTargets: buildEmployeeAliasTargets(matchingEmployees),
        appId,
        body: message,
        data: { refId: orderId, type: "umma-shop-order" },
        filterSets: buildEmployeePushFilterSets(matchingEmployees),
        title: "New Shop Here order",
        url: `${siteUrl}/employee.html`,
      })
    ) {
      updates.onesignalEmployeeDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += matchingEmployees.length;
    }
  }

  if (Object.keys(updates).length) {
    await orderRef.update(updates);
  }

  return { ok: true, sentInApp, sentPush, statusCode: 200 };
}

function resolveShopStatusConfig(statusType) {
  const normalized = String(statusType || "").trim().toLowerCase();
  if (normalized === "delivered") {
    return {
      adminInAppField: "notificationAdminDeliveredDispatchedAt",
      adminPushField: "onesignalAdminDeliveredDispatchedAt",
      customerInAppField: "notificationCustomerDeliveredDispatchedAt",
      customerPushField: "onesignalCustomerDeliveredDispatchedAt",
      employeeInAppField: "notificationEmployeeDeliveredDispatchedAt",
      employeePushField: "onesignalEmployeeDeliveredDispatchedAt",
      customerType: "umma-shop-order-delivered",
      label: "delivered",
      title: "Shop Here order marked as delivered",
    };
  }

  return {
    adminInAppField: "notificationAdminPaidDispatchedAt",
    adminPushField: "onesignalAdminPaidDispatchedAt",
    customerInAppField: "notificationCustomerPaidDispatchedAt",
    customerPushField: "onesignalCustomerPaidDispatchedAt",
    employeeInAppField: "notificationEmployeePaidDispatchedAt",
    employeePushField: "onesignalEmployeePaidDispatchedAt",
    customerType: "umma-shop-order-paid",
    label: "paid",
    title: "Shop Here order marked as paid",
  };
}

async function dispatchShopOrderStatus({
  appId,
  customerId,
  firestore,
  orderId,
  siteUrl,
  statusType,
}) {
  const orderRef = firestore.collection("ummaShopOrders").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    return { error: "Shop order not found.", statusCode: 404 };
  }

  const config = resolveShopStatusConfig(statusType);
  const order = orderSnapshot.data() || {};
  const updates = {};
  const customerName = String(order.customerName || "A customer");
  const shopName = String(order.shopName || "Around Umma University");
  const targetCustomerId = String(order.customerEmail || customerId || "").trim();
  const customerMessage = `Your Shop Here order for ${shopName} has been marked as ${config.label}.`;
  const adminMessage = `Shop Here order for ${customerName} at ${shopName} has been marked as ${config.label}.`;
  const timestamp = nowTimestamp();
  let sentInApp = 0;
  let sentPush = 0;
  let matchingEmployees = null;

  if (targetCustomerId && !order[config.customerInAppField]) {
    await writeNotification(firestore, {
      message: customerMessage,
      refId: orderId,
      timestamp,
      to: targetCustomerId,
      type: config.customerType,
    });
    updates[config.customerInAppField] = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order[config.adminInAppField]) {
    await writeNotification(firestore, {
      message: adminMessage,
      refId: orderId,
      timestamp,
      to: "admin",
      type: config.customerType,
    });
    updates[config.adminInAppField] = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order[config.employeeInAppField]) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildShopEmployeeMatchSources(order),
    );

    if (matchingEmployees.length) {
      sentInApp += await writeEmployeeNotifications({
        employees: matchingEmployees,
        firestore,
        message: adminMessage,
        refId: orderId,
        timestamp,
        type: config.customerType,
      });
      updates[config.employeeInAppField] = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  if (targetCustomerId && !order[config.customerPushField]) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetCustomerId],
        appId,
        body: customerMessage,
        data: { refId: orderId, type: config.customerType },
        filterSets: [
          buildTagEqualsFilter("customer_id", targetCustomerId),
          buildTagEqualsFilter("notification_target", targetCustomerId),
        ],
        title: config.title,
        url: `${siteUrl}/umma-shop.html`,
      })
    ) {
      updates[config.customerPushField] = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (!order[config.adminPushField]) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: ["admin"],
        appId,
        body: adminMessage,
        data: { refId: orderId, type: config.customerType },
        filterSets: [buildTagEqualsFilter("notification_target", "admin"), buildTagEqualsFilter("role", "admin")],
        title: config.title,
        url: `${siteUrl}/umma-shop.html`,
      })
    ) {
      updates[config.adminPushField] = admin.firestore.FieldValue.serverTimestamp();
      sentPush += 1;
    }
  }

  if (!order[config.employeePushField]) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildShopEmployeeMatchSources(order),
    );

    if (
      matchingEmployees.length &&
      await sendPushWithFallbackTargets({
        aliasTargets: buildEmployeeAliasTargets(matchingEmployees),
        appId,
        body: adminMessage,
        data: { refId: orderId, type: config.customerType },
        filterSets: buildEmployeePushFilterSets(matchingEmployees),
        title: config.title,
        url: `${siteUrl}/employee.html`,
      })
    ) {
      updates[config.employeePushField] = admin.firestore.FieldValue.serverTimestamp();
      sentPush += matchingEmployees.length;
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
  let hotelLocation = "";

  if (targetHotelId) {
    const hotelSnapshot = await firestore.collection("hotels").doc(targetHotelId).get();
    if (hotelSnapshot.exists) {
      const hotelData = hotelSnapshot.data() || {};
      hotelName = String(hotelData.name || hotelName);
      hotelLocation = String(hotelData.location || "").trim();
    }
  }

  const customerMessage = `Your order for ${hotelName} has been marked as paid.`;
  const adminHotelMessage = `Order for ${customerName} at ${hotelName} has been marked as paid.`;
  const timestamp = nowTimestamp();
  let sentInApp = 0;
  let sentPush = 0;
  let matchingEmployees = null;

  if (targetCustomerId && !order.notificationCustomerPaidDispatchedAt) {
    await writeNotification(firestore, {
      message: customerMessage,
      refId: orderId,
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
      refId: orderId,
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
      refId: orderId,
      timestamp,
      to: targetHotelId,
      type: "order-paid",
    });
    updates.notificationHotelPaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    sentInApp += 1;
  }

  if (!order.notificationEmployeePaidDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildOrderEmployeeMatchSources(order, hotelLocation),
    );

    if (matchingEmployees.length) {
      sentInApp += await writeEmployeeNotifications({
        employees: matchingEmployees,
        firestore,
        message: adminHotelMessage,
        refId: orderId,
        timestamp,
        type: "order-paid",
      });
      updates.notificationEmployeePaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  if (targetCustomerId && !order.onesignalCustomerPaidDispatchedAt) {
    if (
      await sendPushWithFallbackTargets({
        aliasTargets: [targetCustomerId],
        appId,
        body: customerMessage,
        data: { refId: orderId, type: "order-paid" },
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
        data: { refId: orderId, type: "order-paid" },
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
        data: { refId: orderId, type: "order-paid" },
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

  if (!order.onesignalEmployeePaidDispatchedAt) {
    matchingEmployees = matchingEmployees || await getMatchingEmployees(
      firestore,
      buildOrderEmployeeMatchSources(order, hotelLocation),
    );

    if (
      matchingEmployees.length &&
      await sendPushWithFallbackTargets({
        aliasTargets: buildEmployeeAliasTargets(matchingEmployees),
        appId,
        body: adminHotelMessage,
        data: { refId: orderId, type: "order-paid" },
        filterSets: buildEmployeePushFilterSets(matchingEmployees),
        title: "Order marked as paid",
        url: `${siteUrl}/employee.html`,
      })
    ) {
      updates.onesignalEmployeePaidDispatchedAt = admin.firestore.FieldValue.serverTimestamp();
      sentPush += matchingEmployees.length;
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
    } else if (type === "umma-shop-paid" || type === "umma_shop_paid") {
      result = await dispatchShopOrderStatus({
        appId,
        customerId,
        firestore,
        orderId,
        siteUrl,
        statusType: "paid",
      });
    } else if (type === "umma-shop-delivered" || type === "umma_shop_delivered") {
      result = await dispatchShopOrderStatus({
        appId,
        customerId,
        firestore,
        orderId,
        siteUrl,
        statusType: "delivered",
      });
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
