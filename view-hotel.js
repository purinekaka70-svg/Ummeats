import { DEFAULT_HOTEL_LOCATION } from "./config.js";
import { elements, getHotelById, getHotelLocation, getNotificationsForTarget, getRestaurantByHotelId, state } from "./state.js";
import {
  buildWhatsAppLink,
  escapeHtml,
  formatCoordinatePair,
  formatDistanceKm,
  formatCurrency,
  formatDateOnly,
  getMenuScheduleDetails,
  MENU_DAY_OPTIONS,
  MENU_MEAL_PERIOD_OPTIONS,
  normalizeCoordinates,
  pluralize,
  sortMenuItems,
} from "./helpers.js";
import { renderBrowseMenuTabs, renderGateCard, renderInlineBadge, renderNotifications, renderStatusPill } from "./view-common.js";

export function renderHotelPortal() {
  if (!state.currentHotelId) {
    const authView = state.hotelAuthView === "register" ? "register" : "login";
    const loginHiddenClass = authView === "register" ? " is-hidden" : "";
    const registerHiddenClass = authView === "register" ? "" : " is-hidden";

    elements.app.innerHTML = `
      <section class="view-shell">
        ${
          state.restaurantDirectoryOpen
            ? `
                <article class="card launch-card launch-card--hub">
                  <p class="launch-eyebrow">Tamu Express</p>
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
            <p class="view-copy">Login or register. New accounts wait for admin approval and activation.</p>
          </div>
        </div>

        <div class="auth-flow-grid">
          <form id="hotelLogin" class="card auth-card${loginHiddenClass}">
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

            <button class="button button-primary button-small" type="submit">Login</button>
            <p class="tiny auth-switch">
              Don&apos;t have an account?
              <button class="auth-switch-btn hotelAuthSwitchBtn" data-hotel-auth-view="register" type="button">Register</button>
            </p>
          </form>

          <form id="hotelRegister" class="card auth-card${registerHiddenClass}">
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

            <label class="field">
              <span class="field-label">Location / area</span>
              <input class="input" name="hotelLocation" placeholder="${escapeHtml(DEFAULT_HOTEL_LOCATION)}" value="${escapeHtml(DEFAULT_HOTEL_LOCATION)}" />
            </label>

            <input name="hotelLatitude" type="hidden" value="" />
            <input name="hotelLongitude" type="hidden" value="" />
            <input name="hotelAccuracy" type="hidden" value="" />

            <div class="button-row">
              <button class="button button-primary button-small captureHotelLocationBtn" type="button">
                Use Current Location (Optional)
              </button>
            </div>

            <p class="tiny" data-hotel-geo-status>
              Enter your hotel area above. Location capture is optional, but it enables distance-based service fees and map previews.
            </p>

            <button class="button button-secondary button-small" type="submit">Register</button>
            <p class="tiny auth-switch">
              Already have an account?
              <button class="auth-switch-btn hotelAuthSwitchBtn" data-hotel-auth-view="login" type="button">Login</button>
            </p>
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
  const hotelCoordinates = normalizeCoordinates(hotel.coordinates);
  const restaurant = getRestaurantByHotelId(state.currentHotelId) || { id: state.currentHotelId, menu: [] };
  const sortedMenu = sortMenuItems(restaurant.menu || []);
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
            <div class="summary-item"><span>Location</span><strong>${escapeHtml(getHotelLocation(hotel))}</strong></div>
            <div class="summary-item"><span>Delivery map point</span><strong>${hotelCoordinates ? "Saved" : "Missing"}</strong></div>
            <div class="summary-item"><span>Coordinates</span><strong>${escapeHtml(formatCoordinatePair(hotelCoordinates))}</strong></div>
            <div class="summary-item"><span>Approved</span><strong>${hotel.approved ? "Yes" : "No"}</strong></div>
            <div class="summary-item"><span>Subscription ends</span><strong>${formatDateOnly(hotel.subscriptionExpiry)}</strong></div>
          </div>

          <div class="button-row">
            <button class="button button-primary button-small" id="saveHotelCurrentLocation" type="button">
              ${hotelCoordinates ? "Refresh Delivery Location" : "Save Delivery Location"}
            </button>
          </div>

          <p class="tiny">
            ${
              hotelCoordinates
                ? "Your hotel location is saved. Customer delivery fees can now be calculated from distance."
                : "Save the current hotel location on this device to enable automatic distance-based delivery fees."
            }
          </p>
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

            <label class="field">
              <span class="field-label">Availability</span>
              <select class="input" name="itemAvailability">
                <option value="daily">Daily menu</option>
                <option value="scheduled">Specific day</option>
              </select>
            </label>

            <div class="field-grid is-hidden" data-menu-schedule-fields>
              <label class="field">
                <span class="field-label">Day</span>
                <select class="input" name="itemDay" disabled>
                  <option value="">Choose day</option>
                  ${MENU_DAY_OPTIONS.map((day) => `<option value="${escapeHtml(day)}">${escapeHtml(day)}</option>`).join("")}
                </select>
              </label>

              <label class="field">
                <span class="field-label">Meal time</span>
                <select class="input" name="itemMealPeriod" disabled>
                  <option value="">Any meal</option>
                  ${MENU_MEAL_PERIOD_OPTIONS.map((period) => `<option value="${escapeHtml(period)}">${escapeHtml(period)}</option>`).join("")}
                </select>
              </label>
            </div>

            <p class="tiny">Leave the item on Daily menu if it is available every day. Choose a day only for scheduled items.</p>

            <button class="button button-primary" type="submit">Add Menu Item</button>
          </form>

          ${
            sortedMenu.length
              ? `<div class="menu-admin-list">
                  ${sortedMenu
                    .map(
                      (item) => `
                        <div class="menu-item">
                          <div class="menu-item-copy">
                            <p class="menu-item-name">${escapeHtml(item.name)}</p>
                            <div class="inline-list menu-item-meta">
                              <span class="summary-chip">${escapeHtml(getMenuScheduleDetails(item).label)}</span>
                            </div>
                            <p class="item-price">${formatCurrency(item.price)}</p>
                          </div>
                          <button
                            class="button button-danger-soft button-small removeMenu"
                            data-index="${escapeHtml(String(restaurant.menu.indexOf(item)))}"
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
            ? `<div class="order-list">${hotelOrders.map((order) => renderHotelOrderCard(order, hotel.name)).join("")}</div>`
            : `<div class="notification-item"><p class="is-muted">No orders have been placed for this hotel yet.</p></div>`
        }
      </section>
    </section>
  `;
}

function renderHotelOrderCard(order, hotelName) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText = items.length
    ? items.map((item) => `${item.qty || 1} x ${item.name}`).join(", ")
    : "your order";
  const customerWaLink = buildWhatsAppLink(
    order.customerPhone,
    `Hello ${order.customerName || "customer"}, this is ${hotelName || "the hotel"}. We have received your order: ${itemsText}.`,
  );

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
        ${
          (order.items || []).length
            ? (order.items || [])
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
        <div class="summary-item"><span>Service fee</span><strong>${formatCurrency(order.serviceFee || 0)}</strong></div>
        <div class="summary-item"><span>Distance</span><strong>${Number.isFinite(order.distanceKm) ? formatDistanceKm(order.distanceKm) : "Unknown"}</strong></div>
        <div class="summary-item"><span>Area</span><strong>${escapeHtml(order.customerArea || "Not shared")}</strong></div>
        <div class="summary-item"><span>Specific area</span><strong>${escapeHtml(order.customerSpecificArea || "Not shared")}</strong></div>
      </div>

      <div class="button-row">
        ${
          order.status !== "Paid"
            ? `<button class="button button-success markPaid" data-id="${escapeHtml(order.id)}" type="button">Mark Paid</button>`
            : ""
        }
        ${
          customerWaLink
            ? `<a class="button button-outline button-small" href="${escapeHtml(customerWaLink)}" target="_blank" rel="noreferrer">WhatsApp Customer</a>`
            : ""
        }
        <button class="button button-danger deleteOrder" data-id="${escapeHtml(order.id)}" type="button">Delete Order</button>
      </div>
    </article>
  `;
}
