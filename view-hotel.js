import { elements, getHotelById, getNotificationsForTarget, getRestaurantByHotelId, state } from "./state.js";
import { escapeHtml, formatCurrency, formatDateOnly, pluralize } from "./helpers.js";
import { renderBrowseMenuTabs, renderGateCard, renderInlineBadge, renderNotifications, renderStatusPill } from "./view-common.js";

export function renderHotelPortal() {
  if (!state.currentHotelId) {
    elements.app.innerHTML = `
      <section class="view-shell">
        ${
          state.restaurantDirectoryOpen
            ? `
                <article class="card launch-card launch-card--hub">
                  <p class="launch-eyebrow">Tamu Express</p>
                  <p class="launch-tagline">The fastest way to get what you want, right when you want it.</p>
                  <h2 class="launch-title">Around Umma University</h2>
                  <p class="launch-copy">Browse hotels, orders, and hotel tools.</p>
                  ${renderBrowseMenuTabs("hotel")}
                </article>
              `
            : ""
        }

        <div class="view-header">
          <div>
            <p class="eyebrow">Hotel workspace</p>
            <h2 class="view-title">Hotel Portal</h2>
            <p class="view-copy">Login or register.</p>
          </div>
        </div>

        <div class="two-column">
          <form id="hotelLogin" class="card auth-card">
            <p class="eyebrow">Returning hotel</p>
            <h3 class="card-title">Login</h3>

            <label class="field">
              <span class="field-label">Hotel name</span>
              <input class="input" name="hotelName" placeholder="Hotel name" />
            </label>

            <label class="field">
              <span class="field-label">Password</span>
              <input class="input" name="hotelPass" placeholder="Password" type="password" />
            </label>

            <button class="button button-primary" type="submit">Login</button>
          </form>

          <form id="hotelRegister" class="card auth-card">
            <p class="eyebrow">New hotel</p>
            <h3 class="card-title">Register</h3>

            <label class="field">
              <span class="field-label">Hotel name</span>
              <input class="input" name="hotelName" placeholder="Hotel name" />
            </label>

            <label class="field">
              <span class="field-label">Phone number</span>
              <input class="input" name="hotelPhone" placeholder="07XXXXXXXX" />
            </label>

            <label class="field">
              <span class="field-label">Password</span>
              <input class="input" name="hotelPass" placeholder="Password" type="password" />
            </label>

            <label class="field">
              <span class="field-label">Till number</span>
              <input class="input" name="hotelTill" placeholder="Till number" />
            </label>

            <button class="button button-secondary" type="submit">Register</button>
          </form>
        </div>
      </section>
    `;
    return;
  }

  const hotel = getHotelById(state.currentHotelId);
  if (!hotel.id) {
    state.currentHotelId = null;
    renderHotelPortal();
    return;
  }

  if (hotel.blocked) {
    elements.app.innerHTML = renderGateCard(
      "Hotel blocked",
      "This hotel account has been blocked by the admin. Contact support for access.",
      "logoutHotel",
      "Logout",
    );
    return;
  }

  if (!hotel.subscriptionExpiry || hotel.subscriptionExpiry < Date.now()) {
    elements.app.innerHTML = renderGateCard(
      "Subscription expired",
      "The hotel subscription has expired. Contact the admin to reactivate it.",
      "logoutHotel",
      "Logout",
    );
    return;
  }

  const hotelNotifications = getNotificationsForTarget(state.currentHotelId);
  const restaurant = getRestaurantByHotelId(state.currentHotelId) || { id: state.currentHotelId, menu: [] };
  const hotelOrders = state.orders
    .filter((order) => order.hotelId === state.currentHotelId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  elements.app.innerHTML = `
    <section class="view-shell">
      ${
        state.restaurantDirectoryOpen
          ? `
              <article class="card launch-card launch-card--hub">
                <p class="launch-eyebrow">Tamu Express</p>
                <p class="launch-tagline">The fastest way to get what you want, right when you want it.</p>
                <h2 class="launch-title">Around Umma University</h2>
                <p class="launch-copy">Browse hotels, orders, and hotel tools.</p>
                ${renderBrowseMenuTabs("hotel")}
              </article>
            `
          : ""
      }

      <div class="view-header">
        <div>
          <p class="eyebrow">Hotel dashboard</p>
          <h2 class="view-title">${escapeHtml(hotel.name)}</h2>
          <p class="view-copy">Menu, notifications, and orders.</p>
        </div>

        <div class="toolbar">
          <button class="button button-outline" data-toggle-panel="hotelNotifBox" type="button">
            Notifications
            ${renderInlineBadge(hotelNotifications.filter((item) => !item.read).length, "alert")}
          </button>
          <button class="button button-secondary" id="logoutHotel" type="button">Logout</button>
        </div>
      </div>

      <div id="hotelNotifBox" class="disclosure-card is-hidden">
        ${renderNotifications(hotelNotifications)}
      </div>

      <div class="dashboard-grid">
        <article class="card">
          <div class="section-head">
            <h4>Hotel Summary</h4>
            ${renderStatusPill("Active", "active")}
          </div>

          <div class="summary-list">
            <div class="summary-item"><span>Phone</span><strong>${escapeHtml(hotel.phone || "N/A")}</strong></div>
            <div class="summary-item"><span>Till</span><strong>${escapeHtml(hotel.till || "N/A")}</strong></div>
            <div class="summary-item"><span>Approved</span><strong>${hotel.approved ? "Yes" : "No"}</strong></div>
            <div class="summary-item"><span>Subscription ends</span><strong>${formatDateOnly(hotel.subscriptionExpiry)}</strong></div>
          </div>
        </article>

        <article class="card action-card">
          <div class="section-head">
            <h4>Menu Manager</h4>
            <span class="summary-chip">${restaurant.menu?.length || 0} item${pluralize(restaurant.menu?.length || 0)}</span>
          </div>

          <form id="addMenu" class="stack">
            <label class="field">
              <span class="field-label">Item name</span>
              <input class="input" name="itemName" placeholder="Pilau, chapati, tea..." />
            </label>

            <label class="field">
              <span class="field-label">Price</span>
              <input class="input" name="itemPrice" placeholder="Price in KSh" type="number" />
            </label>

            <button class="button button-primary" type="submit">Add Menu Item</button>
          </form>

          ${
            restaurant.menu?.length
              ? `<div class="menu-admin-list">
                  ${restaurant.menu
                    .map(
                      (item, index) => `
                        <div class="menu-item">
                          <div>
                            <p class="menu-item-name">${escapeHtml(item.name)}</p>
                            <p class="item-price">${formatCurrency(item.price)}</p>
                          </div>
                          <button
                            class="button button-danger-soft button-small removeMenu"
                            data-index="${escapeHtml(String(index))}"
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      `,
                    )
                    .join("")}
                </div>`
              : `<div class="notification-item"><p class="is-muted">Add the first menu item so customers can order.</p></div>`
          }
        </article>
      </div>

      <section class="view-shell">
        <div class="section-head">
          <h4>Orders for ${escapeHtml(hotel.name)}</h4>
          <span class="summary-chip">${hotelOrders.length} order${pluralize(hotelOrders.length)}</span>
        </div>
        ${
          hotelOrders.length
            ? `<div class="order-list">${hotelOrders.map(renderHotelOrderCard).join("")}</div>`
            : `<div class="notification-item"><p class="is-muted">No orders have been placed for this hotel yet.</p></div>`
        }
      </section>
    </section>
  `;
}

function renderHotelOrderCard(order) {
  return `
    <article class="card order-card">
      <div class="order-header">
        <div>
          <p class="eyebrow">Order detail</p>
          <h3>${escapeHtml(order.customerName || "Unknown customer")}</h3>
          <p class="tiny">${escapeHtml(order.customerPhone || "N/A")}</p>
        </div>
        ${renderStatusPill(order.status || "Pending")}
      </div>

      <div class="menu-list">
        ${(order.items || [])
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
          .join("")}
      </div>

      <div class="button-row">
        ${
          order.status !== "Paid"
            ? `<button class="button button-success markPaid" data-id="${escapeHtml(order.id)}" type="button">Mark Paid</button>`
            : ""
        }
        <button class="button button-danger deleteOrder" data-id="${escapeHtml(order.id)}" type="button">Delete Order</button>
      </div>
    </article>
  `;
}
