import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { auth, db } from "./firebase.js";
import { formatTime, inferToastTone } from "./helpers.js";
import {
  claimNotificationTag,
  registerPushSubscription,
  showBrowserNotification,
  unregisterPushSubscription,
} from "./push.js";
import { notifyPaidOrderStatus, notifyShopOrderStatus } from "./order-status-notifications.js";
import { ensureAdminAccessStatus, getCurrentIdToken } from "./security.js";
import { getRestaurantByHotelId, state } from "./state.js";
import { showToast } from "./ui.js";
import { renderAdmin } from "./view-admin.js";

const adminNotificationAlertTracker = {
  ids: new Set(),
  ready: false,
};
const ADMIN_API_FALLBACK_ORIGIN = "https://ummeats.vercel.app";
const adminNotificationPromptButton = document.getElementById("adminNotificationPromptButton");
let adminCollectionUnsubscribers = [];
const employeeIdCardCache = new Map();

bootstrap();

function buildAdminApiUrls(pathname) {
  const normalizedPath = String(pathname || "").trim();
  if (!normalizedPath) {
    return [];
  }

  const urls = [new URL(normalizedPath, window.location.origin).href];
  const fallbackUrl = new URL(normalizedPath, ADMIN_API_FALLBACK_ORIGIN).href;
  if (!urls.includes(fallbackUrl)) {
    urls.push(fallbackUrl);
  }

  return urls;
}

async function postAdminJson(pathname, payload = {}) {
  const idToken = await getCurrentIdToken();
  if (!idToken) {
    throw new Error("Login as admin first.");
  }

  const urls = buildAdminApiUrls(pathname);
  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        body: JSON.stringify(payload),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || `Request failed with ${response.status}.`);
      }

      return result || {};
    } catch (error) {
      errors.push(`${url} -> ${String(error?.message || "Request failed").trim()}`);
    }
  }

  throw new Error(errors.join(" | ") || "Request failed.");
}

async function fetchEmployeeIdCardFile(employeeId) {
  const normalizedEmployeeId = String(employeeId || "").trim();
  if (!normalizedEmployeeId) {
    throw new Error("Employee ID is missing.");
  }

  if (employeeIdCardCache.has(normalizedEmployeeId)) {
    return employeeIdCardCache.get(normalizedEmployeeId);
  }

  const result = await postAdminJson("/api/admin-employee-id-card", {
    employeeId: normalizedEmployeeId,
  });
  employeeIdCardCache.set(normalizedEmployeeId, result);
  return result;
}

function decodeBase64ToBytes(base64Value) {
  const normalizedValue = String(base64Value || "").trim();
  const binary = window.atob(normalizedValue);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildPdfBlobUrlFromBase64(base64Value, mimeType = "application/pdf") {
  const bytes = decodeBase64ToBytes(base64Value);
  const blob = new Blob([bytes], { type: mimeType || "application/pdf" });
  return URL.createObjectURL(blob);
}

function sanitizeDownloadFileName(value, fallback = "document.pdf") {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || fallback;
}

async function openEmployeeIdCard(employeeId, directUrl = "") {
  const normalizedDirectUrl = String(directUrl || "").trim();
  if (normalizedDirectUrl) {
    window.open(normalizedDirectUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const file = await fetchEmployeeIdCardFile(employeeId);
  const blobUrl = buildPdfBlobUrlFromBase64(file.base64, file.mimeType);
  const openedWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

  if (!openedWindow) {
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.click();
  }

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);
}

async function downloadEmployeeIdCard(employeeId, directUrl = "") {
  const normalizedDirectUrl = String(directUrl || "").trim();
  if (normalizedDirectUrl) {
    const anchor = document.createElement("a");
    anchor.download = sanitizeDownloadFileName(`${employeeId}-id-card.pdf`, `${employeeId}-id-card.pdf`);
    anchor.href = normalizedDirectUrl;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.click();
    return;
  }

  const file = await fetchEmployeeIdCardFile(employeeId);
  const blobUrl = buildPdfBlobUrlFromBase64(file.base64, file.mimeType);
  const anchor = document.createElement("a");
  anchor.download = sanitizeDownloadFileName(file.fileName, `${employeeId}-id-card.pdf`);
  anchor.href = blobUrl;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);
}

function normalizePdfText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfString(value) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfLine(value, maxChars = 92) {
  const normalizedValue = normalizePdfText(value);
  if (!normalizedValue) {
    return [""];
  }

  const words = normalizedValue.split(" ");
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxChars) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (word.length <= maxChars) {
      currentLine = word;
      return;
    }

    let remainingWord = word;
    while (remainingWord.length > maxChars) {
      lines.push(remainingWord.slice(0, maxChars));
      remainingWord = remainingWord.slice(maxChars);
    }
    currentLine = remainingWord;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [""];
}

