import { DEFAULT_HOTEL_LOCATION, SERVICE_FEE } from "./config.js";
import { elements } from "./state.js";
import {
  escapeHtml,
  formatCoordinatePair,
  formatCurrency,
  formatDateOnly,
  formatDistanceKm,
  formatTime,
  pluralize,
} from "./helpers.js";
import { renderEmptyState, renderStatusPill } from "./view-common.js";

export function renderEmployeePortal(portalState) {
  if (!portalState.currentUser) {
    elements.app.innerHTML = renderEmployeeAuth();
    return;
  }

  if (portalState.profileStatus === "loading") {
    elements.app.innerHTML = renderEmployeeLoading();
    return;
  }

  if (!portalState.employeeProfile) {
    elements.app.innerHTML = renderMissingEmployeeProfile();
    return;
  }

  if (String(portalState.employeeProfile.status || "active").toLowerCase() === "blocked") {
    elements.app.innerHTML = renderBlockedEmployeeProfile();
    return;
  }

  elements.app.innerHTML = renderEmployeeDashboard(portalState);
}

function renderEmployeeAuth() {
  return `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <p class="eyebrow">Employee workspace</p>
          <h2 class="view-title">Employee Portal</h2>
          <p class="view-copy">Create an employee account with Firebase login, upload an ID card, and view live orders in read-only mode.</p>
        </div>
      </div>

      <div class="two-column employee-portal-grid">
        <form id="employeeLogin" class="card auth-card">
          <p class="eyebrow">Returning employee</p>
          <h3 class="card-title">Login</h3>

          <label class="field">
            <span class="field-label">Email</span>
            <input class="input" name="employeeEmail" placeholder="employee@example.com" type="email" />
          </label>

          <label class="field">
            <span class="field-label">Password</span>
            <input class="input" name="employeePass" placeholder="Password" type="password" />
          </label>

          <p class="tiny">Use the same employee email and password you created on this page.</p>
          <button class="button button-primary" type="submit">Login</button>
        </form>

        <form id="employeeRegister" class="card auth-card">
          <p class="eyebrow">New employee</p>
          <h3 class="card-title">Create Account</h3>

          <label class="field">
            <span class="field-label">Full name</span>
            <input class="input" name="employeeName" placeholder="Employee full name" />
          </label>

          <label class="field">
            <span class="field-label">Email</span>
            <input class="input" name="employeeEmail" placeholder="employee@example.com" type="email" />
          </label>

          <label class="field">
            <span class="field-label">ID number</span>
            <input class="input" name="employeeIdNumber" placeholder="National ID number" />
          </label>

          <label class="field">
            <span class="field-label">ID card upload</span>
            <input class="input input-file" accept="image/*,.pdf,application/pdf" name="employeeIdCard" type="file" />
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

          <p class="tiny">Upload a clear ID card image or PDF. Employee access is read-only and shows live platform orders only.</p>
          <button class="button button-secondary" type="submit">Create Employee Account</button>
        </form>
      </div>
    </section>
  `;
}

function renderEmployeeLoading() {
  return `
    <section class="view-shell">
      <article class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Employee access</p>
            <h2 class="view-title">Preparing workspace</h2>
            <p class="view-copy">Checking your employee account and loading live orders.</p>
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
            <p class="view-copy">This employee account is currently blocked. Contact the admin for help.</p>
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
  const orders = [...portalState.orders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const shopOrders = [...portalState.ummaShopOrders].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const pendingOrders = orders.filter((item) => (item.status || "Pending") !== "Paid").length;
  const paidOrders = orders.length - pendingOrders;

  return `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <p class="eyebrow">Employee workspace</p>
          <h2 class="view-title">Employee Orders Panel</h2>
          <p class="view-copy">Read-only access to live hotel and Shop Here orders.</p>
        </div>

        <div class="toolbar">
          <span class="summary-chip">${escapeHtml(profile.fullName || profile.email || "Employee")}</span>
          <button class="button button-ghost" id="logoutEmployee" type="button">Logout</button>
        </div>
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">Hotel Orders</span>
          <strong>${orders.length}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Pending</span>
          <strong>${pendingOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Paid</span>
          <strong>${paidOrders}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Shop Here</span>
          <strong>${shopOrders.length}</strong>
        </article>
      </div>

      <div class="two-column employee-portal-grid">
        <article class="card">
          <div class="section-head">
            <h4>Employee Profile</h4>
            ${renderStatusPill(String(profile.status || "Active"), String(profile.status || "active").toLowerCase() === "active" ? "active" : "inactive")}
          </div>

          <div class="summary-list">
            <div class="summary-item"><span>Full name</span><strong>${escapeHtml(profile.fullName || "N/A")}</strong></div>
            <div class="summary-item"><span>Email</span><strong>${escapeHtml(profile.email || "N/A")}</strong></div>
            <div class="summary-item"><span>ID number</span><strong>${escapeHtml(profile.idNumber || "N/A")}</strong></div>
            <div class="summary-item"><span>ID card</span><strong>${profile.idCardUrl ? "Uploaded" : "Missing"}</strong></div>
            <div class="summary-item"><span>Joined</span><strong>${formatDateOnly(profile.createdAt)}</strong></div>
          </div>

          ${
            profile.idCardUrl
              ? `
                  <div class="button-row">
                    <a class="button button-outline button-small" href="${escapeHtml(profile.idCardUrl)}" target="_blank" rel="noreferrer">
                      Open ID Card
                    </a>
                  </div>
                `
              : ""
          }
        </article>

        <article class="card">
          <div class="section-head">
            <h4>Portal Access</h4>
            ${renderStatusPill("Read Only", "inactive")}
          </div>

          <div class="summary-list">
            <div class="summary-item"><span>What you can do</span><strong>View live orders</strong></div>
            <div class="summary-item"><span>Hotel orders</span><strong>${orders.length}</strong></div>
            <div class="summary-item"><span>Shop Here orders</span><strong>${shopOrders.length}</strong></div>
            <div class="summary-item"><span>Hotels listed</span><strong>${portalState.hotels.length}</strong></div>
          </div>

          <p class="tiny">This employee page does not change orders, payments, or hotel settings. It only displays live order activity.</p>
        </article>
      </div>

      <section class="view-shell">
        <div class="section-head">
          <h4>Hotel Orders</h4>
          <span class="summary-chip">${orders.length} order${pluralize(orders.length)}</span>
        </div>

        ${
          orders.length
            ? `<div class="order-list">${orders.map((order) => renderEmployeeOrderCard(order, portalState.hotels)).join("")}</div>`
            : renderEmptyState("No hotel orders yet", "Live hotel orders will appear here for employees.")
        }
      </section>

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

function renderEmployeeOrderCard(order, hotels) {
  const hotel = getHotelForOrder(hotels, order.hotelId);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsTotal = items.length
    ? items.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 1), 0)
    : Number(order.itemsTotal || 0);
  const total = Number(order.total || itemsTotal + Number(order.serviceFee ?? SERVICE_FEE));

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
          <strong>${escapeHtml(order.customerArea || "Not shared")}</strong>
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
        <div class="summary-item"><span>Customer map point</span><strong>${escapeHtml(formatCoordinatePair(order.customerCoordinates))}</strong></div>
        <div class="summary-item"><span>Total</span><strong>${formatCurrency(total)}</strong></div>
      </div>
    </article>
  `;
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
    </article>
  `;
}
