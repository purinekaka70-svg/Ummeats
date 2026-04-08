import { SERVICE_FEE, SERVICE_FEE_TILL } from "./config.js";
import { elements, getCartItemsTotal, getHotelById, getHotelLocation, getNotificationsForTarget, state } from "./state.js";
import { escapeHtml, formatCoordinatePair, formatCurrency, formatDateOnly, formatDistanceKm, formatTime, normalizeCoordinates, pluralize } from "./helpers.js";
import { renderEmptyState, renderInlineBadge, renderNotifications, renderStatusPill } from "./view-common.js";

export function renderAdmin() {
  if (!state.currentAdmin) {
    elements.app.innerHTML = `
      <section class="view-shell">
        <div class="view-header">
          <div>
            <h2 class="view-title">Admin</h2>
          </div>
        </div>

        <form id="adminLogin" class="card auth-card">
          <label class="field">
            <span class="field-label">Admin email</span>
            <input class="input" name="adminEmail" placeholder="admin@example.com" type="email" />
          </label>

          <label class="field">
            <span class="field-label">Password</span>
            <input class="input" name="adminPass" placeholder="Password" type="password" />
          </label>

          <p class="tiny">Use the admin account you added in Firebase Authentication.</p>
          <button class="button button-primary" type="submit">Login</button>
        </form>
      </section>
    `;
    return;
  }

  const adminNotifications = getNotificationsForTarget("admin");
  const approvedHotels = state.hotels.filter((hotel) => hotel.approved).length;
  const blockedHotels = state.hotels.filter((hotel) => hotel.blocked).length;
  const pendingHotels = state.hotels.filter((hotel) => !hotel.approved).length;
  const activeSubscriptions = state.hotels.filter(
    (hotel) => hotel.subscriptionExpiry && hotel.subscriptionExpiry >= Date.now(),
  ).length;
  const paidOrders = state.orders.filter((order) => (order.status || "Pending") === "Paid").length;
  const pendingOrders = state.orders.filter((order) => (order.status || "Pending") !== "Paid").length;
  const totalShopOrders = state.ummaShopOrders.length;
  const pendingShopOrders = state.ummaShopOrders.filter((order) => !order.paid).length;
  const totalFeedbacks = state.feedbacks.length;
  const totalEmployees = state.employees.length;
  const totalNotifications = state.notifications.length;
  const unreadStoredNotifications = state.notifications.filter((item) => !item.read).length;
  const unreadFeedbacks = state.feedbacks.filter((item) => (item.status || "New") !== "Reviewed").length;
  const totalOrders = state.orders.length;
  const currentSection = state.adminPanelSection || "dashboard";
  const unreadNotifications = adminNotifications.filter((item) => !item.read).length;

  elements.app.innerHTML = `
    <section class="view-shell admin-panel-shell">
      <aside class="card admin-sidebar ${state.adminSidebarOpen ? "is-open" : ""}" aria-label="Admin navigation">
        <div class="admin-sidebar-head">
          <div>
            <p class="eyebrow">Admin menu</p>
            <h3 class="card-title">Control Center</h3>
          </div>
          <button class="button button-ghost button-small admin-sidebar-close" id="adminSidebarClose" type="button">
            Close
          </button>
        </div>

        <div class="admin-nav-list">
          ${renderAdminNavButton("dashboard", "Dashboard", `${pendingOrders} pending orders`, currentSection)}
          ${renderAdminNavButton("hotels", "Registered Hotels", `${state.hotels.length} hotel${pluralize(state.hotels.length)}`, currentSection)}
          ${renderAdminNavButton("orders", "Orders", `${totalOrders} total order${pluralize(totalOrders)}`, currentSection)}
          ${renderAdminNavButton("shopOrders", "Shop Here Orders", `${totalShopOrders} shop order${pluralize(totalShopOrders)}`, currentSection)}
          ${renderAdminNavButton("feedbacks", "Feedbacks", `${unreadFeedbacks} open complaint${pluralize(unreadFeedbacks)}`, currentSection)}
          ${renderAdminNavButton("employees", "Employees", `${totalEmployees} account${pluralize(totalEmployees)}`, currentSection)}
          ${renderAdminNavButton("notifications", "Notifications", `${totalNotifications} alert${pluralize(totalNotifications)}`, currentSection)}
        </div>

        <div class="info-box admin-sidebar-note">
          <p>Open a section from this menu to review hotels, track orders, handle feedback, and manage employee and notification records.</p>
        </div>
      </aside>

      ${state.adminSidebarOpen ? `<button class="admin-sidebar-backdrop" id="adminSidebarBackdrop" type="button" aria-label="Close admin navigation"></button>` : ""}

      <div class="admin-main-stack">
        <div class="view-header admin-main-header">
          <div>
            <p class="eyebrow">Admin workspace</p>
            <h2 class="view-title">Admin Panel</h2>
            <p class="view-copy">Monitor all registered hotels and every order placed on the platform.</p>
          </div>

          <div class="toolbar">
            <button class="button button-outline admin-menu-button" id="adminMenuToggle" type="button">
              <span class="hamburger-icon" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
              Menu
            </button>
            <button class="button button-outline" data-toggle-panel="adminNotifBox" type="button">
              Notifications
              ${renderInlineBadge(unreadNotifications, "alert")}
            </button>
            <button class="button button-ghost" id="logoutAdmin" type="button">Logout</button>
          </div>
        </div>

        <div id="adminNotifBox" class="disclosure-card is-hidden">
          ${renderNotifications(adminNotifications)}
        </div>

        ${renderAdminSection(currentSection, {
          activeSubscriptions,
          approvedHotels,
          blockedHotels,
          paidOrders,
          pendingHotels,
          pendingOrders,
          pendingShopOrders,
          totalFeedbacks,
          totalEmployees,
          totalOrders,
          totalNotifications,
          totalShopOrders,
          unreadFeedbacks,
          unreadNotifications,
          unreadStoredNotifications,
        })}
      </div>
    </section>
  `;
}