function buildAdminExportSections() {
  const hotels = [...state.hotels].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  const orders = [...state.orders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const shopOrders = [...state.ummaShopOrders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const feedbacks = [...state.feedbacks].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const employees = [...state.employees].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const notifications = [...state.notifications].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));

  return [
    {
      lines: [
        `Generated: ${normalizePdfText(new Date().toLocaleString("en-KE", { hour12: false }))}`,
        `Hotels: ${hotels.length}`,
        `Orders: ${orders.length}`,
        `Shop Here Orders: ${shopOrders.length}`,
        `Employees: ${employees.length}`,
        `Feedbacks: ${feedbacks.length}`,
        `Notifications: ${notifications.length}`,
      ],
      title: "Platform Summary",
    },
    {
      lines: hotels.length
        ? hotels.map((hotel) => [
          `Hotel: ${hotel.name || "Unknown hotel"}`,
          `Phone: ${hotel.phone || "N/A"}`,
          `County: ${hotel.county || "N/A"}`,
          `Location: ${hotel.location || "Around Umma University"}`,
          `Approved: ${hotel.approved ? "Yes" : "No"} | Blocked: ${hotel.blocked ? "Yes" : "No"}`,
          `Subscription Expiry: ${hotel.subscriptionExpiry ? formatTime(hotel.subscriptionExpiry) : "Not set"}`,
        ].join(" | "))
        : ["No hotel records available."],
      title: "Hotels",
    },
    {
      lines: orders.length
        ? orders.map((order) => {
          const items = Array.isArray(order.items) ? order.items : [];
          const itemSummary = items.length
            ? items.map((item) => `${item.qty || 1}x ${item.name || "Item"}`).join(", ")
            : "No items";
          return [
            `Customer: ${order.customerName || "Unknown customer"}`,
            `Hotel ID: ${order.hotelId || "N/A"}`,
            `Status: ${order.status || "Pending"}`,
            `County: ${order.deliveryCounty || order.county || order.customerCounty || order.hotelCounty || "N/A"}`,
            `Area: ${order.customerArea || "N/A"}`,
            `Total: ${order.total || 0}`,
            `Created: ${order.createdAt ? formatTime(order.createdAt) : "N/A"}`,
            `Items: ${itemSummary}`,
          ].join(" | ");
        })
        : ["No order records available."],
      title: "Hotel Orders",
    },
    {
      lines: shopOrders.length
        ? shopOrders.map((order) => {
          const items = Array.isArray(order.items) ? order.items : [];
          const itemSummary = items.length
            ? items.map((item) => `${item.qty || 1}x ${item.name || "Item"}`).join(", ")
            : "No items";
          return [
            `Customer: ${order.customerName || "Unknown customer"}`,
            `Email: ${order.customerEmail || "N/A"}`,
            `Shop: ${order.shopName || "N/A"}`,
            `County: ${order.county || "N/A"}`,
            `Paid: ${order.paid ? "Yes" : "No"} | Delivered: ${order.delivered ? "Yes" : "No"}`,
            `Amount: ${order.totalAmount || 0}`,
            `Created: ${order.createdAt ? formatTime(order.createdAt) : "N/A"}`,
            `Items: ${itemSummary}`,
          ].join(" | ");
        })
        : ["No Shop Here order records available."],
      title: "Shop Here Orders",
    },
    {
      lines: employees.length
        ? employees.map((employee) => [
          `Employee: ${employee.fullName || "Unknown employee"}`,
          `Employee Record ID: ${employee.id || "N/A"}`,
          `Employee UID: ${employee.uid || employee.id || "N/A"}`,
          `Email: ${employee.email || "N/A"}`,
          `County: ${employee.county || "N/A"}`,
          `ID Number: ${employee.idNumber || "N/A"}`,
          `ID PDF: ${employee.idCardUploaded || employee.idCardDatabasePath || employee.idCardUrl ? "Uploaded" : "Missing"}`,
          `Created: ${employee.createdAt ? formatTime(employee.createdAt) : "N/A"}`,
        ].join(" | "))
        : ["No employee records available."],
      title: "Employees",
    },
    {
      lines: feedbacks.length
        ? feedbacks.map((feedback) => [
          `Name: ${feedback.name || "Anonymous"}`,
          `Phone: ${feedback.phone || "N/A"}`,
          `Status: ${feedback.status || "New"}`,
          `Created: ${feedback.createdAt ? formatTime(feedback.createdAt) : "N/A"}`,
          `Message: ${feedback.message || "No message"}`,
        ].join(" | "))
        : ["No feedback records available."],
      title: "Feedbacks",
    },
    {
      lines: notifications.length
        ? notifications.map((notification) => [
          `Type: ${notification.type || "notification"}`,
          `Target: ${notification.to || "N/A"}`,
          `Read: ${notification.read ? "Yes" : "No"}`,
          `Time: ${notification.timestamp ? formatTime(notification.timestamp) : "N/A"}`,
          `Message: ${notification.message || "Notification"}`,
        ].join(" | "))
        : ["No notification records available."],
      title: "Notifications",
    },
  ];
}

