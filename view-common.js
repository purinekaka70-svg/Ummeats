import { escapeHtml, formatTime, inferStatusTone } from "./helpers.js";

export function renderNotifications(items) {
  const sorted = [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (!sorted.length) {
    return `
      <div class="notification-item">
        <p class="is-muted">No notifications yet.</p>
        <p class="tiny is-muted">Allowing browser notifications only enables alerts. New order and admin updates will appear here after they are created.</p>
      </div>
    `;
  }

  return `
    <div class="notification-list">
      ${sorted
        .map(
          (item) => {
            const canMarkRead = !item.read && !item.fallback && item.id;
            const canDelete = !item.fallback && item.id;
            const statusMarkup = item.read
              ? `<span class="tiny">Read</span>`
              : canMarkRead
                ? `<button class="button button-outline button-small markNotifRead" data-id="${escapeHtml(item.id)}" type="button">Mark Read</button>`
                : `<span class="tiny">New</span>`;
            const deleteMarkup = canDelete
              ? `<button class="button button-danger-soft button-small deleteNotification" data-id="${escapeHtml(item.id)}" type="button">Delete</button>`
              : "";

            return `
              <article class="notification-item">
                <p>${escapeHtml(item.message || "Notification")}</p>
                <p class="tiny">${formatTime(item.timestamp)}</p>
                <div class="button-row">
                  ${statusMarkup}
                  ${deleteMarkup}
                </div>
              </article>
            `;
          },
        )
        .join("")}
    </div>
  `;
}

export function renderGateCard(title, copy, buttonId, buttonLabel) {
  return `
    <section class="view-shell">
      <div class="card">
        <div class="stack">
          <div>
            <p class="eyebrow">Access update</p>
            <h2 class="view-title">${escapeHtml(title)}</h2>
            <p class="view-copy">${escapeHtml(copy)}</p>
          </div>
          <div class="button-row">
            <button class="button button-secondary" id="${escapeHtml(buttonId)}" type="button">${escapeHtml(buttonLabel)}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function renderStatusPill(label, tone = inferStatusTone(label)) {
  return `<span class="status-pill status-pill--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

export function renderInlineBadge(count, tone) {
  if (!count) {
    return "";
  }

  return `<span class="count-badge count-badge--${tone}">${escapeHtml(String(count))}</span>`;
}

export function renderBrowseMenuTabs(currentTab) {
  const tabs = [
    { id: "restaurants", label: "Restaurants" },
    { id: "orders", label: "Orders" },
    { id: "hotel", label: "Hotel Portal" },
  ];

  return `
    <div class="browse-menu-row">
      ${tabs
        .map(
          (tab) => `
            <button
              class="button ${currentTab === tab.id ? "button-primary" : "button-outline"} button-small browseNavBtn"
              data-tab="${escapeHtml(tab.id)}"
              type="button"
            >
              ${escapeHtml(tab.label)}
            </button>
          `,
        )
        .join("")}
      <button class="button button-outline button-small browseDirectoryBtn" type="button">Hide Hotels</button>
    </div>
  `;
}

export function renderEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(copy)}</p>
      </div>
    </div>
  `;
}
