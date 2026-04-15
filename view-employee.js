import { DEFAULT_HOTEL_LOCATION, SERVICE_FEE } from "./config.js";
import {
  buildWhatsAppLink,
  escapeHtml,
  formatCoordinatePair,
  formatCurrency,
  formatDateOnly,
  formatDistanceKm,
  formatTime,
  normalizeCoordinates,
  pluralize,
} from "./helpers.js";
import { renderEmptyState, renderInlineBadge, renderNotifications, renderStatusPill } from "./view-common.js";

function getEmployeeAppElement() {
  return document.getElementById("app");
}

export function renderEmployeePortal(portalState) {
  const appElement = getEmployeeAppElement();
  if (!appElement) {
    return;
  }

  document.body.classList.toggle("modal-open", Boolean(portalState.mapModal));

  if (!portalState.authReady || portalState.authBusy) {
    appElement.innerHTML = renderEmployeeLoading(
      portalState.pendingRegistration ? "Creating employee account" : "Restoring session",
      portalState.pendingRegistration
        ? "Saving your employee profile and ID card, then opening the workspace."
        : "Checking your saved employee login and syncing your workspace before showing the form.",
    );
    return;
  }

  if (!portalState.currentUser) {
    appElement.innerHTML = renderEmployeeAuth(portalState);
    return;
  }

  if (portalState.profileStatus === "loading") {
    appElement.innerHTML = renderEmployeeLoading();
    return;
  }

  if (portalState.profileStatus === "stalled") {
    appElement.innerHTML = renderEmployeeStalled();
    return;
  }

  if (!portalState.employeeProfile) {
    appElement.innerHTML = renderMissingEmployeeProfile();
    return;
  }

  if (String(portalState.employeeProfile.status || "active").toLowerCase() === "blocked") {
    appElement.innerHTML = renderBlockedEmployeeProfile();
    return;
  }

  appElement.innerHTML = renderEmployeeDashboard(portalState);
}

function renderEmployeeAuth(portalState) {
  const authView = portalState?.authView === "register" ? "register" : "login";
  const loginHiddenClass = authView === "register" ? " is-hidden" : "";
  const registerHiddenClass = authView === "register" ? "" : " is-hidden";
  const authEmailValue = escapeHtml(String(portalState?.authEmailDraft || "").trim());

  return `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <p class="eyebrow">Employee workspace</p>
          <h2 class="view-title">Employee Portal</h2>
          <p class="view-copy">Create an employee account with Firebase login, upload your ID as a PDF (front and back in one file), and view live orders in read-only mode.</p>
        </div>
      </div>

      <div class="auth-flow-grid employee-portal-grid">
        <form id="employeeLogin" class="card auth-card${loginHiddenClass}">
          <p class="eyebrow">Returning employee</p>
          <h3 class="card-title">Login</h3>

          <label class="field">
            <span class="field-label">Email</span>
            <input class="input" name="employeeEmail" placeholder="employee@example.com" type="email" value="${authEmailValue}" />
          </label>

          <label class="field">
            <span class="field-label">Password</span>
            <input class="input" name="employeePass" placeholder="Password" type="password" />
          </label>

          <p class="tiny">Use the same employee email and password you created on this page.</p>
          <button class="button button-primary" type="submit">Login</button>
          <p class="tiny auth-switch">
            Don&apos;t have an account?
            <button class="auth-switch-btn employeeAuthSwitchBtn" data-auth-view="register" type="button">Register</button>
          </p>
        </form>

        <form id="employeeRegister" class="card auth-card${registerHiddenClass}">
          <p class="eyebrow">New employee</p>
          <h3 class="card-title">Create Account</h3>

          <label class="field">
            <span class="field-label">Full name</span>
            <input class="input" name="employeeName" placeholder="Employee full name" />
          </label>

          <label class="field">
            <span class="field-label">Email</span>
            <input class="input" name="employeeEmail" placeholder="employee@example.com" type="email" value="${authEmailValue}" />
          </label>

          <label class="field">
            <span class="field-label">ID number</span>
            <input class="input" name="employeeIdNumber" placeholder="National ID number" />
          </label>

          <label class="field">
            <span class="field-label">Work county</span>
            <input class="input" name="employeeCounty" placeholder="e.g. Kajiado" />
          </label>

          <label class="field">
            <span class="field-label">Scanned ID PDF (front + back)</span>
            <input class="input input-file" accept=".pdf,application/pdf" name="employeeIdCard" type="file" />
          </label>

          <div class="field-grid">
            <label class="field">
              <span class="field-label">Password</span>
              <input class="input" name="employeePass" placeholder="Password" type="password" />
            </label>

            <label class="field">
              <span class="field-label">Confirm password</span>
              <input class="input" name="employeePassConfirm" placeholder="Confirm password" type="password" />
            </label>
          </div>

          <p class="tiny">Upload one clear PDF that includes both front and back of the ID. The work county controls which orders you can view in this portal.</p>
          <button class="button button-secondary" type="submit">Create Employee Account</button>
          <p class="tiny auth-switch">
            Already have an account?
            <button class="auth-switch-btn employeeAuthSwitchBtn" data-auth-view="login" type="button">Login</button>
          </p>
        </form>
      </div>
    </section>
  `;
}

