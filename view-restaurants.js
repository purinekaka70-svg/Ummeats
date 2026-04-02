import { ANNOUNCEMENT_TEXT, SERVICE_FEE, SERVICE_FEE_TILL, SHOP_HERE_URL } from "./config.js";
import {
  elements,
  getCart,
  getCartItemCount,
  getCartItemsTotal,
  getCheckoutDraft,
  getHotelById,
  getRestaurantByHotelId,
  getVisibleRestaurants,
  state,
} from "./state.js";
import { escapeHtml, formatCurrency, pluralize } from "./helpers.js";
import { renderBrowseMenuTabs, renderEmptyState } from "./view-common.js";

export function renderRestaurants() {
  const visibleRestaurants = getVisibleRestaurants();
  const activeHotelId = state.activeHotelMenuId;
  const hasActiveMenu = activeHotelId && visibleRestaurants.some((restaurant) => restaurant.hotelId === activeHotelId);
  const directoryOpen = state.restaurantDirectoryOpen || hasActiveMenu;
  const visibleCards = hasActiveMenu
    ? visibleRestaurants.filter((restaurant) => restaurant.hotelId === activeHotelId)
    : visibleRestaurants;

  elements.app.innerHTML = `
    <section class="view-shell">
      <div class="launch-grid ${directoryOpen ? "launch-grid--single" : ""}">
        ${renderHotelLaunchCard(directoryOpen)}
        ${
          directoryOpen
            ? ""
            : `
                <article class="card launch-card">
                  <p class="launch-eyebrow">Shop Here</p>
                  <h2 class="launch-title">Go Live Supermarkets</h2>
                  <p class="launch-copy">Supermarkets and more around Kajiado.</p>
                  <div class="launch-actions">
                    <a class="button button-ghost" href="${SHOP_HERE_URL}" target="_blank" rel="noreferrer">
                      Shop Here
                    </a>
                  </div>
                </article>
              `
        }
      </div>

      ${
        directoryOpen
          ? `
              <section class="notice-strip panel browse-notice" aria-label="Order times notice">
                <span class="notice-label">Order times</span>
                <div class="notice-marquee" aria-live="polite">
                  <div class="notice-track">
                    <span class="notice-copy">${escapeHtml(ANNOUNCEMENT_TEXT)}</span>
                    <span class="notice-copy" aria-hidden="true">${escapeHtml(ANNOUNCEMENT_TEXT)}</span>
                  </div>
                </div>
              </section>

              ${
                visibleCards.length
                  ? `
                      <div class="browse-results-meta">
                        <div class="summary-chip">${hasActiveMenu ? `1 of ${visibleRestaurants.length}` : `${visibleRestaurants.length}`} hotel${pluralize(visibleRestaurants.length)}</div>
                      </div>
                      <div class="restaurant-grid">${visibleCards.map(renderRestaurantCard).join("")}</div>
                    `
                  : renderEmptyState(
                      "No approved restaurants yet",
                      "Hotels will appear here once they are approved and a menu has been added.",
                    )
              }
            `
          : ""
      }

      ${directoryOpen && hasActiveMenu ? renderMenuForHotel(activeHotelId) : ""}
    </section>
  `;
}

function renderHotelLaunchCard(directoryOpen) {
  return `
    <article class="card launch-card">
      <p class="launch-eyebrow">Tamu Express</p>
      <h2 class="launch-title">Around Umma University</h2>
      <p class="launch-copy">Browse hotels and menus around campus.</p>
      ${
        directoryOpen
          ? renderBrowseMenuTabs("restaurants")
          : `
              <div class="launch-actions">
                <button class="button button-primary browseDirectoryBtn" type="button">Browse Hotels</button>
              </div>
            `
      }
    </article>
  `;
}