function renderAdminNavButton(sectionId, label, meta, currentSection) {
  const activeClass = currentSection === sectionId ? " is-active" : "";

  return `
    <button
      class="adminNavBtn admin-nav-btn${activeClass}"
      data-section="${escapeHtml(sectionId)}"
      type="button"
    >
      <span class="admin-nav-copy">
        <span class="admin-nav-title">${escapeHtml(label)}</span>
        <span class="admin-nav-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="summary-chip admin-nav-pill">${escapeHtml(label)}</span>
    </button>
  `;
}

function renderAdminSection(section, summary) {
  if (section === "hotels") {
    return renderRegisteredHotelsSection();
  }

  if (section === "orders") {
    return renderOrdersSection();
  }

  if (section === "shopOrders") {
    return renderShopOrdersSection();
  }

  if (section === "feedbacks") {
    return renderFeedbacksSection();
  }

  if (section === "employees") {
    return renderEmployeesSection();
  }

  if (section === "notifications") {
    return renderNotificationsSection();
  }

  return renderDashboardSection(summary);
}

function renderDashboardSection(summary) {
  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Dashboard</h4>
        <span class="summary-chip">${summary.totalOrders} order${pluralize(summary.totalOrders)}</span>
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">Hotels</span>
          <strong>${state.hotels.length}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Approved</span>
          <strong>${summary.approvedHotels}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Awaiting Approval</span>
          <strong>${summary.pendingHotels}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Blocked</span>
          <strong>${summary.blockedHotels}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Active Subscriptions</span>
          <strong>${summary.activeSubscriptions}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Pending Orders</span>
          <strong>${summary.pendingOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Paid Orders</span>
          <strong>${summary.paidOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Shop Here Orders</span>
          <strong>${summary.totalShopOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Shop Here Pending</span>
          <strong>${summary.pendingShopOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Unread Alerts</span>
          <strong>${summary.unreadNotifications}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Feedbacks</span>
          <strong>${summary.totalFeedbacks}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Employees</span>
          <strong>${summary.totalEmployees}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Saved Alerts</span>
          <strong>${summary.totalNotifications}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Open Complaints</span>
          <strong>${summary.unreadFeedbacks}</strong>
        </article>
      </div>

      <div class="two-column">
        <article class="card">
          <div class="section-head">
            <h4>Platform Summary</h4>
            ${renderStatusPill(summary.pendingOrders ? "Action Needed" : "Stable", summary.pendingOrders ? "pending" : "active")}
          </div>
          <div class="summary-list">
            <div class="summary-item"><span>Registered hotels</span><strong>${state.hotels.length}</strong></div>
            <div class="summary-item"><span>Orders placed</span><strong>${summary.totalOrders}</strong></div>
            <div class="summary-item"><span>Orders still pending</span><strong>${summary.pendingOrders}</strong></div>
            <div class="summary-item"><span>Shop Here orders</span><strong>${summary.totalShopOrders}</strong></div>
            <div class="summary-item"><span>Hotels awaiting approval</span><strong>${summary.pendingHotels}</strong></div>
          </div>
        </article>

        <article class="card">
          <div class="section-head">
            <h4>Admin Actions</h4>
            ${renderStatusPill("Live Data", "active")}
          </div>
          <div class="summary-list">
            <div class="summary-item"><span>Use Orders</span><strong>Mark paid or delete</strong></div>
            <div class="summary-item"><span>Use Shop Here Orders</span><strong>Manage separate shopping requests</strong></div>
            <div class="summary-item"><span>Use Registered Hotels</span><strong>Approve and manage</strong></div>
            <div class="summary-item"><span>Use Feedbacks</span><strong>Review support complaints</strong></div>
            <div class="summary-item"><span>Use Employees</span><strong>Remove employee profiles</strong></div>
            <div class="summary-item"><span>Use Notifications</span><strong>Mark read or delete</strong></div>
            <div class="summary-item"><span>Notifications</span><strong>${summary.unreadNotifications} unread</strong></div>
          </div>
        </article>
      </div>

      <article class="card">
        <div class="split-row">
          <div>
            <h3 class="card-title">Danger Zone</h3>
            <p class="card-copy">This permanently deletes every hotel, menu, order, feedback, notification, and push subscription.</p>
          </div>
          <button class="button button-danger" id="clearAll" type="button">Clear All Data</button>
        </div>
      </article>
    </section>
  `;
}

function renderRegisteredHotelsSection() {
  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Registered Hotels</h4>
        <span class="summary-chip">${state.hotels.length} hotel${pluralize(state.hotels.length)}</span>
      </div>

      ${
        state.hotels.length
          ? `<div class="menu-list">${state.hotels.map(renderAdminHotelCard).join("")}</div>`
          : renderEmptyState("No hotels yet", "Hotels will appear here after they register on the platform.")
      }
    </section>
  `;
}

function renderOrdersSection() {
  const orders = [...state.orders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Orders</h4>
        <span class="summary-chip">${orders.length} order${pluralize(orders.length)}</span>
      </div>

      ${
        orders.length
          ? `<div class="order-list">${orders.map(renderAdminOrderCard).join("")}</div>`
          : renderEmptyState("No orders yet", "Placed orders will appear here for the admin immediately.")
      }
    </section>
  `;
}

function renderFeedbacksSection() {
  const feedbacks = [...state.feedbacks].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Feedbacks</h4>
        <span class="summary-chip">${feedbacks.length} complaint${pluralize(feedbacks.length)}</span>
      </div>

      ${
        feedbacks.length
          ? `<div class="order-list">${feedbacks.map(renderFeedbackCard).join("")}</div>`
          : renderEmptyState("No feedback yet", "Customer complaints and support feedback will appear here.")
      }
    </section>
  `;
}

function renderShopOrdersSection() {
  const orders = [...state.ummaShopOrders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Shop Here Orders</h4>
        <span class="summary-chip">${orders.length} shop order${pluralize(orders.length)}</span>
      </div>

      ${
        orders.length
          ? `<div class="order-list">${orders.map(renderShopOrderCard).join("")}</div>`
          : renderEmptyState("No Shop Here orders yet", "Orders placed through the shopping page will appear here separately from hotel orders.")
      }
    </section>
  `;
}

function renderEmployeesSection() {
  const employees = [...state.employees].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Employees</h4>
        <span class="summary-chip">${employees.length} account${pluralize(employees.length)}</span>
      </div>

      ${
        employees.length
          ? `<div class="order-list">${employees.map(renderEmployeeCard).join("")}</div>`
          : renderEmptyState("No employees yet", "Employee accounts will appear here after registration.")
      }
    </section>
  `;
}

function renderNotificationsSection() {
  const notifications = [...state.notifications].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));

  return `
    <section class="view-shell">
      <div class="section-head">
        <h4>Notifications</h4>
        <span class="summary-chip">${notifications.length} alert${pluralize(notifications.length)}</span>
      </div>

      ${
        notifications.length
          ? `<div class="order-list">${notifications.map(renderAdminNotificationCard).join("")}</div>`
          : renderEmptyState("No notifications yet", "Saved alert records will appear here.")
      }
    </section>
  `;
}

function renderAdminHotelCard(hotel) {
  const subscriptionActive = hotel.subscriptionExpiry && hotel.subscriptionExpiry >= Date.now();

  return `
    <article class="admin-hotel-card">
      <div class="split-row">
        <div class="stack">
          <div>
            <p class="eyebrow">Hotel account</p>
            <h3 class="card-title">${escapeHtml(hotel.name)}</h3>
          </div>
          <div class="summary-list">
            <div class="summary-item"><span>Phone</span><strong>${escapeHtml(hotel.phone || "N/A")}</strong></div>
            <div class="summary-item"><span>Till</span><strong>${escapeHtml(hotel.till || "N/A")}</strong></div>
            <div class="summary-item"><span>Location</span><strong>${escapeHtml(getHotelLocation(hotel))}</strong></div>
            <div class="summary-item"><span>Delivery map point</span><strong>${normalizeCoordinates(hotel.coordinates) ? "Saved" : "Missing"}</strong></div>
            <div class="summary-item"><span>Coordinates</span><strong>${escapeHtml(formatCoordinatePair(hotel.coordinates))}</strong></div>
            <div class="summary-item"><span>Approved</span><strong>${hotel.approved ? "Yes" : "No"}</strong></div>
            <div class="summary-item"><span>Blocked</span><strong>${hotel.blocked ? "Yes" : "No"}</strong></div>
            <div class="summary-item"><span>Subscription</span><strong>${formatDateOnly(hotel.subscriptionExpiry)}</strong></div>
          </div>
        </div>

        <div class="inline-list">
          ${renderStatusPill(subscriptionActive ? "Active" : "Expired", subscriptionActive ? "active" : "expired")}
          ${renderStatusPill(hotel.blocked ? "Blocked" : "Open", hotel.blocked ? "blocked" : "inactive")}
        </div>
      </div>

      <div class="button-row">
        <button class="button button-danger-soft button-small toggleBlock" data-id="${escapeHtml(hotel.id)}" type="button">
          ${hotel.blocked ? "Unblock" : "Block"}
        </button>
        ${
          !hotel.approved
            ? `<button class="button button-success button-small approveHotel" data-id="${escapeHtml(hotel.id)}" type="button">Approve</button>`
            : ""
        }
        <button class="button button-primary button-small activateSub" data-id="${escapeHtml(hotel.id)}" type="button">
          Activate
        </button>
        <button class="button button-outline button-small expireSub" data-id="${escapeHtml(hotel.id)}" type="button">
          Expire Now
        </button>
      </div>
    </article>
  `;
}

function renderShopOrderCard(order) {
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
          <strong>${escapeHtml(order.location || "Around Umma University")}</strong>
        </div>
        <div class="meta-block">
          <span>Amount sent</span>
          <strong>KES ${escapeHtml(String(order.totalAmount || "0"))}</strong>
        </div>
        <div class="meta-block">
          <span>Payment code</span>
          <strong>${escapeHtml(order.mpesaCode || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Order source</span>
          <strong>Shop Here</strong>
        </div>
      </div>

      <div class="notification-item feedback-message-card">
        <p><strong>Items requested:</strong> ${escapeHtml(itemsText)}</p>
      </div>

      <div class="button-row">
        ${
          order.paid
            ? ""
            : `<button class="button button-success markShopOrderPaid" data-id="${escapeHtml(order.id)}" type="button">Mark as Paid</button>`
        }
        ${
          order.delivered
            ? ""
            : `<button class="button button-secondary markShopOrderDelivered" data-id="${escapeHtml(order.id)}" type="button">Mark Delivered</button>`
        }
        <button class="button button-danger deleteShopOrder" data-id="${escapeHtml(order.id)}" type="button">Delete Order</button>
      </div>
    </article>
  `;
}

function renderAdminOrderCard(order) {
  const hotel = getHotelById(order.hotelId);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsTotal = items.length ? getCartItemsTotal(items) : Number(order.itemsTotal || 0);
  const total = Number(order.total || itemsTotal + Number(order.serviceFee ?? SERVICE_FEE));

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Order detail</p>
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
          <span>Hotel till</span>
          <strong>${escapeHtml(hotel.till || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Location</span>
          <strong>${escapeHtml(getHotelLocation(hotel))}</strong>
        </div>
        <div class="meta-block">
          <span>Service fee till</span>
          <strong>${escapeHtml(order.serviceFeeTill || SERVICE_FEE_TILL)}</strong>
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
        <div class="summary-item"><span>Area</span><strong>${escapeHtml(order.customerArea || "Not shared")}</strong></div>
        <div class="summary-item"><span>Specific area</span><strong>${escapeHtml(order.customerSpecificArea || "Not shared")}</strong></div>
        <div class="summary-item"><span>Total</span><strong>${formatCurrency(total)}</strong></div>
        <div class="summary-item"><span>M-PESA name</span><strong>${escapeHtml(order.mpesaName || "N/A")}</strong></div>
        <div class="summary-item"><span>M-PESA number</span><strong>${escapeHtml(order.mpesaNumber || "N/A")}</strong></div>
      </div>

      <div class="button-row">
        ${
          order.status !== "Paid"
            ? `<button class="button button-success markPaid" data-id="${escapeHtml(order.id)}" type="button">Mark as Paid</button>`
            : ""
        }
        <button class="button button-danger deleteOrder" data-id="${escapeHtml(order.id)}" type="button">Delete Order</button>
      </div>
    </article>
  `;
}

function renderFeedbackCard(feedback) {
  const feedbackStatus = feedback.status || "New";

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Customer feedback</p>
          <h3>${escapeHtml(feedback.name || "Anonymous sender")}</h3>
          <p class="tiny">${formatTime(feedback.createdAt)}</p>
        </div>
        ${renderStatusPill(feedbackStatus, feedbackStatus === "Reviewed" ? "active" : "pending")}
      </div>

      <div class="order-meta-grid">
        <div class="meta-block">
          <span>Phone</span>
          <strong>${escapeHtml(feedback.phone || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Type</span>
          <strong>Support complaint</strong>
        </div>
      </div>

      <div class="notification-item feedback-message-card">
        <p>${escapeHtml(feedback.message || "No message provided.")}</p>
      </div>

      <div class="button-row">
        ${
          feedbackStatus !== "Reviewed"
            ? `<button class="button button-success resolveFeedback" data-id="${escapeHtml(feedback.id)}" type="button">Mark Reviewed</button>`
            : ""
        }
        <button class="button button-danger deleteFeedback" data-id="${escapeHtml(feedback.id)}" type="button">Delete Feedback</button>
      </div>
    </article>
  `;
}

function renderEmployeeCard(employee) {
  const status = String(employee.status || "active").trim().toLowerCase() === "blocked" ? "Blocked" : "Active";
  const hasScannedId = Boolean(employee.idCardUploaded || employee.idCardDatabasePath || employee.idCardUrl);

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Employee account</p>
          <h3>${escapeHtml(employee.fullName || "Unknown employee")}</h3>
          <p class="tiny">${formatTime(employee.createdAt)}</p>
        </div>
        ${renderStatusPill(status, status === "Active" ? "active" : "blocked")}
      </div>

      <div class="order-meta-grid">
        <div class="meta-block">
          <span>Email</span>
          <strong>${escapeHtml(employee.email || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>ID number</span>
          <strong>${escapeHtml(employee.idNumber || "N/A")}</strong>
        </div>
        <div class="meta-block">
          <span>Scanned ID</span>
          <strong>${hasScannedId ? "Uploaded" : "Missing"}</strong>
        </div>
        <div class="meta-block">
          <span>UID</span>
          <strong>${escapeHtml(employee.uid || employee.id || "N/A")}</strong>
        </div>
      </div>

      <div class="button-row">
        <button class="button button-danger deleteEmployee" data-id="${escapeHtml(employee.id)}" type="button">Delete Employee</button>
      </div>
    </article>
  `;
}

function renderAdminNotificationCard(notification) {
  const notificationType = String(notification.type || "notification").trim() || "notification";
  const notificationTarget = String(notification.to || "N/A").trim() || "N/A";
  const isRead = Boolean(notification.read);

  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Notification</p>
          <h3>${escapeHtml(notificationType)}</h3>
          <p class="tiny">${formatTime(notification.timestamp)}</p>
        </div>
        ${renderStatusPill(isRead ? "Read" : "New", isRead ? "active" : "pending")}
      </div>

      <div class="order-meta-grid">
        <div class="meta-block">
          <span>Target</span>
          <strong>${escapeHtml(notificationTarget)}</strong>
        </div>
        <div class="meta-block">
          <span>Message</span>
          <strong>${escapeHtml(notification.message || "Notification")}</strong>
        </div>
      </div>

      <div class="button-row">
        ${
          isRead
            ? ""
            : `<button class="button button-outline markNotifRead" data-id="${escapeHtml(notification.id)}" type="button">Mark Read</button>`
        }
        <button class="button button-danger deleteNotification" data-id="${escapeHtml(notification.id)}" type="button">Delete Notification</button>
      </div>
    </article>
  `;
}
