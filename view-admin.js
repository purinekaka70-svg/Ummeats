import { elements, getNotificationsForTarget, state } from "./state.js";
import { escapeHtml, formatDateOnly, pluralize } from "./helpers.js";
import { renderInlineBadge, renderNotifications, renderStatusPill } from "./view-common.js";

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
            <span class="field-label">Username</span>
            <input class="input" name="adminUser" placeholder="Username" />
          </label>

          <label class="field">
            <span class="field-label">Password</span>
            <input class="input" name="adminPass" placeholder="Password" type="password" />
          </label>

          <button class="button button-primary" type="submit">Login</button>
        </form>
      </section>
    `;
    return;
  }

  const adminNotifications = getNotificationsForTarget("admin");
  const approvedHotels = state.hotels.filter((hotel) => hotel.approved).length;
  const activeSubscriptions = state.hotels.filter(
    (hotel) => hotel.subscriptionExpiry && hotel.subscriptionExpiry >= Date.now(),
  ).length;
  const totalOrders = state.orders.length;

  elements.app.innerHTML = `
    <section class="view-shell">
      <div class="view-header">
        <div>
          <h2 class="view-title">Admin Panel</h2>
        </div>

        <div class="toolbar">
          <button class="button button-outline" data-toggle-panel="adminNotifBox" type="button">
            Notifications
            ${renderInlineBadge(adminNotifications.filter((item) => !item.read).length, "alert")}
          </button>
          <button class="button button-ghost" id="logoutAdmin" type="button">Logout</button>
        </div>
      </div>

      <div id="adminNotifBox" class="disclosure-card is-hidden">
        ${renderNotifications(adminNotifications)}
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">Hotels</span>
          <strong>${state.hotels.length}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Approved</span>
          <strong>${approvedHotels}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Active Subscriptions</span>
          <strong>${activeSubscriptions}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">Orders</span>
          <strong>${totalOrders}</strong>
        </article>
      </div>

      <article class="card">
        <div class="split-row">
          <div>
            <h3 class="card-title">Danger Zone</h3>
            <p class="card-copy">This permanently deletes every hotel, menu, order, and notification.</p>
          </div>
          <button class="button button-danger" id="clearAll" type="button">Clear All Data</button>
        </div>
      </article>

      <section class="view-shell">
        <div class="section-head">
          <h4>Registered Hotels</h4>
          <span class="summary-chip">${state.hotels.length} hotel${pluralize(state.hotels.length)}</span>
        </div>

        ${
          state.hotels.length
            ? `<div class="menu-list">${state.hotels.map(renderAdminHotelCard).join("")}</div>`
            : `<div class="notification-item"><p class="is-muted">No hotels have registered yet.</p></div>`
        }
      </section>
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