function buildEmployeeIdExportSections() {
  const employees = [...state.employees].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const employeesWithIds = employees.filter((employee) => Boolean(
    employee.idCardUploaded || employee.idCardDatabasePath || employee.idCardUrl,
  ));

  return [
    {
      lines: [
        `Generated: ${normalizePdfText(new Date().toLocaleString("en-KE", { hour12: false }))}`,
        `Employees with ID PDFs: ${employeesWithIds.length}`,
        `Total employees: ${employees.length}`,
      ],
      title: "Employee ID Summary",
    },
    {
      lines: employeesWithIds.length
        ? employeesWithIds.map((employee) => [
          `Employee: ${employee.fullName || "Unknown employee"}`,
          `Employee Record ID: ${employee.id || "N/A"}`,
          `Employee UID: ${employee.uid || employee.id || "N/A"}`,
          `Email: ${employee.email || "N/A"}`,
          `County: ${employee.county || "N/A"}`,
          `ID Number: ${employee.idNumber || "N/A"}`,
          `PDF File: ${employee.idCardFileName || "Stored as secure PDF"}`,
          `PDF Source: ${employee.idCardDatabasePath || employee.idCardUrl || "Stored internally"}`,
          `Created: ${employee.createdAt ? formatTime(employee.createdAt) : "N/A"}`,
        ].join(" | "))
        : ["No employee ID PDFs available."],
      title: "Employee ID Records",
    },
  ];
}

function createPdfBlobFromSections(title, sections) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 40;
  const marginTop = 48;
  const fontSize = 10;
  const lineHeight = 14;
  const maxLinesPerPage = Math.floor((pageHeight - marginTop * 2) / lineHeight);
  const documentLines = [];

  documentLines.push(...wrapPdfLine(title, 90), "");
  sections.forEach((section) => {
    documentLines.push(...wrapPdfLine(section.title.toUpperCase(), 90));
    documentLines.push("");
    section.lines.forEach((line) => {
      documentLines.push(...wrapPdfLine(line, 90));
    });
    documentLines.push("", "");
  });

  const pages = [];
  for (let index = 0; index < documentLines.length; index += maxLinesPerPage) {
    pages.push(documentLines.slice(index, index + maxLinesPerPage));
  }

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const contentIds = pages.map((pageLines) => {
    const streamLines = [
      "BT",
      `/F1 ${fontSize} Tf`,
      `${marginLeft} ${pageHeight - marginTop} Td`,
      `${lineHeight} TL`,
    ];

    pageLines.forEach((line, lineIndex) => {
      streamLines.push(`(${escapePdfString(line)}) Tj`);
      if (lineIndex < pageLines.length - 1) {
        streamLines.push("T*");
      }
    });

    streamLines.push("ET");
    const stream = streamLines.join("\n");
    return addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const pagesTreeId = objects.length + pages.length + 1;
  const pageIds = contentIds.map((contentId) =>
    addObject(
      `<< /Type /Page /Parent ${pagesTreeId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    ));
  const actualPagesTreeId = addObject(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] >>`,
  );
  const catalogId = addObject(`<< /Type /Catalog /Pages ${actualPagesTreeId} 0 R >>`);

  let pdfContent = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((objectContent, objectIndex) => {
    offsets.push(pdfContent.length);
    pdfContent += `${objectIndex + 1} 0 obj\n${objectContent}\nendobj\n`;
  });

  const xrefOffset = pdfContent.length;
  pdfContent += `xref\n0 ${objects.length + 1}\n`;
  pdfContent += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdfContent += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdfContent += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdfContent], { type: "application/pdf" });
}