function renderRestaurantCard(restaurant) {
  const hotel = getHotelById(restaurant.hotelId);
  const isOpen = state.activeHotelMenuId === restaurant.hotelId;

  return `
    <article class="card restaurant-card ${isOpen ? "restaurant-card--open" : ""}">
      <div class="restaurant-card-toggle">
        <div class="restaurant-card-meta-row">
          <span class="restaurant-card-meta-chip">Till ${escapeHtml(hotel.till || "N/A")}</span>
          <span class="restaurant-card-meta-chip">${escapeHtml(hotel.phone || "N/A")}</span>
        </div>
        <div class="restaurant-card-compact">
          <h3>${escapeHtml(hotel.name)}</h3>
        </div>
        <div class="restaurant-card-actions">
          <button
            class="button button-primary button-small viewMenuBtn"
            data-hotel="${escapeHtml(restaurant.hotelId)}"
            type="button"
            aria-expanded="${isOpen}"
          >
            ${isOpen ? "Hide Menu" : "View Menu"}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderMenuForHotel(hotelId) {
  const hotel = getHotelById(hotelId);
  const restaurant = getRestaurantByHotelId(hotelId) || { menu: [] };
  const cart = getCart(hotelId);
  const draft = getCheckoutDraft(hotelId);
  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + SERVICE_FEE;
  const cartDisabled = cart.length ? "" : "disabled";

  return `
    <section class="menu-detail-shell">
      <div class="menu-detail-head">
        <div>
          <p class="eyebrow">Open menu</p>
          <h3 class="card-title">${escapeHtml(hotel.name)}</h3>
        </div>
        <div class="summary-chip">${escapeHtml(hotel.phone || "N/A")}</div>
      </div>

      <div class="menu-stack">
        <section class="menu-panel">
          <div class="section-head">
            <h4>Menu Items</h4>
            <span class="summary-chip">${restaurant.menu?.length || 0} item${pluralize(restaurant.menu?.length || 0)}</span>
          </div>

          ${
            restaurant.menu?.length
              ? `<div class="menu-list">
                  ${restaurant.menu
                    .map(
                      (item) => `
                        <div class="menu-item" data-menu-item>
                          <div>
                            <p class="menu-item-name">${escapeHtml(item.name)}</p>
                            <p class="item-price">${formatCurrency(item.price)}</p>
                          </div>
                          <div class="item-actions">
                            <input class="qty-input" min="1" step="1" type="number" value="1" />
                            <button
                              class="button button-secondary button-small addToCart"
                              data-hotel="${escapeHtml(hotelId)}"
                              data-name="${escapeHtml(item.name)}"
                              data-price="${escapeHtml(String(item.price))}"
                              type="button"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      `,
                    )
                    .join("")}
                </div>`
              : `<div class="notification-item"><p class="is-muted">This hotel has not published menu items yet.</p></div>`
          }
        </section>

        ${
          cart.length
            ? `<aside class="cart-panel">
                <div class="stack">
                  <div class="section-head">
                    <h4>Cart</h4>
                    <span class="summary-chip">${getCartItemCount(cart)} item${pluralize(getCartItemCount(cart))}</span>
                  </div>

                  <div class="menu-list">
                    ${cart
                      .map(
                        (item, index) => `
                          <div class="cart-item">
                            <div>
                              <p class="menu-item-name">${escapeHtml(`${item.qty} x ${item.name}`)}</p>
                              <p class="item-price">${formatCurrency(item.price * item.qty)}</p>
                            </div>
                            <button
                              class="button button-danger-soft button-small removeItem"
                              data-hotel="${escapeHtml(hotelId)}"
                              data-index="${escapeHtml(String(index))}"
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>

                  <div class="summary-list">
                    <div class="summary-item"><span>Items total</span><strong>${formatCurrency(itemsTotal)}</strong></div>
                    <div class="summary-item"><span>Service fee</span><strong>${formatCurrency(SERVICE_FEE)}</strong></div>
                    <div class="summary-item"><span>Total to pay</span><strong>${formatCurrency(total)}</strong></div>
                  </div>

                  <div class="cart-alert">
                    <strong>Before placing order</strong>
                    <p>Please call before placing order for food confirmation.</p>
                  </div>

                  <div class="info-box">
                    <p><strong>${escapeHtml(hotel.name)}</strong> food till: ${escapeHtml(hotel.till || "N/A")}</p>
                    <p class="tiny">Service fee till: ${escapeHtml(SERVICE_FEE_TILL)}</p>
                  </div>

                  <div class="field-grid">
                    <label class="field">
                      <span class="field-label">M-PESA name</span>
                      <input
                        class="input checkout-input"
                        data-field="mpesaName"
                        data-hotel="${escapeHtml(hotelId)}"
                        placeholder="Name used for payment"
                        value="${escapeHtml(draft.mpesaName)}"
                      />
                    </label>

                    <label class="field">
                      <span class="field-label">M-PESA number</span>
                      <input
                        class="input checkout-input"
                        data-field="mpesaNumber"
                        data-hotel="${escapeHtml(hotelId)}"
                        placeholder="07XXXXXXXX"
                        value="${escapeHtml(draft.mpesaNumber)}"
                      />
                    </label>

                    <label class="field">
                      <span class="field-label">Your name</span>
                      <input
                        class="input checkout-input"
                        data-field="custName"
                        data-hotel="${escapeHtml(hotelId)}"
                        placeholder="Customer name"
                        value="${escapeHtml(draft.custName)}"
                      />
                    </label>

                    <label class="field">
                      <span class="field-label">Your phone</span>
                      <input
                        class="input checkout-input"
                        data-field="custPhone"
                        data-hotel="${escapeHtml(hotelId)}"
                        placeholder="07XXXXXXXX"
                        value="${escapeHtml(draft.custPhone)}"
                      />
                    </label>
                  </div>

                  <div class="button-row">
                    <button class="button button-primary placeOrder" data-hotel="${escapeHtml(hotelId)}" type="button" ${cartDisabled}>
                      Place Order
                    </button>
                    <button class="button button-outline resetCart" data-hotel="${escapeHtml(hotelId)}" type="button" ${cartDisabled}>
                      Reset Cart
                    </button>
                  </div>
                </div>
              </aside>`
            : ""
        }
      </div>
    </section>
  `;
}