function renderEmployeeLoading(title = "Preparing workspace", copy = "Checking your employee account and loading live orders.") {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Employee access</p>
            <h2 class="view-title">${escapeHtml(title)}</h2>
            <p class="view-copy">${escapeHtml(copy)}</p>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderEmployeeStalled() {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Employee access</p>
            <h2 class="view-title">Session Check Delayed</h2>
            <p class="view-copy">Employee account verification is taking too long. Refresh the portal or logout to return to login immediately.</p>
          </div>

          <div class="button-row">
            <button class="button button-primary" id="retryEmployeeSession" type="button">Refresh Portal</button>
            <button class="button button-secondary" id="logoutEmployee" type="button">Logout</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderMissingEmployeeProfile() {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Employee access</p>
            <h2 class="view-title">Profile Missing</h2>
            <p class="view-copy">This Firebase account does not have an employee profile yet. Create the employee account from this page first.</p>
          </div>

          <div class="button-row">
            <button class="button button-secondary" id="logoutEmployee" type="button">Logout</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderBlockedEmployeeProfile() {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Employee access</p>
            <h2 class="view-title">Access Blocked</h2>
            <p class="view-copy">This employee account is currently blocked. Contact your delivery coordinator for help.</p>
          </div>

          <div class="button-row">
            <button class="button button-secondary" id="logoutEmployee" type="button">Logout</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderEmployeeDashboard(portalState) {
  const profile = portalState.employeeProfile;
  const notifications = [...(Array.isArray(portalState.notifications) ? portalState.notifications : [])]
    .sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));
  const orders = [...portalState.orders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const shopOrders = [...portalState.ummaShopOrders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const unreadNotifications = notifications.filter((item) => !item.read).length;
  const pendingOrders = orders.filter((item) => (item.status || "Pending") !== "Paid").length;
  const paidOrders = orders.length - pendingOrders;
  const mapReadyOrders = orders.filter((item) => Boolean(getOrderCustomerCoordinates(item))).length;
  const currentSection = portalState.employeeSection || "dashboard";
  const hasCoverageCounty = hasEmployeeCoverageCounty(profile);
  const ordersReady = portalState.ordersLoaded === true;
  const shopOrdersReady = portalState.shopOrdersLoaded === true;
  const notificationsReady = portalState.notificationsLoaded === true;
  const dataSyncing = portalState.hotelsLoaded !== true || !ordersReady || !shopOrdersReady;

  return `
    <section class="view-shell admin-panel-shell">
      <aside class="card admin-sidebar ${portalState.employeeSidebarOpen ? "is-open" : ""}" aria-label="Employee navigation">
        <div class="admin-sidebar-head">
          <div>
            <p class="eyebrow">Employee menu</p>
            <h3 class="card-title">Workflow</h3>
          </div>
          <button class="button button-ghost button-small" id="employeeSidebarClose" type="button">Close</button>
        </div>

        <div class="admin-nav-list">
          ${renderEmployeeNavButton("dashboard", "Dashboard", formatEmployeeSectionMeta("pending order", pendingOrders, { hasCounty: hasCoverageCounty, ready: ordersReady, loadingLabel: "Loading county orders..." }), currentSection)}
          ${renderEmployeeNavButton("hotelOrders", "Hotel Orders", formatEmployeeSectionMeta("hotel order", orders.length, { hasCounty: hasCoverageCounty, ready: ordersReady, loadingLabel: "Loading hotel orders..." }), currentSection)}
          ${renderEmployeeNavButton("shopOrders", "Shop Here Orders", formatEmployeeSectionMeta("shop request", shopOrders.length, { hasCounty: hasCoverageCounty, ready: shopOrdersReady, loadingLabel: "Loading Shop Here orders..." }), currentSection)}
          ${renderEmployeeNavButton("mapOrders", "Customer Maps", formatEmployeeSectionMeta("map-ready order", mapReadyOrders, { hasCounty: hasCoverageCounty, ready: ordersReady, loadingLabel: "Loading map-ready orders..." }), currentSection)}
          ${renderEmployeeNavButton("notifications", "Notifications", formatEmployeeSectionMeta("alert", notifications.length, { ready: notificationsReady, loadingLabel: "Loading alerts..." }), currentSection, notificationsReady ? unreadNotifications : 0)}
        </div>

        <div class="info-box admin-sidebar-note">
          <p>Use this menu to switch between workflow sections quickly on mobile and desktop.</p>
        </div>
      </aside>

      ${portalState.employeeSidebarOpen ? `<button class="admin-sidebar-backdrop" id="employeeSidebarBackdrop" type="button" aria-label="Close employee navigation"></button>` : ""}

      <div class="admin-main-stack">
        <div class="view-header admin-main-header">
          <div>
            <p class="eyebrow">Employee workspace</p>
            <h2 class="view-title">Employee Orders Panel</h2>
            <p class="view-copy">Live access to hotel and Shop Here orders. Employees can delete Shop Here orders when needed.</p>
          </div>

          <div class="toolbar">
            <button class="button button-outline admin-menu-button" id="employeeMenuToggle" type="button">
              <span class="hamburger-icon" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
              Menu
            </button>
            <span class="summary-chip">${escapeHtml(profile.county ? `${profile.fullName || profile.email || "Employee"} · ${profile.county}` : profile.fullName || profile.email || "Employee")}</span>
            <button class="button button-ghost" id="logoutEmployee" type="button">Logout</button>
          </div>
        </div>

        ${renderEmployeeSection(currentSection, {
          dataSyncing,
          hasCoverageCounty,
          mapReadyOrders,
          notifications,
          notificationsReady,
          orders,
          ordersReady,
          paidOrders,
          pendingOrders,
          profile,
          shopOrders,
          shopOrdersReady,
          hotels: portalState.hotels,
          portalState,
          totalHotelOrders: Number(portalState.totalHotelOrders || 0),
          totalShopOrders: Number(portalState.totalShopOrders || 0),
        })}
      </div>

      ${renderEmployeeMapModal(portalState.mapModal, portalState.mapMode)}
    </section>
  `;
}

function renderEmployeeCountyManagerCard(portalState) {
  const profile = portalState?.employeeProfile || {};
  const currentCounty = String(profile.county || "").trim();
  const currentCountyLabel = currentCounty || "Not set";
  const hasCoverageCounty = hasEmployeeCoverageCounty(profile);
  const showEditor = !currentCounty || Boolean(portalState?.countyEditorOpen);
  const suggestions = Array.isArray(portalState?.countySuggestions) ? portalState.countySuggestions : [];
  const suggestionMarkup = suggestions.length
    ? `
        <datalist id="employeeCountySuggestionList">
          ${suggestions.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("")}
        </datalist>
      `
    : "";

  return `
    <article class="card auth-card">
      <div class="section-head">
        <div>
          <p class="eyebrow">Work county</p>
          <h3 class="card-title">Coverage filter</h3>
        </div>
        ${
          currentCounty
            ? `<button class="button button-outline button-small" id="toggleEmployeeCountyEditor" type="button">${showEditor ? "Hide" : "Change County"}</button>`
            : ""
        }
      </div>

      <p class="tiny">Employees see hotel orders, Shop Here requests, customer maps, and alerts for the county selected here.</p>

      <div class="summary-list">
        <div class="summary-item"><span>Current county</span><strong>${escapeHtml(currentCountyLabel)}</strong></div>
        <div class="summary-item"><span>Visible hotel orders</span><strong>${escapeHtml(formatEmployeeMetricValue(portalState.orders.length, { hasCounty: hasCoverageCounty, ready: portalState.ordersLoaded === true }))}</strong></div>
        <div class="summary-item"><span>Visible Shop Here orders</span><strong>${escapeHtml(formatEmployeeMetricValue(portalState.ummaShopOrders.length, { hasCounty: hasCoverageCounty, ready: portalState.shopOrdersLoaded === true }))}</strong></div>
        <div class="summary-item"><span>Visible notifications</span><strong>${escapeHtml(formatEmployeeMetricValue(portalState.notifications.length, { ready: portalState.notificationsLoaded === true }))}</strong></div>
      </div>

      ${
        showEditor
          ? `
              <form id="employeeSetCounty" class="stack">
                <label class="field">
                  <span class="field-label">County</span>
                  <input
                    class="input"
                    list="employeeCountySuggestionList"
                    name="employeeCounty"
                    placeholder="e.g. Kajiado"
                    value="${escapeHtml(currentCounty)}"
                  />
                </label>

                ${suggestionMarkup}

                <div class="button-row">
                  <button class="button button-primary" type="submit">${currentCounty ? "Update County" : "Save County"}</button>
                  ${
                    currentCounty
                      ? `<button class="button button-outline" id="cancelEmployeeCountyEditor" type="button">Cancel</button>`
                      : ""
                  }
                </div>
              </form>
            `
          : `<p class="tiny">Use Change County whenever you need to switch from Kajiado to another county and load that county's orders.</p>`
      }
    </article>
  `;
}

function renderEmployeeNavButton(sectionId, label, meta, currentSection, count = 0) {
  const activeClass = currentSection === sectionId ? " is-active" : "";

  return `
    <button class="employeeNavBtn admin-nav-btn${activeClass}" data-section="${escapeHtml(sectionId)}" type="button">
      <span class="admin-nav-copy">
        <span class="admin-nav-title">${escapeHtml(label)}</span>
        <span class="admin-nav-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="summary-chip admin-nav-pill">
        ${escapeHtml(label)}
        ${renderInlineBadge(count, "alert")}
      </span>
    </button>
  `;
}

function renderEmployeeSectionStatus(title, copy) {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <h4>${escapeHtml(title)}</h4>
            <p class="tiny">${escapeHtml(copy)}</p>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderEmployeeSection(section, context) {
  if (section === "notifications") {
    if (!context.notificationsReady) {
      return renderEmployeeSectionStatus("Loading notifications", "Checking the latest employee alerts.");
    }
    return renderEmployeeNotificationsSection(context.notifications);
  }

  if (section === "hotelOrders") {
    if (!context.hasCoverageCounty) {
      return renderEmployeeSectionStatus("Work county required", "Set the employee work county first to load hotel orders.");
    }
    if (!context.ordersReady) {
      return renderEmployeeSectionStatus("Loading hotel orders", "Syncing the latest county hotel orders.");
    }
    return renderEmployeeOrdersSection(context.orders, context.hotels);
  }

  if (section === "shopOrders") {
    if (!context.hasCoverageCounty) {
      return renderEmployeeSectionStatus("Work county required", "Set the employee work county first to load Shop Here requests.");
    }
    if (!context.shopOrdersReady) {
      return renderEmployeeSectionStatus("Loading Shop Here orders", "Syncing the latest Shop Here requests for this county.");
    }
    return renderEmployeeShopOrdersSection(context.shopOrders);
  }

  if (section === "mapOrders") {
    if (!context.hasCoverageCounty) {
      return renderEmployeeSectionStatus("Work county required", "Set the employee work county first to load customer maps.");
    }
    if (!context.ordersReady) {
      return renderEmployeeSectionStatus("Loading customer maps", "Checking hotel orders with customer coordinates.");
    }
    return renderEmployeeMapOrdersSection(context.orders, context.hotels);
  }

  return renderEmployeeDashboardSection(context);
}

function renderEmployeeDashboardSection(context) {
  const hasIdCardUpload = Boolean(
    context?.profile?.idCardUploaded ||
    context?.profile?.idCardDatabasePath ||
    context?.profile?.idCardUrl,
  );

  return `
    <section class="view-shell">
      ${renderEmployeeCoverageNotice(context)}

      ${renderEmployeeCountyManagerCard(context.portalState)}

      <div class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">Hotel Orders</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.orders.length, { hasCounty: context.hasCoverageCounty, ready: context.ordersReady }))}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Pending</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.pendingOrders, { hasCounty: context.hasCoverageCounty, ready: context.ordersReady }))}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Paid</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.paidOrders, { hasCounty: context.hasCoverageCounty, ready: context.ordersReady }))}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Shop Here</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.shopOrders.length, { hasCounty: context.hasCoverageCounty, ready: context.shopOrdersReady }))}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Map Ready</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.mapReadyOrders, { hasCounty: context.hasCoverageCounty, ready: context.ordersReady }))}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Notifications</span>
          <strong>${escapeHtml(formatEmployeeMetricValue(context.notifications.length, { ready: context.notificationsReady }))}</strong>
        </article>
      </div>

      <div class="two-column employee-portal-grid">
        <article class="card">
          <div class="section-head">
            <h4>Employee Profile</h4>
            ${renderStatusPill(String(context.profile.status || "Active"), String(context.profile.status || "active").toLowerCase() === "active" ? "active" : "inactive")}
          </div>

          <div class="summary-list">
            <div class="summary-item"><span>Full name</span><strong>${escapeHtml(context.profile.fullName || "N/A")}</strong></div>
            <div class="summary-item"><span>Email</span><strong>${escapeHtml(context.profile.email || "N/A")}</strong></div>
            <div class="summary-item"><span>ID number</span><strong>${escapeHtml(context.profile.idNumber || "N/A")}</strong></div>
            <div class="summary-item"><span>Scanned ID PDF</span><strong>${hasIdCardUpload ? "Uploaded" : "Missing"}</strong></div>
            <div class="summary-item"><span>Joined</span><strong>${formatDateOnly(context.profile.createdAt)}</strong></div>
          </div>

          ${
            context.profile.idCardUrl
              ? `
                  <div class="button-row">
                    <a class="button button-outline button-small" href="${escapeHtml(context.profile.idCardUrl)}" target="_blank" rel="noreferrer">
                      Open ID Card
                    </a>
                  </div>
                `
              : context.profile.idCardDatabasePath
                ? `
                    <p class="tiny">Stored in Realtime Database as a secure Base64 PDF.</p>
                  `
              : ""
          }
        </article>

        <article class="card">
          <div class="section-head">
            <h4>Workflow Guide</h4>
            ${renderStatusPill("Read Only", "inactive")}
          </div>

          <div class="summary-list">
            <div class="summary-item"><span>Step 1</span><strong>Open Hotel Orders</strong></div>
            <div class="summary-item"><span>Step 2</span><strong>Check pending and paid status</strong></div>
            <div class="summary-item"><span>Step 3</span><strong>Use Customer Maps for navigation</strong></div>
            <div class="summary-item"><span>Step 4</span><strong>Review Shop Here requests</strong></div>
          </div>

          <p class="tiny">Employees can view live orders and alerts for their assigned county and delete Shop Here orders only. Payment and hotel setup stay on admin/hotel pages.</p>
        </article>
      </div>
    </section>
  `;
}

function renderEmployeeNotificationsSection(notifications) {
  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Notifications</h4>
        <span class="summary-chip">${notifications.length} alert${pluralize(notifications.length)}</span>
      </div>

      ${renderNotifications(notifications)}
    </section>
  `;
}

function renderEmployeeOrdersSection(orders, hotels) {
  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Hotel Orders</h4>
        <span class="summary-chip">${orders.length} order${pluralize(orders.length)}</span>
      </div>

      ${
        orders.length
          ? `<div class="order-list">${orders.map((order) => renderEmployeeOrderCard(order, hotels)).join("")}</div>`
          : renderEmptyState("No hotel orders yet", "Live hotel orders will appear here for employees.")
      }
    </section>
  `;
}

function renderEmployeeShopOrdersSection(shopOrders) {
  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Shop Here Orders</h4>
        <span class="summary-chip">${shopOrders.length} shop order${pluralize(shopOrders.length)}</span>
      </div>

      ${
        shopOrders.length
          ? `<div class="order-list">${shopOrders.map(renderEmployeeShopOrderCard).join("")}</div>`
          : renderEmptyState("No Shop Here orders yet", "Shop Here requests will appear here for employees.")
      }
    </section>
  `;
}

function renderEmployeeMapOrdersSection(orders, hotels) {
  const mapOrders = orders.filter((item) => Boolean(getOrderCustomerCoordinates(item)));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Customer Map Orders</h4>
        <span class="summary-chip">${mapOrders.length} order${pluralize(mapOrders.length)}</span>
      </div>

      ${
        mapOrders.length
          ? `<div class="order-list">${mapOrders.map((order) => renderEmployeeOrderCard(order, hotels)).join("")}</div>`
          : renderEmptyState("No map-ready orders yet", "Orders with shared customer coordinates will appear here.")
      }
    </section>
  `;
}

function getHotelForOrder(hotels, hotelId) {
  return (
    hotels.find((item) => item.id === hotelId) || {
      location: DEFAULT_HOTEL_LOCATION,
      name: "Unknown hotel",
      till: "N/A",
    }
  );
}

function getOrderCustomerCoordinates(order) {
  return normalizeCoordinates(order?.customerCoordinates);
}

function getOrderCustomerAreaSummary(order) {
  const area = String(order?.customerArea || "").trim();
  const specificArea = String(order?.customerSpecificArea || "").trim();
  return [area, specificArea].filter(Boolean).join(" - ");
}

function renderEmployeeOrderCard(order, hotels) {
  const hotel = getHotelForOrder(hotels, order.hotelId);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsTotal = items.length
    ? items.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 1), 0)
    : Number(order.itemsTotal || 0);
  const total = Number(order.total || itemsTotal + Number(order.serviceFee ?? SERVICE_FEE));
  const customerCoordinates = getOrderCustomerCoordinates(order);
  const areaSummary = getOrderCustomerAreaSummary(order);
  const customerWaLink = buildWhatsAppLink(
    order.customerPhone,
    `Hello ${order.customerName || "customer"}, I am the delivery person from Tamu Express for your order at ${hotel.name}.`,
  );

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Hotel order</p>
          <h3>${escapeHtml(order.customerName || "Unknown customer")}</h3>
          <p class="tiny">${formatTime(order.createdAt)}</p>
        </div>
        ${renderStatusPill(order.status || "Pending")}
      </div>

      <div class="order-meta-grid">
        <div class="meta-block">
          <span>Customer phone</span>
          <strong>${escapeHtml(order.customerPhone || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Hotel</span>
          <strong>${escapeHtml(hotel.name)}</strong>
        </div>
        <div class="meta-block">
          <span>Hotel location</span>
          <strong>${escapeHtml(hotel.location || DEFAULT_HOTEL_LOCATION)}</strong>
        </div>
        <div class="meta-block">
          <span>Customer area</span>
          <strong>${escapeHtml(areaSummary || "Not shared")}</strong>
        </div>
      </div>

      <div class="menu-list">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                    <div class="order-item">
                      <div class="split-row">
                        <strong>${escapeHtml(`${item.qty || 1} x ${item.name}`)}</strong>
                        <span class="item-price">${formatCurrency((item.qty || 1) * Number(item.price || 0))}</span>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="order-item"><p class="is-muted">No order items were saved for this record.</p></div>`
        }
      </div>

      <div class="summary-list">
        <div class="summary-item"><span>Items total</span><strong>${formatCurrency(itemsTotal)}</strong></div>
        <div class="summary-item"><span>Service fee</span><strong>${formatCurrency(order.serviceFee ?? SERVICE_FEE)}</strong></div>
        <div class="summary-item"><span>Distance</span><strong>${Number.isFinite(order.distanceKm) ? formatDistanceKm(order.distanceKm) : "Unknown"}</strong></div>
        <div class="summary-item"><span>Map shared</span><strong>${customerCoordinates ? "Yes" : "No"}</strong></div>
        <div class="summary-item"><span>Total</span><strong>${formatCurrency(total)}</strong></div>
      </div>

      ${
        customerCoordinates
          ? `
              <div class="button-row">
                <button
                  class="button button-outline button-small viewCustomerMapBtn"
                  data-customer-area="${escapeHtml(areaSummary)}"
                  data-customer-name="${escapeHtml(order.customerName || "Customer")}"
                  data-latitude="${escapeHtml(String(customerCoordinates.latitude))}"
                  data-longitude="${escapeHtml(String(customerCoordinates.longitude))}"
                  type="button"
                >
                  View Map
                </button>
                ${
                  customerWaLink
                    ? `<a class="button button-outline button-small" href="${escapeHtml(customerWaLink)}" target="_blank" rel="noreferrer">WhatsApp Customer</a>`
                    : ""
                }
              </div>
            `
          : `
              ${
                customerWaLink
                  ? `<div class="button-row"><a class="button button-outline button-small" href="${escapeHtml(customerWaLink)}" target="_blank" rel="noreferrer">WhatsApp Customer</a></div>`
                  : ""
              }
              <p class="tiny">Customer map coordinates were not shared for this order.</p>
            `
      }
    </article>
  `;
}

function hasEmployeeCoverageCounty(profile) {
  return Boolean(String(profile?.county || profile?.normalizedCounty || "").trim());
}

function formatEmployeeMetricValue(value, options = {}) {
  const hasCounty = options.hasCounty !== false;
  const ready = options.ready !== false;

  if (!hasCounty) {
    return "Set county";
  }

  if (!ready) {
    return "Syncing...";
  }

  return String(value);
}

function formatEmployeeSectionMeta(label, count, options = {}) {
  const hasCounty = options.hasCounty !== false;
  const ready = options.ready !== false;

  if (!hasCounty) {
    return "Set work county to load data";
  }

  if (!ready) {
    return options.loadingLabel || "Syncing data...";
  }

  return `${count} ${label}${pluralize(count)}`;
}

function renderEmployeeCoverageNotice(context) {
  const countyLabel = String(context?.profile?.county || "").trim();

  if (!context?.hasCoverageCounty) {
    return `
      <article class="card info-box">
        <p>Set the employee work county first. Until then the portal will not count hotel orders, Shop Here orders, or customer maps.</p>
      </article>
    `;
  }

  if (context?.dataSyncing) {
    return `
      <article class="card info-box">
        <p>Loading live hotel and Shop Here records for ${escapeHtml(countyLabel || "your county")}.</p>
      </article>
    `;
  }

  if (!context.orders.length && !context.shopOrders.length && (context.totalHotelOrders || context.totalShopOrders)) {
    return `
      <article class="card info-box">
        <p>No current hotel or Shop Here orders match ${escapeHtml(countyLabel)} right now, even though there are live records in the system.</p>
      </article>
    `;
  }

  return "";
}

function renderEmployeeShopOrderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText = items.length
    ? items.map((item) => `${item.qty || 1} x ${item.name}`).join(", ")
    : "No items recorded";

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Shop Here order</p>
          <h3>${escapeHtml(order.customerName || "Unknown customer")}</h3>
          <p class="tiny">${formatTime(order.createdAt)}</p>
        </div>
        <div class="inline-list">
          ${renderStatusPill(order.paid ? "Paid" : "Pending", order.paid ? "active" : "pending")}
          ${renderStatusPill(order.delivered ? "Delivered" : "Shopping", order.delivered ? "active" : "inactive")}
        </div>
      </div>

      <div class="order-meta-grid">
        <div class="meta-block">
          <span>Customer email</span>
          <strong>${escapeHtml(order.customerEmail || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Shop request</span>
          <strong>${escapeHtml(order.shopName || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Location</span>
          <strong>${escapeHtml(order.location || DEFAULT_HOTEL_LOCATION)}</strong>
        </div>
        <div class="meta-block">
          <span>Amount sent</span>
          <strong>KES ${escapeHtml(String(order.totalAmount || "0"))}</strong>
        </div>
      </div>

      <div class="notification-item feedback-message-card">
        <p><strong>Items requested:</strong> ${escapeHtml(itemsText)}</p>
      </div>

      <div class="button-row">
        <button
          class="button button-danger button-small employeeDeleteShopOrderBtn"
          data-order-id="${escapeHtml(order.id)}"
          type="button"
        >
          Delete
        </button>
      </div>
    </article>
  `;
}

function renderEmployeeMapModal(mapModal, mapMode) {
  const coordinates = normalizeCoordinates({
    latitude: mapModal?.latitude,
    longitude: mapModal?.longitude,
  });

  if (!coordinates) {
    return "";
  }

  const latitude = coordinates.latitude;
  const longitude = coordinates.longitude;
  const activeMode = mapMode === "satellite" ? "satellite" : "road";
  const previewUrl = activeMode === "satellite"
    ? buildSatelliteEmbedUrl(latitude, longitude)
    : buildRoadMapEmbedUrl(latitude, longitude);

  return `
    <section class="modal-backdrop employee-map-modal">
      <button class="modal-overlay" id="employeeMapBackdrop" type="button" aria-label="Close customer map"></button>
      <article class="card modal-card employee-map-card">
        <div class="section-head">
          <h4>Customer Map</h4>
          <button class="button button-outline button-small" id="closeEmployeeMap" type="button">Close</button>
        </div>

        <div class="summary-list">
          <div class="summary-item"><span>Customer</span><strong>${escapeHtml(mapModal.customerName || "Customer")}</strong></div>
          <div class="summary-item"><span>Area</span><strong>${escapeHtml(mapModal.customerArea || "Not shared")}</strong></div>
          <div class="summary-item"><span>Coordinates</span><strong>${escapeHtml(formatCoordinatePair(coordinates))}</strong></div>
        </div>

        <div class="button-row">
          <button class="button ${activeMode === "road" ? "button-primary" : "button-outline"} button-small employeeMapModeBtn" data-mode="road" type="button">
            Road Map
          </button>
          <button class="button ${activeMode === "satellite" ? "button-primary" : "button-outline"} button-small employeeMapModeBtn" data-mode="satellite" type="button">
            Reality View
          </button>
        </div>

        <div class="employee-map-frame-shell">
          <iframe
            class="employee-map-frame"
            src="${escapeHtml(previewUrl)}"
            title="Customer map preview"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>

        <div class="button-row employee-map-links">
          <a class="button button-outline button-small" href="${escapeHtml(buildRoadMapLink(latitude, longitude))}" target="_blank" rel="noreferrer">
            Open Road Map
          </a>
          <a class="button button-outline button-small" href="${escapeHtml(buildSatelliteLink(latitude, longitude))}" target="_blank" rel="noreferrer">
            Open Reality View
          </a>
        </div>

        <p class="tiny">Road map shows streets and routes. Reality view shows image-based surroundings.</p>
      </article>
    </section>
  `;
}

function buildRoadMapEmbedUrl(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const delta = 0.008;
  const left = (lon - delta).toFixed(6);
  const bottom = (lat - delta).toFixed(6);
  const right = (lon + delta).toFixed(6);
  const top = (lat + delta).toFixed(6);

  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

function buildRoadMapLink(latitude, longitude) {
  const lat = Number(latitude).toFixed(6);
  const lon = Number(longitude).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

function buildSatelliteEmbedUrl(latitude, longitude) {
  const lat = Number(latitude).toFixed(6);
  const lon = Number(longitude).toFixed(6);
  return `https://maps.google.com/maps?q=${lat},${lon}&hl=en&z=18&t=k&output=embed`;
}

function buildSatelliteLink(latitude, longitude) {
  const lat = Number(latitude).toFixed(6);
  const lon = Number(longitude).toFixed(6);
  return `https://maps.google.com/?q=${lat},${lon}&t=k`;
}