function downloadAllAdminDataPdf() {
  const title = `Tamu Express Admin Export - ${normalizePdfText(new Date().toLocaleDateString("en-KE"))}`;
  const sections = buildAdminExportSections();
  const blob = createPdfBlobFromSections(title, sections);
  const fileName = sanitizeDownloadFileName(
    `tamu-express-admin-export-${new Date().toISOString().slice(0, 10)}.pdf`,
    "tamu-express-admin-export.pdf",
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

function downloadEmployeeIdsPdf() {
  const title = `Tamu Express Employee IDs Export - ${normalizePdfText(new Date().toLocaleDateString("en-KE"))}`;
  const sections = buildEmployeeIdExportSections();
  const blob = createPdfBlobFromSections(title, sections);
  const fileName = sanitizeDownloadFileName(
    `tamu-express-employee-ids-${new Date().toISOString().slice(0, 10)}.pdf`,
    "tamu-express-employee-ids.pdf",
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

function escapeExportHtml(value) {
  return normalizePdfText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createWordDocumentHtml(title, sections) {
  const sectionMarkup = sections.map((section) => `
    <section style="margin-bottom:24px;">
      <h2 style="font-size:18px;margin:0 0 10px;">${escapeExportHtml(section.title)}</h2>
      <ul style="margin:0;padding-left:20px;">
        ${section.lines.map((line) => `<li style="margin:0 0 6px;">${escapeExportHtml(line)}</li>`).join("")}
      </ul>
    </section>
  `).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeExportHtml(title)}</title>
    </head>
    <body style="font-family:Calibri, Arial, sans-serif; color:#111827; line-height:1.45; padding:24px;">
      <h1 style="font-size:24px;margin:0 0 18px;">${escapeExportHtml(title)}</h1>
      ${sectionMarkup}
    </body>
    </html>
  `;
}

function downloadAllAdminDataWord() {
  const title = `Tamu Express Admin Export - ${normalizePdfText(new Date().toLocaleDateString("en-KE"))}`;
  const sections = buildAdminExportSections();
  const html = createWordDocumentHtml(title, sections);
  const fileName = sanitizeDownloadFileName(
    `tamu-express-admin-export-${new Date().toISOString().slice(0, 10)}.doc`,
    "tamu-express-admin-export.doc",
  );
  const blob = new Blob([html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

async function downloadAllEmployeeIdPdfs() {
  const employeesWithIds = [...state.employees]
    .filter((employee) => Boolean(employee.idCardUploaded || employee.idCardDatabasePath || employee.idCardUrl))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  if (!employeesWithIds.length) {
    showToast("No employee ID PDFs available to download.", "info");
    return;
  }

  if (!window.confirm(`Download ${employeesWithIds.length} employee ID PDF${employeesWithIds.length === 1 ? "" : "s"} now? Your browser may ask to allow multiple downloads.`)) {
    return;
  }

  let downloadedCount = 0;

  for (const employee of employeesWithIds) {
    try {
      await downloadEmployeeIdCard(employee.id, employee.idCardUrl || "");
      downloadedCount += 1;
    } catch (error) {
      console.warn("Bulk employee ID PDF download failed", employee.id, error);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }

  showToast(`Started ${downloadedCount} employee ID PDF download${downloadedCount === 1 ? "" : "s"}.`, downloadedCount ? "success" : "warn");
}

function bootstrap() {
  state.currentAdmin = false;
  state.adminAccessStatus = "signed_out";
  state.adminAccessMessage = "";
  state.adminUserEmail = "";
  state.adminPanelSection = "dashboard";
  state.adminSidebarOpen = false;
  bindEvents();
  bindPushSyncEvents();
  hydrateShell();
  subscribeToAuth();
  renderAdmin();
}

function stopAdminCollectionSubscriptions() {
  adminCollectionUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      // ignore
    }
  });
  adminCollectionUnsubscribers = [];

  state.hotels = [];
  state.restaurants = [];
  state.orders = [];
  state.ummaShopOrders = [];
  state.feedbacks = [];
  state.notifications = [];
  state.employees = [];
  adminNotificationAlertTracker.ids = new Set();
  adminNotificationAlertTracker.ready = false;
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);

  if (adminNotificationPromptButton) {
    adminNotificationPromptButton.addEventListener("click", handleAdminNotificationPromptClick);
  }
}

function bindPushSyncEvents() {
  window.addEventListener("focus", () => {
    syncAdminPushSubscription();
    updateAdminNotificationPromptButtonState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncAdminPushSubscription();
      updateAdminNotificationPromptButtonState();
    }
  });
}

function syncAdminPushSubscription() {
  const user = auth.currentUser;
  if (!user || !state.currentAdmin) {
    return;
  }

  void registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: false,
    role: "admin",
    silent: true,
  });
}

function hydrateShell() {
  const year = document.getElementById("year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  window.alert = (message) => {
    showToast(String(message ?? ""), inferToastTone(String(message ?? "")));
  };

  updateAdminNotificationPromptButtonState();
}

function getNotificationPermissionState() {
  if (!window.isSecureContext || typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

function setNotificationButtonVariant(button, variant) {
  button.classList.remove("button-primary", "button-outline", "button-danger-soft");
  button.classList.add(variant);
}

function updateAdminNotificationPromptButtonState() {
  if (!adminNotificationPromptButton) {
    return;
  }

  const permission = getNotificationPermissionState();

  if (!state.currentAdmin || permission === "unsupported" || permission === "granted") {
    adminNotificationPromptButton.classList.add("is-hidden");
    adminNotificationPromptButton.disabled = false;
    return;
  }

  adminNotificationPromptButton.classList.remove("is-hidden");
  adminNotificationPromptButton.disabled = false;

  if (permission === "denied") {
    adminNotificationPromptButton.textContent = "Notifications Blocked";
    adminNotificationPromptButton.setAttribute("aria-label", "Notifications are blocked in this browser");
    setNotificationButtonVariant(adminNotificationPromptButton, "button-danger-soft");
    return;
  }

  adminNotificationPromptButton.textContent = "Enable Notifications";
  adminNotificationPromptButton.setAttribute("aria-label", "Enable browser notifications for admin");
  setNotificationButtonVariant(adminNotificationPromptButton, "button-primary");
}

async function handleAdminNotificationPromptClick() {
  const permission = getNotificationPermissionState();
  if (permission === "unsupported") {
    showToast("This browser cannot enable web push notifications here.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  if (permission === "denied") {
    showToast("Notifications are blocked. Allow them in browser site settings, then refresh.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  const user = auth.currentUser;
  if (!state.currentAdmin || !user) {
    showToast("Login as admin first to enable notifications.", "warn");
    updateAdminNotificationPromptButtonState();
    return;
  }

  await registerPushSubscription("admin", user.email || "Admin", {
    requestPermission: true,
    role: "admin",
    silent: false,
  });
  updateAdminNotificationPromptButtonState();
}

function startAdminCollectionSubscriptions() {
  if (adminCollectionUnsubscribers.length) {
    return;
  }

  adminCollectionUnsubscribers = [
    onSnapshot(collection(db, "hotels"), (snapshot) => {
      state.hotels = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "restaurants"), (snapshot) => {
      state.restaurants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "orders"), (snapshot) => {
      state.orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "ummaShopOrders"), (snapshot) => {
      state.ummaShopOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "feedbacks"), (snapshot) => {
      state.feedbacks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "notifications"), (snapshot) => {
      handleAdminNotificationAlerts(snapshot);
      state.notifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
    onSnapshot(collection(db, "employees"), (snapshot) => {
      state.employees = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAdmin();
    }),
  ];
}

function subscribeToAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.currentAdmin = false;
      state.adminAccessStatus = "signed_out";
      state.adminAccessMessage = "";
      state.adminUserEmail = "";
      state.adminPanelSection = "dashboard";
      state.adminSidebarOpen = false;
      stopAdminCollectionSubscriptions();
      renderAdmin();
      updateAdminNotificationPromptButtonState();
      return;
    }

    state.adminUserEmail = String(user.email || "").trim();
    state.adminAccessStatus = "checking";
    state.adminAccessMessage = "";
    renderAdmin();

    const access = await getAdminAccessResult(user);
    const allowed = Boolean(access?.ok);
    state.currentAdmin = allowed;

    if (allowed) {
      state.adminAccessStatus = "approved";
      state.adminAccessMessage = "";
      startAdminCollectionSubscriptions();
      void registerPushSubscription("admin", user.email || "Admin", {
        requestPermission: false,
        role: "admin",
        silent: true,
      });
      renderAdmin();
      updateAdminNotificationPromptButtonState();
      return;
    }

    stopAdminCollectionSubscriptions();
    state.currentAdmin = false;
    state.adminPanelSection = "dashboard";
    state.adminSidebarOpen = false;

    if (access?.status === 403) {
      state.adminAccessStatus = "denied";
      state.adminAccessMessage = String(access?.error || "This account is not approved for admin access.").trim();
      await signOut(auth).catch(() => undefined);
      showToast("This account is not approved for admin access.", "warn");
    } else {
      state.adminAccessStatus = "error";
      state.adminAccessMessage = String(
        access?.error || "Unable to verify admin access right now. Check connection and try again.",
      ).trim();
      showToast("Unable to verify admin access right now. Check connection and try again.", "warn");
    }

    renderAdmin();
    updateAdminNotificationPromptButtonState();
  });
}

function resolveAdminNotificationTitle(item) {
  const normalizedType = String(item?.type || "").trim().toLowerCase();
  if (normalizedType === "order-paid" || normalizedType === "order_paid") {
    return "Order update";
  }

  if (normalizedType === "order") {
    return "New order received";
  }

  if (normalizedType === "hotel") {
    return "New hotel registration";
  }

  if (normalizedType === "employee") {
    return "New employee registration";
  }

  if (normalizedType === "umma-shop-order") {
    return "New Shop Here order";
  }

  if (normalizedType === "umma-shop-order-paid" || normalizedType === "umma_shop_order_paid") {
    return "Shop Here payment update";
  }

  if (normalizedType === "umma-shop-order-delivered" || normalizedType === "umma_shop_order_delivered") {
    return "Shop Here delivery update";
  }

  if (normalizedType === "feedback") {
    return "New feedback";
  }

  return "New notification";
}

function handleAdminNotificationAlerts(snapshot) {
  if (!auth.currentUser || !state.currentAdmin) {
    return;
  }

  const adminDocs = snapshot.docs.filter((docSnapshot) => String(docSnapshot.data()?.to || "").trim() === "admin");
  const currentIds = new Set(adminDocs.map((docSnapshot) => docSnapshot.id));
  const previousIds = adminNotificationAlertTracker.ids;

  if (!adminNotificationAlertTracker.ready) {
    adminNotificationAlertTracker.ready = true;
    adminNotificationAlertTracker.ids = currentIds;
    return;
  }

  snapshot.docChanges().forEach((change) => {
    if (change.type !== "added" || change.doc.metadata.hasPendingWrites) {
      return;
    }

    const docSnapshot = change.doc;
    const item = docSnapshot.data() || {};
    if (String(item.to || "").trim() !== "admin" || item.read || previousIds.has(docSnapshot.id)) {
      return;
    }

    const title = resolveAdminNotificationTitle(item);
    const body = String(item.message || "You have a new update.");
    const refId = String(item.refId || "").trim();
    const type = String(item.type || "notification").trim().toLowerCase();
    const tag = refId ? `notif-${type}-${refId}` : `admin-notif-${docSnapshot.id}`;
    if (!claimNotificationTag(tag)) {
      return;
    }

    showToast(`${title}: ${body}`, "info");
    void showBrowserNotification(title, body, {
      link: "./admin.html",
      tag,
    });
  });

  adminNotificationAlertTracker.ids = currentIds;
}

async function handleClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.id === "adminMenuToggle") {
    state.adminSidebarOpen = !state.adminSidebarOpen;
    renderAdmin();
    return;
  }

  if (button.id === "adminRetryAccess") {
    const user = auth.currentUser;
    if (!user) {
      state.adminAccessStatus = "signed_out";
      state.adminAccessMessage = "";
      state.adminUserEmail = "";
      renderAdmin();
      return;
    }

    state.adminAccessStatus = "checking";
    state.adminAccessMessage = "";
    renderAdmin();

    const access = await getAdminAccessResult(user);
    if (access?.ok) {
      state.currentAdmin = true;
      state.adminAccessStatus = "approved";
      state.adminAccessMessage = "";
      startAdminCollectionSubscriptions();
      renderAdmin();
      updateAdminNotificationPromptButtonState();
      return;
    }

    state.currentAdmin = false;
    state.adminAccessStatus = access?.status === 403 ? "denied" : "error";
    state.adminAccessMessage = String(
      access?.error || "Unable to verify admin access right now. Check connection and try again.",
    ).trim();
    renderAdmin();
    updateAdminNotificationPromptButtonState();
    return;
  }

  if (button.id === "adminSidebarClose" || button.id === "adminSidebarBackdrop") {
    state.adminSidebarOpen = false;
    renderAdmin();
    return;
  }

  if (button.classList.contains("adminNavBtn")) {
    state.adminPanelSection = button.dataset.section || "dashboard";
    state.adminSidebarOpen = false;
    renderAdmin();
    return;
  }

  if (button.classList.contains("toggleBlock")) {
    await toggleHotelBlock(button.dataset.id);
    return;
  }

  if (button.classList.contains("approveHotel")) {
    await approveHotel(button.dataset.id);
    return;
  }

  if (button.classList.contains("activateSub")) {
    await activateSubscription(button.dataset.id);
    return;
  }

  if (button.classList.contains("expireSub")) {
    await expireSubscription(button.dataset.id);
    return;
  }

  if (button.id === "clearAll") {
    await clearAllData();
    return;
  }

  if (button.classList.contains("markPaid")) {
    await markOrderPaid(button.dataset.id);
    return;
  }

  if (button.classList.contains("markShopOrderPaid")) {
    await markShopOrderPaid(button.dataset.id);
    return;
  }

  if (button.classList.contains("markShopOrderDelivered")) {
    await markShopOrderDelivered(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteOrder")) {
    await deleteOrder(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteShopOrder")) {
    await deleteShopOrder(button.dataset.id);
    return;
  }

  if (button.classList.contains("resolveFeedback")) {
    await resolveFeedback(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteFeedback")) {
    await deleteFeedback(button.dataset.id);
    return;
  }

  if (button.classList.contains("deleteEmployee")) {
    await deleteEmployee(button.dataset.id);
    return;
  }

  if (button.classList.contains("openEmployeeIdPdf")) {
    try {
      await openEmployeeIdCard(button.dataset.id, button.dataset.url);
    } catch (error) {
      console.error("Open employee ID PDF failed", error);
      showToast(String(error?.message || "Failed to open employee ID PDF."), "error");
    }
    return;
  }

  if (button.classList.contains("downloadEmployeeIdPdf")) {
    try {
      await downloadEmployeeIdCard(button.dataset.id, button.dataset.url);
      showToast("Employee ID PDF downloaded.", "success");
    } catch (error) {
      console.error("Download employee ID PDF failed", error);
      showToast(String(error?.message || "Failed to download employee ID PDF."), "error");
    }
    return;
  }

  if (button.id === "downloadAllDataPdf") {
    downloadAllAdminDataPdf();
    showToast("Admin data PDF download started.", "success");
    return;
  }

  if (button.id === "downloadEmployeeIdsPdf") {
    downloadEmployeeIdsPdf();
    showToast("Employee IDs PDF download started.", "success");
    return;
  }

  if (button.id === "downloadAllDataWord") {
    downloadAllAdminDataWord();
    showToast("Admin data Word download started.", "success");
    return;
  }

  if (button.id === "downloadAllEmployeeIds") {
    await downloadAllEmployeeIdPdfs();
    return;
  }

  if (button.classList.contains("deleteNotification")) {
    await deleteNotification(button.dataset.id);
    return;
  }

  if (button.id === "logoutAdmin") {
    await unregisterPushSubscription("admin");
    await signOut(auth);
    showToast("Admin logged out.", "info");
    updateAdminNotificationPromptButtonState();
    return;
  }

  if (button.classList.contains("markNotifRead")) {
    await updateDoc(doc(db, "notifications", button.dataset.id), { read: true });
    return;
  }

  if (button.dataset.togglePanel) {
    const panel = document.getElementById(button.dataset.togglePanel);
    if (panel) {
      panel.classList.toggle("is-hidden");
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id !== "adminLogin") {
    return;
  }

  const user = form.elements.adminEmail.value.trim();
  const pass = form.elements.adminPass.value.trim();

  if (!user || !pass) {
    alert("Enter admin email and password.");
    return;
  }

  try {
    state.adminAccessStatus = "checking";
    state.adminAccessMessage = "";
    state.adminUserEmail = user;
    renderAdmin();

    const credentials = await signInWithEmailAndPassword(auth, user, pass);
    const access = await getAdminAccessResult(credentials.user);
    if (!access?.ok) {
      state.adminAccessStatus = access?.status === 403 ? "denied" : "error";
      state.adminAccessMessage = String(
        access?.error || "Unable to verify admin access right now. Check connection and try again.",
      ).trim();
      state.adminUserEmail = user;
      await signOut(auth).catch(() => undefined);
      alert(
        access?.status === 403
          ? "This account is not approved for admin access."
          : "Unable to verify admin access right now. Check connection and try again.",
      );
      return;
    }

    const pushEnabled = await registerPushSubscription("admin", credentials.user.email || user, {
      requestPermission: true,
      role: "admin",
      silent: false,
    });
    form.reset();
    showToast(
      pushEnabled
        ? "Admin login successful. Browser notifications enabled."
        : "Admin login successful. Tap Enable Notifications to allow browser alerts.",
      pushEnabled ? "success" : "warn",
    );
    updateAdminNotificationPromptButtonState();
  } catch (error) {
    console.error(error);
    state.currentAdmin = false;
    state.adminAccessStatus = "signed_out";
    state.adminAccessMessage = "";
    state.adminUserEmail = "";
    renderAdmin();
    alert("Wrong admin email or password.");
  }
}

async function getAdminAccessResult(user = auth.currentUser) {
  if (!user) {
    return { ok: false, status: 0, error: "Missing user." };
  }

  try {
    return await ensureAdminAccessStatus(user);
  } catch (error) {
    console.warn("Admin access check failed", error);
    return {
      ok: false,
      status: 0,
      error: String(error?.message || "Admin access check failed.").trim(),
    };
  }
}

async function toggleHotelBlock(hotelId) {
  const hotel = state.hotels.find((item) => item.id === hotelId);
  if (!hotel) {
    return;
  }

  await updateDoc(doc(db, "hotels", hotelId), { blocked: !hotel.blocked });
  showToast(hotel.blocked ? "Hotel unblocked." : "Hotel blocked.", "success");
}

async function approveHotel(hotelId) {
  await updateDoc(doc(db, "hotels", hotelId), { approved: true });

  const restaurant = getRestaurantByHotelId(hotelId);
  if (!restaurant) {
    await setDoc(doc(db, "restaurants", hotelId), { hotelId, menu: [] });
  }

  showToast("Hotel approved.", "success");
}

async function activateSubscription(hotelId) {
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

  try {
    await updateDoc(doc(db, "hotels", hotelId), { subscriptionExpiry: expiry });
    showToast("Subscription activated for 30 days.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to activate subscription.", "error");
  }
}

async function expireSubscription(hotelId) {
  try {
    await updateDoc(doc(db, "hotels", hotelId), { subscriptionExpiry: Date.now() - 1000 });
    showToast("Subscription expired.", "warn");
  } catch (error) {
    console.error(error);
    showToast("Failed to expire subscription.", "error");
  }
}

async function markOrderPaid(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
    return;
  }

  if ((order.status || "Pending") === "Paid") {
    showToast("Order is already marked as paid.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Paid" });
  } catch (error) {
    console.error(error);
    showToast("Failed to mark order as paid.", "error");
    return;
  }

  try {
    const hotelName = state.hotels.find((item) => item.id === order.hotelId)?.name || "selected hotel";
    await notifyPaidOrderStatus(order, hotelName);
    showToast("Order marked as paid.", "success");
  } catch (error) {
    console.warn("Paid order notification failed", error);
    showToast("Order marked as paid, but notification delivery failed.", "warn");
  }
}

async function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) {
    alert("Order not found.");
    return;
  }

  if (!window.confirm("Delete this order permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "orders", orderId));
    showToast("Order deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Delete failed.", "error");
  }
}

async function markShopOrderPaid(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  if (order.paid) {
    showToast("Shop Here order is already marked as paid.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { paid: true });
  } catch (error) {
    console.error(error);
    showToast("Failed to mark Shop Here order as paid.", "error");
    return;
  }

  try {
    await notifyShopOrderStatus({ ...order, paid: true }, "paid");
    showToast("Shop Here order marked as paid.", "success");
  } catch (error) {
    console.warn("Shop Here paid notification failed", error);
    showToast("Shop Here order marked as paid, but notification delivery failed.", "warn");
  }
}

async function markShopOrderDelivered(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  if (order.delivered) {
    showToast("Shop Here order is already marked as delivered.", "info");
    return;
  }

  try {
    await updateDoc(doc(db, "ummaShopOrders", orderId), { delivered: true });
  } catch (error) {
    console.error(error);
    showToast("Failed to update Shop Here order.", "error");
    return;
  }

  try {
    await notifyShopOrderStatus({ ...order, delivered: true }, "delivered");
    showToast("Shop Here order marked as delivered.", "success");
  } catch (error) {
    console.warn("Shop Here delivered notification failed", error);
    showToast("Shop Here order marked as delivered, but notification delivery failed.", "warn");
  }
}

async function deleteShopOrder(orderId) {
  const order = state.ummaShopOrders.find((item) => item.id === orderId);
  if (!order) {
    alert("Shop order not found.");
    return;
  }

  if (!window.confirm("Delete this Shop Here order permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "ummaShopOrders", orderId));
    showToast("Shop Here order deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete Shop Here order.", "error");
  }
}

async function resolveFeedback(feedbackId) {
  const feedback = state.feedbacks.find((item) => item.id === feedbackId);
  if (!feedback) {
    alert("Feedback not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "feedbacks", feedbackId), { status: "Reviewed" });
    showToast("Feedback marked as reviewed.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to update feedback.", "error");
  }
}

async function deleteFeedback(feedbackId) {
  const feedback = state.feedbacks.find((item) => item.id === feedbackId);
  if (!feedback) {
    alert("Feedback not found.");
    return;
  }

  if (!window.confirm("Delete this feedback permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "feedbacks", feedbackId));
    showToast("Feedback deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete feedback.", "error");
  }
}

async function deleteEmployee(employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) {
    alert("Employee not found.");
    return;
  }

  if (!window.confirm("Delete this employee profile permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "employees", employeeId));
    await postAdminJson("/api/admin-employee-id-card", {
      action: "delete",
      employeeId,
    }).catch(() => undefined);
    employeeIdCardCache.delete(employeeId);
    showToast("Employee profile deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete employee.", "error");
  }
}

async function deleteNotification(notificationId) {
  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification) {
    alert("Notification not found.");
    return;
  }

  if (!window.confirm("Delete this notification permanently?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "notifications", notificationId));
    adminNotificationAlertTracker.ids.delete(notificationId);
    showToast("Notification deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Failed to delete notification.", "error");
  }
}

async function clearAllData() {
  if (!window.confirm("Delete all hotels, restaurants, orders, feedbacks, and notifications?")) {
    return;
  }

  const collections = [
    "hotels",
    "restaurants",
    "orders",
    "ummaShopOrders",
    "feedbacks",
    "ummaShopFeedbacks",
    "notifications",
  ];
  for (const collectionName of collections) {
    const snapshot = await getDocs(collection(db, collectionName));
    for (const item of snapshot.docs) {
      await deleteDoc(doc(db, collectionName, item.id));
    }
  }

  showToast("All platform data cleared.", "success");
}


