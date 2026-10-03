/**
 * Fly2Git by SRT — Liquid Glass Sync Notifications (Phase 16.3)
 *
 * Micro-interaction notification system inspired by Apple Liquid Glass.
 * Visual Identity: Midnight Titanium + Liquid Glass + Ice Blue Accent.
 *
 * Features:
 * - Types: success, update, duplicate, skipped, error
 * - Translucent dark glass, depth blur, 1px border, single-run titanium light sweep
 * - Queueing (max 1 visible, max 3 queued, collapses overflow into "N more solutions synced")
 * - Event deduplication by syncId
 * - Keyboard accessible, aria-live, prefers-reduced-motion support
 * - Adapts to desktop content page (floating top-right) and popup (integrated banner)
 * - Safe: never throws into sync pipeline or callers; zero credentials/tokens/source code in payloads
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitNotification = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOTIFICATION_TYPES = Object.freeze({
    SUCCESS: "success",
    UPDATE: "update",
    DUPLICATE: "duplicate",
    SKIPPED: "skipped",
    ERROR: "error",
  });

  const DURATION_BY_TYPE = Object.freeze({
    success: 3000,
    update: 3000,
    duplicate: 2500,
    skipped: 2500,
    error: 5000,
  });

  const MAX_QUEUE_SIZE = 3;
  const MAX_DEDUP_SIZE = 100;

  // Embedded CSS for Liquid Glass visual identity
  const LIQUID_GLASS_CSS = `
    .fly2git-glass-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .fly2git-glass-container.fly2git-in-popup {
      position: relative;
      top: 0;
      right: 0;
      width: 100%;
      margin: 8px 0;
      align-items: stretch;
      pointer-events: auto;
    }

    .fly2git-liquid-glass {
      pointer-events: auto;
      position: relative;
      width: 330px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      border-radius: 14px;
      background: rgba(18, 22, 28, 0.84);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      backdrop-filter: blur(16px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.42), 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.16);
      color: #f1f5f9;
      overflow: hidden;
      cursor: pointer;
      user-select: none;
      outline: none;
      padding: 12px 14px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
      transform-origin: top right;
      animation: fly2gitGlassEntry 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
    }

    .fly2git-glass-container.fly2git-in-popup .fly2git-liquid-glass {
      width: 100%;
      max-width: 100%;
      transform-origin: top center;
    }

    .fly2git-liquid-glass:hover {
      background: rgba(24, 30, 38, 0.92);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .fly2git-liquid-glass:active {
      transform: scale(0.98);
    }

    .fly2git-liquid-glass:focus-visible {
      outline: 2px solid #38bdf8;
      outline-offset: 2px;
    }

    .fly2git-liquid-glass.fly2git-exiting {
      animation: fly2gitGlassExit 260ms cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
      pointer-events: none;
    }

    /* Single-run light reflection sweep */
    .fly2git-liquid-glass .fly2git-glass-shimmer {
      position: absolute;
      top: 0;
      left: -120%;
      width: 70%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.08) 40%,
        rgba(186, 230, 253, 0.22) 50%,
        transparent 100%
      );
      transform: skewX(-22deg);
      pointer-events: none;
      animation: fly2gitShimmerSweep 550ms cubic-bezier(0.16, 1, 0.3, 1) 0.08s 1 forwards;
    }

    /* Status Icon Pill */
    .fly2git-notif-icon-wrap {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }

    .fly2git-notif-icon-wrap.type-success {
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.28);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
    }

    .fly2git-notif-icon-wrap.type-update {
      background: rgba(148, 163, 184, 0.14);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }

    .fly2git-notif-icon-wrap.type-duplicate {
      background: rgba(100, 116, 139, 0.14);
      color: #94a3b8;
      border: 1px solid rgba(100, 116, 139, 0.2);
    }

    .fly2git-notif-icon-wrap.type-skipped {
      background: rgba(245, 158, 11, 0.14);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.28);
    }

    .fly2git-notif-icon-wrap.type-error {
      background: rgba(239, 68, 68, 0.14);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.28);
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.18);
    }

    .fly2git-notif-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .fly2git-notif-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .fly2git-notif-title {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      letter-spacing: -0.01em;
      line-height: 1.25;
    }

    .fly2git-notif-close {
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 4px;
      transition: color 0.12s ease;
    }

    .fly2git-notif-close:hover {
      color: #cbd5e1;
    }

    .fly2git-notif-problem {
      font-size: 13px;
      font-weight: 500;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .fly2git-notif-meta {
      font-size: 11.5px;
      font-weight: 400;
      color: #94a3b8;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .fly2git-notif-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10.5px;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
      line-height: 1.2;
    }

    .fly2git-notif-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .fly2git-notif-action-btn {
      font-size: 11px;
      font-weight: 500;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.2);
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.12s ease;
    }

    .fly2git-notif-action-btn:hover {
      background: rgba(56, 189, 248, 0.2);
    }

    .fly2git-notif-retry-btn {
      font-size: 11px;
      font-weight: 500;
      color: #f87171;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.12s ease;
    }

    .fly2git-notif-retry-btn:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    .fly2git-collapsed-badge {
      font-size: 10.5px;
      font-weight: 600;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.2);
      padding: 1px 6px;
      border-radius: 10px;
    }

    @keyframes fly2gitGlassEntry {
      0% {
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes fly2gitGlassExit {
      0% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateY(-6px) scale(0.96);
      }
    }

    @keyframes fly2gitShimmerSweep {
      0% {
        left: -120%;
      }
      100% {
        left: 200%;
      }
    }

    /* Accessibility: Reduced Motion */
    @media (prefers-reduced-motion: reduce) {
      .fly2git-liquid-glass {
        animation: fly2gitFadeIn 200ms linear forwards !important;
        transition: opacity 200ms linear !important;
        transform: none !important;
      }
      .fly2git-liquid-glass.fly2git-exiting {
        animation: fly2gitFadeOut 200ms linear forwards !important;
        transform: none !important;
      }
      .fly2git-liquid-glass .fly2git-glass-shimmer {
        display: none !important;
      }
      .fly2git-liquid-glass:active {
        transform: none !important;
      }
    }

    @keyframes fly2gitFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes fly2gitFadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;

  // SVG Minimal Icons (No emoji)
  const ICONS = Object.freeze({
    // Check ✓
    success: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6"/></svg>`,
    // Update cycle ↻
    update: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 8a5.5 5.5 0 0 1-9.4 3.9"/><path d="M12 2v3.5h-3.5M4 14v-3.5h3.5"/></svg>`,
    // Duplicate circle ○
    duplicate: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="8" r="5.2"/></svg>`,
    // Skipped minus —
    skipped: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="8" x2="12" y2="8"/></svg>`,
    // Error warning !
    error: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11.2" r="0.75" fill="currentColor"/></svg>`,
    // Dismiss close ×
    close: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  });

  /**
   * Factory function to create an isolated notification service.
   * Useful for tests or multi-context environments.
   */
  function createNotificationService(customEnv = {}) {
    const doc = customEnv.document || (typeof document !== "undefined" ? document : null);
    const win = customEnv.window || (typeof window !== "undefined" ? window : null);
    const chromeApi = customEnv.chrome || (typeof chrome !== "undefined" ? chrome : null);

    const seenSyncIds = new Set();
    const queue = [];
    let activeNotification = null;
    let autoDismissTimer = null;
    let stylesInjected = false;

    function resetDeduplication() {
      seenSyncIds.clear();
    }

    function isDuplicateSyncId(syncId) {
      if (!syncId) return false;
      return seenSyncIds.has(syncId);
    }

    function recordSyncId(syncId) {
      if (!syncId) return;
      seenSyncIds.add(syncId);
      if (seenSyncIds.size > MAX_DEDUP_SIZE) {
        const oldest = seenSyncIds.values().next().value;
        seenSyncIds.delete(oldest);
      }
    }

    function injectStyles() {
      if (stylesInjected || !doc) return;
      try {
        if (doc.getElementById("fly2git-liquid-glass-styles")) {
          stylesInjected = true;
          return;
        }
        const style = doc.createElement("style");
        style.id = "fly2git-liquid-glass-styles";
        style.textContent = LIQUID_GLASS_CSS;
        (doc.head || doc.documentElement || doc.body).appendChild(style);
        stylesInjected = true;
      } catch (_) {}
    }

    function isPopupContext() {
      if (!doc) return false;
      return Boolean(
        doc.getElementById("popupNotificationContainer") ||
        doc.getElementById("accountBar") ||
        (win && win.__FLY2GIT_POPUP__)
      );
    }

    function getOrCreateContainer(isPopup) {
      if (!doc) return null;
      try {
        if (isPopup) {
          let container = doc.getElementById("popupNotificationContainer");
          if (!container) {
            container = doc.createElement("div");
            container.id = "popupNotificationContainer";
            container.className = "fly2git-glass-container fly2git-in-popup";
            const accountBar = doc.getElementById("accountBar");
            if (accountBar && accountBar.parentNode) {
              accountBar.parentNode.insertBefore(container, accountBar.nextSibling);
            } else if (doc.body) {
              doc.body.insertBefore(container, doc.body.firstChild);
            }
          }
          return container;
        }

        let container = doc.getElementById("fly2git-glass-container");
        if (!container) {
          container = doc.createElement("div");
          container.id = "fly2git-glass-container";
          container.className = "fly2git-glass-container";
          (doc.body || doc.documentElement).appendChild(container);
        }
        return container;
      } catch (_) {
        return null;
      }
    }

    /**
     * Resolves default titles and metadata for the 5 notification types.
     */
    function normalizeNotificationData(opts) {
      const type = opts.type || NOTIFICATION_TYPES.SUCCESS;
      let defaultTitle = "Synced to GitHub";
      let defaultMeta = "";

      switch (type) {
        case NOTIFICATION_TYPES.SUCCESS:
          defaultTitle = "Synced to GitHub";
          defaultMeta = [opts.platform, opts.difficulty].filter(Boolean).join(" · ") || "LeetCode · Easy";
          break;
        case NOTIFICATION_TYPES.UPDATE:
          defaultTitle = "GitHub updated";
          defaultMeta = opts.platform ? `${opts.platform} · Solution updated` : "Solution updated";
          break;
        case NOTIFICATION_TYPES.DUPLICATE:
          defaultTitle = "Already synced";
          defaultMeta = "No changes were pushed";
          break;
        case NOTIFICATION_TYPES.SKIPPED:
          defaultTitle = "Sync skipped";
          defaultMeta = opts.reason || "Filtered by your automation rule";
          break;
        case NOTIFICATION_TYPES.ERROR:
          defaultTitle = "GitHub sync failed";
          defaultMeta = opts.error || opts.reason || "Could not push the solution";
          break;
      }

      return {
        type,
        title: opts.title || defaultTitle,
        problemTitle: opts.problemTitle || "Solution",
        meta: opts.meta || defaultMeta,
        platform: opts.platform || "",
        difficulty: opts.difficulty || "",
        repository: opts.repository || "",
        path: opts.path || "",
        commitUrl: opts.commitUrl || null,
        syncId: opts.syncId || null,
        duration: typeof opts.duration === "number" ? opts.duration : (DURATION_BY_TYPE[type] || 3000),
        onRetry: typeof opts.onRetry === "function" ? opts.onRetry : null,
        collapsedCount: opts.collapsedCount || 0,
        isPopup: Boolean(opts.isPopup),
      };
    }

    /**
     * Renders a notification into the DOM.
     */
    function renderNotification(item) {
      if (!doc) {
        activeNotification = { item, el: null };
        return activeNotification;
      }

      injectStyles();
      const isPopup = item.isPopup || isPopupContext();
      const container = getOrCreateContainer(isPopup);
      if (!container) return null;

      const card = doc.createElement("div");
      card.className = "fly2git-liquid-glass";
      card.setAttribute("role", item.type === NOTIFICATION_TYPES.ERROR ? "alert" : "status");
      card.setAttribute("aria-live", item.type === NOTIFICATION_TYPES.ERROR ? "assertive" : "polite");
      card.setAttribute("aria-atomic", "true");
      card.setAttribute("tabindex", "0");

      const ariaAnnouncement = `${item.title}. ${item.problemTitle}. ${item.meta}`;
      card.setAttribute("aria-label", ariaAnnouncement);

      // Light shimmer element (single-run)
      const shimmer = doc.createElement("div");
      shimmer.className = "fly2git-glass-shimmer";
      shimmer.setAttribute("aria-hidden", "true");
      card.appendChild(shimmer);

      // Icon Wrap
      const iconWrap = doc.createElement("div");
      iconWrap.className = `fly2git-notif-icon-wrap type-${item.type}`;
      iconWrap.innerHTML = ICONS[item.type] || ICONS.success;
      card.appendChild(iconWrap);

      // Body
      const body = doc.createElement("div");
      body.className = "fly2git-notif-body";

      // Header row
      const headerRow = doc.createElement("div");
      headerRow.className = "fly2git-notif-header";

      const titleSpan = doc.createElement("span");
      titleSpan.className = "fly2git-notif-title";
      titleSpan.textContent = item.title;
      headerRow.appendChild(titleSpan);

      if (item.collapsedCount > 0) {
        const badge = doc.createElement("span");
        badge.className = "fly2git-collapsed-badge";
        badge.textContent = `+${item.collapsedCount}`;
        headerRow.appendChild(badge);
      }

      const closeBtn = doc.createElement("button");
      closeBtn.className = "fly2git-notif-close";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Dismiss notification");
      closeBtn.innerHTML = ICONS.close;
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dismissCurrentNotification();
      });
      headerRow.appendChild(closeBtn);
      body.appendChild(headerRow);

      // Problem Title
      const problemDiv = doc.createElement("div");
      problemDiv.className = "fly2git-notif-problem";
      problemDiv.textContent = item.problemTitle;
      body.appendChild(problemDiv);

      // Metadata
      if (item.meta) {
        const metaDiv = doc.createElement("div");
        metaDiv.className = "fly2git-notif-meta";
        metaDiv.textContent = item.meta;
        body.appendChild(metaDiv);
      }

      // Path
      const displayPath = item.repository && item.path ? `${item.repository}/${item.path}` : (item.repository || item.path);
      if (displayPath) {
        const pathDiv = doc.createElement("div");
        pathDiv.className = "fly2git-notif-path";
        pathDiv.textContent = displayPath;
        body.appendChild(pathDiv);
      }

      // Actions (View, Retry)
      const actionRow = doc.createElement("div");
      actionRow.className = "fly2git-notif-action-row";
      let hasActions = false;

      if ((item.type === NOTIFICATION_TYPES.SUCCESS || item.type === NOTIFICATION_TYPES.UPDATE) && item.commitUrl) {
        const viewBtn = doc.createElement("button");
        viewBtn.className = "fly2git-notif-action-btn";
        viewBtn.type = "button";
        viewBtn.textContent = "View";
        viewBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          handleAction(item);
        });
        actionRow.appendChild(viewBtn);
        hasActions = true;
      }

      if (item.type === NOTIFICATION_TYPES.ERROR && item.onRetry) {
        const retryBtn = doc.createElement("button");
        retryBtn.className = "fly2git-notif-retry-btn";
        retryBtn.type = "button";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          dismissCurrentNotification();
          try {
            item.onRetry();
          } catch (_) {}
        });
        actionRow.appendChild(retryBtn);
        hasActions = true;
      }

      if (hasActions) {
        body.appendChild(actionRow);
      }

      card.appendChild(body);

      // Card-level Click / Keyboard Interaction
      card.addEventListener("click", function () {
        handleAction(item);
      });

      card.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          dismissCurrentNotification();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAction(item);
        }
      });

      container.appendChild(card);
      activeNotification = { item, el: card };

      // Auto-dismiss Timer
      startAutoDismissTimer(item.duration);

      return activeNotification;
    }

    function handleAction(item) {
      if (!item) return;
      try {
        if ((item.type === NOTIFICATION_TYPES.SUCCESS || item.type === NOTIFICATION_TYPES.UPDATE) && item.commitUrl) {
          if (win && win.open) {
            win.open(item.commitUrl, "_blank", "noopener,noreferrer");
          } else if (chromeApi && chromeApi.tabs && chromeApi.tabs.create) {
            chromeApi.tabs.create({ url: item.commitUrl });
          }
        } else if (item.type === NOTIFICATION_TYPES.DUPLICATE && item.repository) {
          const repoUrl = item.path
            ? `https://github.com/${item.repository}/tree/main/${item.path}`
            : `https://github.com/${item.repository}`;
          if (win && win.open) {
            win.open(repoUrl, "_blank", "noopener,noreferrer");
          } else if (chromeApi && chromeApi.tabs && chromeApi.tabs.create) {
            chromeApi.tabs.create({ url: repoUrl });
          }
        } else if (item.type === NOTIFICATION_TYPES.ERROR && item.onRetry) {
          item.onRetry();
        }
      } catch (_) {}
    }

    function startAutoDismissTimer(duration) {
      clearAutoDismissTimer();
      autoDismissTimer = setTimeout(() => {
        dismissCurrentNotification();
      }, duration || 3000);
    }

    function clearAutoDismissTimer() {
      if (autoDismissTimer) {
        clearTimeout(autoDismissTimer);
        autoDismissTimer = null;
      }
    }

    /**
     * Dismisses the currently displayed notification with exit animation.
     */
    function dismissCurrentNotification() {
      clearAutoDismissTimer();
      if (!activeNotification) return;

      const current = activeNotification;
      const el = current.el;

      function onComplete() {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
        activeNotification = null;

        // Process next item in queue sequentially
        if (queue.length > 0) {
          const nextItem = queue.shift();
          renderNotification(nextItem);
        }
      }

      if (el) {
        el.classList.add("fly2git-exiting");
        setTimeout(onComplete, 260);
      } else {
        onComplete();
      }
    }

    /**
     * Core public method: showSyncNotification
     * Enforces deduplication and queueing rules (max 1 visible, max 3 queued).
     */
    function showSyncNotification(options = {}) {
      try {
        if (!options || typeof options !== "object") {
          return { shown: false, error: "invalid_options" };
        }

        const item = normalizeNotificationData(options);

        // Deduplication check
        if (item.syncId) {
          if (isDuplicateSyncId(item.syncId)) {
            return { shown: false, reason: "duplicate_id" };
          }
          recordSyncId(item.syncId);
        }

        // If a notification is currently displayed, handle queue
        if (activeNotification) {
          if (queue.length >= MAX_QUEUE_SIZE) {
            // Collapse overflow into summary item
            const lastIdx = queue.length - 1;
            const existingOverflow = queue[lastIdx].collapsedCount || 1;
            const newOverflow = existingOverflow + 1;

            queue[lastIdx] = {
              type: NOTIFICATION_TYPES.SUCCESS,
              title: "Synced to GitHub",
              problemTitle: `${newOverflow + 1} more solutions synced`,
              meta: "Multiple solutions synced",
              collapsedCount: newOverflow,
              duration: 3000,
              isPopup: item.isPopup,
            };

            return {
              shown: false,
              queued: true,
              collapsed: true,
              overflowCount: newOverflow,
            };
          }

          queue.push(item);
          return { shown: false, queued: true, queuePosition: queue.length };
        }

        // Otherwise display immediately
        renderNotification(item);
        return { shown: true, item };
      } catch (err) {
        // Notification rendering must never throw into callers
        return { shown: false, error: err ? err.message : "render_error" };
      }
    }

    function clearQueue() {
      queue.length = 0;
    }

    function getQueue() {
      return queue.slice();
    }

    function getActiveNotification() {
      return activeNotification ? Object.assign({}, activeNotification) : null;
    }

    // Auto-listen to chrome.runtime.onMessage if available
    if (chromeApi && chromeApi.runtime && chromeApi.runtime.onMessage) {
      try {
        chromeApi.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
          if (msg && msg.type === "fly2git-sync-result" && msg.payload) {
            try {
              const res = showSyncNotification(msg.payload);
              if (typeof sendResponse === "function") {
                sendResponse({ received: true, result: res });
              }
            } catch (_) {
              if (typeof sendResponse === "function") {
                sendResponse({ received: true });
              }
            }
          }
        });
      } catch (_) {}
    }

    return {
      showSyncNotification,
      dismissCurrentNotification,
      getQueue,
      clearQueue,
      getActiveNotification,
      resetDeduplication,
      injectStyles,
      createNotificationService,
      NOTIFICATION_TYPES,
      DURATION_BY_TYPE,
      MAX_QUEUE_SIZE,
    };
  }

  // Default singleton instance for the current execution environment
  const defaultService = createNotificationService();

  return defaultService;
});
