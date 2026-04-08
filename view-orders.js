import {
  CUSTOMER_ID,
  elements,
  getCartItemsTotal,
  getHotelById,
  getHotelLocation,
  getNotificationsForTarget,
  getVisibleOrders,
  state,
} from "./state.js";
import { escapeHtml, formatCoordinatePair, formatCurrency, formatDistanceKm, formatTime, pluralize } from "./helpers.js";
import { SERVICE_FEE, SERVICE_FEE_TILL } from "./config.js";
import {
  renderBrowseMenuTabs,
  renderEmptyState,
  renderInlineBadge,
  renderNotifications,
  renderStatusPill,
} from "./view-common.js";

export function renderOrders() {
  const visibleOrders = getVisibleOrders().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const customerNotifications = !state.currentAdmin && !state.currentHotelId
    ? getNotificationsForTarget(CUSTOMER_ID)
    : [];
  const scopeLabel = state.currentAdmin
    ? "Admin order view"
    : state.currentHotelId
      ? `${getHotelById(state.currentHotelId).name} order queue`
      : "Customer order history";

  const scopeCopy = state.currentAdmin
    ? "All orders."
    : state.currentHotelId
      ? "Orders for this hotel."
      : "Your orders.";

  elements.app.innerHTML = `
    <section class="view-shell">
      ${
        state.restaurantDirectoryOpen
          ? `
              <article class="card launch-card launch-card--hub">
                <p class="launch-eyebrow">Tamu Express</p>
                <h2 class="launch-title">Around Umma University</h2>
                <p class="launch-copy">Browse hotels, orders, and hotel tools.</p>
                ${renderBrowseMenuTabs("orders")}
              </article>
            `
          : ""
      }

      <div class="view-header">
        <div>
          <p class="eyebrow">${escapeHtml(scopeLabel)}</p>
          <h2 class="view-title">Orders</h2>
          <p class="view-copy">${escapeHtml(scopeCopy)}</p>
        </div>
        <div class="toolbar">
          ${
            customerNotifications.length
              ? `
                  <button class="button button-outline" data-toggle-panel="customerNotifBox" type="button">
                    Notifications
                    ${renderInlineBadge(customerNotifications.filter((item) => !item.read).length, "alert")}
                  </button>
                `
              : ""
          }
          <div class="summary-chip">${visibleOrders.length} order${pluralize(visibleOrders.length)}</div>
        </div>
      </div>

      ${
        customerNotifications.length
          ? `
              <div id="customerNotifBox" class="disclosure-card is-hidden">
                ${renderNotifications(customerNotifications)}
              </div>
            `
          : ""
      }

      ${
        visibleOrders.length
          ? `<div class="order-list">${visibleOrders.map(renderOrderCard).join("")}</div>`
          : renderEmptyState(
              "No orders yet",
              "Once an order is placed it will appear here immediately.",
            )
      }
    </section>
  `;
}

function renderOrderCard(order) {
  const hotel = getHotelById(order.hotelId);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsTotal = items.length ? getCartItemsTotal(items) : Number(order.itemsTotal || 0);
  const total = Number(order.total || itemsTotal + Number(order.serviceFee ?? SERVICE_FEE));
  const canDelete =
    state.currentAdmin ||
    (state.currentHotelId && state.currentHotelId === order.hotelId) ||
    order.customerId === CUSTOMER_ID;
  const canMarkPaid = state.currentAdmin || (state.currentHotelId && state.currentHotelId === order.hotelId);

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
        <div class="summary-item"><span>Customer area</span><strong>${escapeHtml(order.customerArea || "Not shared")}</strong></div>
        <div class="summary-item"><span>Customer map point</span><strong>${escapeHtml(formatCoordinatePair(order.customerCoordinates))}</strong></div>
        <div class="summary-item"><span>Total</span><strong>${formatCurrency(total)}</strong></div>
        <div class="summary-item"><span>M-PESA name</span><strong>${escapeHtml(order.mpesaName || "N/A")}</strong></div>
        <div class="summary-item"><span>M-PESA number</span><strong>${escapeHtml(order.mpesaNumber || "N/A")}</strong></div>
      </div>

      <div class="button-row">
        ${
          canMarkPaid && order.status !== "Paid"
            ? `<button class="button button-success markPaid" data-id="${escapeHtml(order.id)}" type="button">Mark as Paid</button>`
            : ""
        }
        ${
          canDelete
            ? `<button class="button button-danger deleteOrder" data-id="${escapeHtml(order.id)}" type="button">Delete Order</button>`
            : ""
        }
      </div>
    </article>
  `;
}
