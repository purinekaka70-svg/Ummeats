import {
  ANNOUNCEMENT_TEXT,
  DEFAULT_HOTEL_LOCATION,
  MARKETPLACE_SHOP_HERE_URL,
  SERVICE_FEE,
  SHOP_HERE_URL,
} from "./config.js";
import {
  elements,
  getCart,
  getCartItemCount,
  getCartItemsTotal,
  getHotelById,
  getHotelLocation,
  getLocationCards,
  getRestaurantByHotelId,
  getVisibleRestaurants,
  state,
} from "./state.js";
import { escapeHtml, formatCurrency, getMenuScheduleDetails, pluralize, sortMenuItems } from "./helpers.js";
import { renderBrowseMenuTabs, renderEmptyState } from "./view-common.js";

export function renderRestaurants() {
  const selectedLocation = state.selectedLocation;
  const locationCards = getLocationCards();
  const allVisibleRestaurants = getVisibleRestaurants(null);
  const visibleRestaurants = getVisibleRestaurants();
  const activeHotelId = state.activeHotelMenuId;
  const hasActiveMenu = activeHotelId && visibleRestaurants.some((restaurant) => restaurant.hotelId === activeHotelId);
  const directoryOpen = state.restaurantDirectoryOpen || hasActiveMenu;
  const showLocationDirectory = directoryOpen && state.locationDirectoryOpen && !selectedLocation && !hasActiveMenu;
  const visibleCards = hasActiveMenu
    ? visibleRestaurants.filter((restaurant) => restaurant.hotelId === activeHotelId)
    : visibleRestaurants;
  const selectedLocationCard = selectedLocation
    ? locationCards.find((card) => card.name === selectedLocation) || null
    : null;

  elements.app.innerHTML = `
    <section class="view-shell">
      <div class="launch-grid ${directoryOpen ? "launch-grid--single" : ""}">
        ${renderHotelLaunchCard(directoryOpen, selectedLocation, allVisibleRestaurants.length)}
        ${
          directoryOpen
            ? ""
            : `
                <article class="card launch-card">
                  <p class="launch-eyebrow">Delivery Marketplace</p>
                  <h2 class="launch-title">Go Live Supermarkets</h2>
                  <p class="launch-copy">Shop supermarkets, essentials, and delivery-ready items around Kajiado.</p>
                  <div class="launch-actions">
                    <a class="button button-ghost" href="${MARKETPLACE_SHOP_HERE_URL}" target="_blank" rel="noreferrer">
                      Shop Here
                    </a>
                  </div>
                </article>
              `
        }
      </div>

      ${showLocationDirectory ? renderLocationDirectory(locationCards) : directoryOpen ? renderBrowseResultsHeader(selectedLocationCard, visibleRestaurants.length) : ""}

      ${
        directoryOpen && !showLocationDirectory
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
                      "No hotels in this location yet",
                      selectedLocation
                        ? "Registered hotels in this area will appear here automatically once they are approved and menus are added."
                        : "Hotels will appear here once they are approved and a menu has been added.",
                    )
              }
            `
          : ""
      }

      ${directoryOpen && hasActiveMenu ? renderMenuForHotel(activeHotelId) : ""}
    </section>
  `;
}

function renderHotelLaunchCard(directoryOpen, selectedLocation, totalHotels) {
  const copy = selectedLocation
    ? `Showing registered hotels and menus around ${selectedLocation}.`
    : "Browse hotel menus, place food orders, and access fast delivery support across Kenya with Tamu Express.";

  return `
    <article class="card launch-card">
      <p class="launch-eyebrow">Tamu Express Delivery</p>
      <h1 class="launch-title">Food Delivery and Hotel Orders in Kenya</h1>
      <p class="launch-copy">${escapeHtml(copy)}</p>
      ${
        directoryOpen
          ? `
              <div class="stack">
                ${renderBrowseMenuTabs("restaurants")}
                ${
                  selectedLocation
                    ? `
                        <div class="inline-list">
                          <span class="summary-chip">${escapeHtml(selectedLocation)}</span>
                          <button class="button button-outline button-small browseAllHotelsBtn" type="button">All Locations</button>
                        </div>
                      `
                    : `<div class="summary-chip">${totalHotels} hotel${pluralize(totalHotels)} ready to browse</div>`
                }
              </div>
            `
          : `
              <div class="launch-actions">
                <button class="button button-primary browseDirectoryBtn" type="button">Browse All Hotels</button>
              </div>
            `
      }
    </article>
  `;
}

function renderLocationDirectory(locationCards) {
  if (!locationCards.length) {
    return renderEmptyState(
      "No hotel locations yet",
      "When hotels register and add a location, cards like Around Umma University or Nairobi CBD will appear here automatically.",
    );
  }

  return `
    <section class="location-directory">
      <div class="section-head">
        <h4>Browse by Location</h4>
        <span class="summary-chip">${locationCards.length} area${pluralize(locationCards.length)}</span>
      </div>

      <div class="location-grid">
        ${locationCards.map(renderLocationCard).join("")}
      </div>
    </section>
  `;
}

function matchesUmmaLocationCard(name) {
  const normalizedName = String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedDefault = DEFAULT_HOTEL_LOCATION.toLowerCase();
  return normalizedName === normalizedDefault || normalizedName.includes("umma universit");
}

function renderLocationCard(card) {
  const isUmmaCard = matchesUmmaLocationCard(card.name);
  const hotelPreview = card.hotels.slice(0, 3);
  const previewCopy = hotelPreview.length
    ? `Hotels here include ${hotelPreview.map((name) => escapeHtml(name)).join(", ")}${card.hotelCount > 3 ? ", and more." : "."}`
    : `Hotels in ${escapeHtml(card.name)} will appear here automatically.`;

  return `
    <article class="card location-card">
      <div class="stack">
        <div>
          <p class="eyebrow">Location card</p>
          <h3 class="card-title">${escapeHtml(card.name)}</h3>
          <p class="launch-copy">${previewCopy}</p>
        </div>

        <div class="inline-list">
          <span class="summary-chip">${card.hotelCount} hotel${pluralize(card.hotelCount)}</span>
          <span class="summary-chip">${card.menuCount} menu item${pluralize(card.menuCount)}</span>
        </div>

        <div class="button-row">
          <button class="button button-primary browseLocationBtn" data-location="${escapeHtml(card.name)}" type="button">
            View Hotels
          </button>
          ${
            isUmmaCard
              ? `
                  <a class="button button-outline" href="${SHOP_HERE_URL}" target="_self" rel="noopener">
                    Shop Here
                  </a>
                `
              : ""
          }
        </div>

      </div>
    </article>
  `;
}

function renderBrowseResultsHeader(selectedLocationCard, visibleCount) {
  const title = selectedLocationCard ? selectedLocationCard.name : "All registered hotel locations";
  const copy = selectedLocationCard
    ? `Showing every approved hotel and menu registered around ${selectedLocationCard.name}.`
    : "Showing every approved hotel and menu currently available on Tamu Express.";

  return `
    <article class="card location-focus-card">
      <div class="split-row">
        <div class="stack">
          <div>
            <p class="eyebrow">Location filter</p>
            <h2 class="launch-title">${escapeHtml(title)}</h2>
            <p class="launch-copy">${escapeHtml(copy)}</p>
          </div>
          <div class="inline-list">
            <span class="summary-chip">${visibleCount} hotel${pluralize(visibleCount)}</span>
            ${
              selectedLocationCard
                ? `<span class="summary-chip">${selectedLocationCard.menuCount} menu item${pluralize(selectedLocationCard.menuCount)}</span>`
                : ""
            }
          </div>
        </div>

        ${
          selectedLocationCard
            ? `<button class="button button-outline button-small browseAllHotelsBtn" type="button">Show All Locations</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderRestaurantCard(restaurant) {
  const hotel = getHotelById(restaurant.hotelId);
  const isOpen = state.activeHotelMenuId === restaurant.hotelId;
  const cartCount = getCartItemCount(getCart(restaurant.hotelId));

  return `
    <article class="card restaurant-card ${isOpen ? "restaurant-card--open" : ""}">
      <div class="restaurant-card-toggle">
        <div class="restaurant-card-meta-row">
          <span class="restaurant-card-meta-chip">${escapeHtml(getHotelLocation(hotel))}</span>
          <span class="restaurant-card-meta-chip">Till ${escapeHtml(hotel.till || "N/A")}</span>
          <span class="restaurant-card-meta-chip">${escapeHtml(hotel.phone || "N/A")}</span>
        </div>
        <div class="restaurant-card-compact">
          <h3>${escapeHtml(hotel.name)}</h3>
        </div>
        <div class="restaurant-card-actions">
          <button
            class="button button-cart-icon button-small openHotelCartBtn"
            data-hotel="${escapeHtml(restaurant.hotelId)}"
            type="button"
            aria-label="${
              cartCount
                ? `Open ${escapeHtml(hotel.name)} cart with ${escapeHtml(String(cartCount))} item${cartCount === 1 ? "" : "s"}`
                : `Open ${escapeHtml(hotel.name)} menu to add items`
            }"
            title="${cartCount ? "Open Cart" : "Open Menu"}"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm9 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-9.75-3h10.86a2 2 0 0 0 1.95-1.58l1.23-5.54A1 1 0 0 0 20.31 6H6.21l-.32-1.52A2 2 0 0 0 3.93 3H2a1 1 0 1 0 0 2h1.93l2.03 9.44A2 2 0 0 0 7.92 16H19a1 1 0 1 0 0-2H7.92l-.17-.8Z"></path>
            </svg>
            ${
              cartCount
                ? `<span class="count-badge count-badge--alert restaurant-card-cart-count">${escapeHtml(String(cartCount))}</span>`
                : ""
            }
          </button>
          <button
            class="button button-primary button-small viewMenuBtn"
            data-hotel="${escapeHtml(restaurant.hotelId)}"
            type="button"
            aria-expanded="${isOpen}"
          >
            ${isOpen ? "Hide Menu" : "View Menu"}
          </button>
        </div>
        <p class="restaurant-card-instruction">
          Click the supermarket icon to continue with cart and payment details.
        </p>
      </div>
    </article>
  `;
}

function renderMenuForHotel(hotelId) {
  const hotel = getHotelById(hotelId);
  const restaurant = getRestaurantByHotelId(hotelId) || { menu: [] };
  const sortedMenu = sortMenuItems(restaurant.menu || []);
  const cart = getCart(hotelId);
  const itemsTotal = getCartItemsTotal(cart);
  const total = itemsTotal + SERVICE_FEE;

  return `
    <section class="menu-detail-shell" data-hotel-menu-id="${escapeHtml(hotelId)}">
      <div class="menu-detail-head">
        <div>
          <p class="eyebrow">Open menu</p>
          <h3 class="card-title">${escapeHtml(hotel.name)}</h3>
        </div>
        <div class="inline-list">
          <div class="summary-chip">${escapeHtml(getHotelLocation(hotel))}</div>
          <div class="summary-chip">${escapeHtml(hotel.phone || "N/A")}</div>
        </div>
      </div>

      ${
        cart.length
          ? `
              <article class="menu-cart-summary">
                <div class="menu-cart-summary-copy">
                  <p class="eyebrow">Cart ready</p>
                  <h4>${getCartItemCount(cart)} item${pluralize(getCartItemCount(cart))} in cart</h4>
                  <p class="launch-copy">
                    Items total ${formatCurrency(itemsTotal)}. Total to pay ${formatCurrency(total)}.
                    Pay the delivery fee to till ${escapeHtml(SERVICE_FEE_TILL)} and open cart to continue with payment details.
                  </p>
                </div>

                <div class="button-row">
                  <button class="button button-primary placeOrder" data-hotel="${escapeHtml(hotelId)}" type="button">
                    Open Cart
                  </button>
                  <button class="button button-outline resetCart" data-hotel="${escapeHtml(hotelId)}" type="button">
                    Reset Cart
                  </button>
                </div>
              </article>
            `
          : ""
      }

      <div class="menu-stack">
        <section class="menu-panel">
          <div class="section-head">
            <h4>Menu Items</h4>
            <span class="summary-chip">${sortedMenu.length} item${pluralize(sortedMenu.length)}</span>
          </div>

          ${
            sortedMenu.length
              ? `<div class="menu-list">
                  ${sortedMenu
                    .map((item) => {
                      const schedule = getMenuScheduleDetails(item);
                      return `
                        <div class="menu-item" data-menu-item>
                          <div class="menu-item-copy">
                            <p class="menu-item-name">${escapeHtml(item.name)}</p>
                            ${
                              schedule.isScheduled
                                ? `
                                    <div class="inline-list menu-item-meta">
                                      <span class="summary-chip">${escapeHtml(schedule.label)}</span>
                                    </div>
                                  `
                                : ""
                            }
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
                      `;
                    })
                    .join("")}
                </div>`
              : `<div class="notification-item"><p class="is-muted">This hotel has not published menu items yet.</p></div>`
          }
        </section>
      </div>
    </section>
  `;
}
