// Fly2Git — by SRT
// AtCoder content bridge (ISOLATED world)
//
// Responsibilities:
// 1. Verify hostname === "atcoder.jp" and singleton guard.
// 2. Receive staging payload from atcoder-inject.js and store it in
//    extension-owned session storage (chrome.storage.session) with 30s TTL.
//    (ZERO use of window.sessionStorage).
// 3. On submissions page (/contests/{contest}/submissions/me), retrieve staging,
//    verify TTL (< 30s), contestId, and taskId, correlate top-row submissionId,
//    and IMMEDIATELY delete the staging from extension session storage.
// 4. Notify atcoder-inject.js of correlated submissionId for passive /status/json observation.
// 5. Fallback DOM MutationObserver for submission verdict cell updates.
// 6. Validate incoming normalized submission payload (schema, lengths, types).
// 7. De-duplicate acceptance events via submission-specific key:
//    atcoder:${contestId}:${taskId}:${submissionId}
// 8. Forward PUSH_TO_GITHUB message to the background service worker.
// 9. Defend against extension context invalidation.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, cookies, CSRF secrets, or auth headers.
// - Never logs source code.
// - Zero use of page-level window.sessionStorage for submission staging.
// - Never places source code into sync history, diagnostics, logs, or UI.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) return;
  if (window.location.hostname !== "atcoder.jp") return;
  if (window.__FLY2GIT_ATCODER_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_ATCODER_CONTENT_INITIALIZED__ = true;

  console.log("[Fly2Git][AtCoder] Content bridge initialized");

  var MAX_CODE_LENGTH = 200000;
  var STAGING_STORAGE_KEY = "fly2git_atcoder_staging";
  var STAGING_TTL_MS = 30000; // 30 seconds max expiry

  var emittedAcceptanceKeys = new Set(); // Guard: atcoder:contest:task:submissionId
  var activeObserver = null;
  var observerTimeout = null;
  var detectedIdentity = null;

  function detectAtCoderIdentity() {
    try {
      var userEl = document.querySelector('#header a[href^="/users/"], .header-user a[href^="/users/"]');
      var username = null;
      if (userEl && userEl.getAttribute("href")) {
        var m = userEl.getAttribute("href").match(/\/users\/([^/?#]+)/);
        if (m) username = m[1];
      }
      if (username) {
        detectedIdentity = { username: username, platformUserId: username };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "atcoder",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
    } catch (_) {}
  }

  detectAtCoderIdentity();
  setTimeout(detectAtCoderIdentity, 1500);

  function debug() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][AtCoder]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // 1. Extension context validity check
  // ---------------------------------------------------------------
  function isExtensionContextValid() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return false;
      chrome.runtime.getURL("");
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------
  // 2. Extension Session Staging via Background Boundary
  // Staging is held exclusively in extension session storage in background.js.
  // atcoder-content.js uses secure runtime messages (STAGE, GET, CLEAR).
  // ZERO direct storage access in page/content scripts.
  // ---------------------------------------------------------------
  async function saveStaging(payload) {
    if (!payload || typeof payload !== "object") return;

    // Validate staging schema before saving
    if (!payload.contestId || !payload.taskId || !payload.language || !payload.code) {
      debug("Malformed staging payload rejected");
      return;
    }
    if (typeof payload.code !== "string" || payload.code.length > MAX_CODE_LENGTH) {
      debug("Staging code exceeds length limits");
      return;
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        await chrome.runtime.sendMessage({
          type: "STAGE_ATCODER_SUBMISSION",
          payload: payload,
        });
        debug("Staged submission via background message for task:", payload.taskId);
      } catch (_) {}
    }
  }

  async function loadStaging() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        var response = await chrome.runtime.sendMessage({ type: "GET_ATCODER_STAGING" });
        if (response && response.ok && response.staging) {
          var data = response.staging;
          // Validate recent timestamp (max 30s TTL)
          if (Date.now() - (data.timestamp || 0) > STAGING_TTL_MS) {
            debug("Staged submission in extension session storage expired (>30s), deleting");
            await clearStaging();
            return null;
          }
          return data;
        }
      } catch (_) {}
    }
    return null;
  }

  async function clearStaging() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        await chrome.runtime.sendMessage({ type: "CLEAR_ATCODER_STAGING" });
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------
  // 3. Staging Retrieval & Correlation on Submissions Page
  // ---------------------------------------------------------------
  async function checkForSubmissionsPage() {
    var pathname = window.location.pathname || "";
    if (!pathname.includes("/submissions")) return;

    var staged = await loadStaging();
    if (!staged) return;

    // Validate recent timestamp (max 30s TTL)
    if (Date.now() - (staged.timestamp || 0) > STAGING_TTL_MS) {
      debug("Staged submission in extension session storage expired (>30s), deleting");
      await clearStaging();
      return;
    }

    // Validate contest match
    var contestMatch = pathname.match(/\/contests\/([^\/\?#]+)/);
    var currentContestId = contestMatch ? contestMatch[1] : null;
    if (!currentContestId || currentContestId !== staged.contestId) {
      debug("Contest mismatch for staged submission:", currentContestId, "vs", staged.contestId);
      return;
    }

    // Inspect the submissions table
    var rows = document.querySelectorAll("table.table tbody tr");
    if (!rows || rows.length === 0) return;

    var topRow = rows[0];
    if (!topRow) return;

    // Check task correlation if task link exists in row
    var taskLink = topRow.querySelector('a[href*="/tasks/"]');
    if (taskLink && taskLink.getAttribute("href")) {
      var href = taskLink.getAttribute("href");
      if (!href.includes("/tasks/" + staged.taskId)) {
        debug("Top row task does not match staged task:", href, "vs", staged.taskId);
        return;
      }
    }

    debug("Correlating staged submission for contest:", staged.contestId, "task:", staged.taskId);

    // Extract submission ID from td[data-id] or detail link
    var statusTd = topRow.querySelector("td.waiting-judge") || topRow.querySelector("td[data-id]");
    var submissionId = null;
    if (statusTd && statusTd.getAttribute("data-id")) {
      submissionId = statusTd.getAttribute("data-id");
    } else {
      var detailLink = topRow.querySelector('a[href*="/submissions/"]');
      if (detailLink) {
        var m = detailLink.getAttribute("href").match(/\/submissions\/(\d+)/);
        if (m) submissionId = m[1];
      }
    }

    if (!submissionId || !/^\d+$/.test(submissionId)) {
      debug("Could not correlate top row submission ID");
      return;
    }

    debug("Submission ID identified:", submissionId);

    // Immediately delete staging from extension session storage
    await clearStaging();
    debug("Staging deleted from extension session storage after correlation");

    // Notify atcoder-inject.js to begin passive observation for this submissionId
    notifyInjectToObserve(submissionId, staged);

    // Setup DOM fallback observer if cell is still waiting
    setupDomFallbackObserver(submissionId, staged, statusTd || topRow);
  }

  function notifyInjectToObserve(submissionId, staged) {
    var detail = {
      submissionId: submissionId,
      contestId: staged.contestId,
      taskId: staged.taskId,
      language: staged.language,
      code: staged.code,
      title: staged.title,
      url: staged.url,
      timestamp: staged.timestamp,
    };

    try {
      window.dispatchEvent(
        new CustomEvent("FLY2GIT_ATCODER_START_OBSERVING", {
          detail: detail,
        })
      );
    } catch (_) {}

    try {
      window.postMessage(
        {
          source: "fly2git-atcoder",
          type: "START_OBSERVING",
          payload: detail,
        },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // 4. Payload Validation & Forwarding to Background
  // ---------------------------------------------------------------
  function validatePayload(p) {
    if (!p || typeof p !== "object") return "Empty or non-object payload";

    var platform = (p.platform || "").toString().toLowerCase();
    if (platform !== "atcoder") {
      return "Invalid platform identifier: " + p.platform;
    }

    if (!p.problem || typeof p.problem !== "object") {
      return "Missing problem metadata";
    }
    if (!p.problem.slug || typeof p.problem.slug !== "string" || p.problem.slug.length > 200) {
      return "Invalid problem slug";
    }
    if (!p.problem.title || typeof p.problem.title !== "string" || p.problem.title.length > 300) {
      return "Invalid problem title";
    }

    if (!p.submission || typeof p.submission !== "object") {
      return "Missing submission details";
    }
    if (
      !p.submission.id ||
      typeof p.submission.id !== "string" ||
      !/^\d+$/.test(p.submission.id) ||
      p.submission.id.length > 100
    ) {
      return "Invalid submission ID: " + (p.submission && p.submission.id);
    }
    if (p.submission.status !== "Accepted") {
      return "Submission status is not Accepted: " + p.submission.status;
    }
    if (
      !p.submission.language ||
      typeof p.submission.language !== "string" ||
      p.submission.language.length > 50 ||
      p.submission.language.toLowerCase() === "unknown"
    ) {
      return "Invalid or unknown language identifier";
    }
    if (!p.submission.code || typeof p.submission.code !== "string" || p.submission.code.trim().length === 0) {
      return "Submission code is empty";
    }
    if (p.submission.code.length > MAX_CODE_LENGTH) {
      return "Submission code exceeds maximum permitted length";
    }

    return null; // Valid
  }

  function processAcceptedPayload(normalizedPayload) {
    var validationError = validatePayload(normalizedPayload);
    if (validationError) {
      console.warn("[Fly2Git][AtCoder] Payload rejected:", validationError);
      return;
    }

    normalizedPayload.user = normalizedPayload.user || detectedIdentity;

    var taskId = normalizedPayload.problem.slug;
    var submissionId = normalizedPayload.submission.id;

    var pathname = window.location.pathname || "";
    var contestMatch = pathname.match(/\/contests\/([^\/\?#]+)/);
    var contestId = contestMatch ? contestMatch[1] : "unknown_contest";

    var acceptanceKey = "atcoder:" + contestId + ":" + taskId + ":" + submissionId;

    if (emittedAcceptanceKeys.has(acceptanceKey)) {
      debug("Duplicate submission ignored:", acceptanceKey);
      return;
    }

    emittedAcceptanceKeys.add(acceptanceKey);
    // Keep max set size bounded
    if (emittedAcceptanceKeys.size > 100) {
      emittedAcceptanceKeys.delete(emittedAcceptanceKeys.values().next().value);
    }

    // Clean up any active DOM observer once accepted payload is handled
    cleanupObserver();

    if (!isExtensionContextValid()) {
      console.warn(
        "[Fly2Git][AtCoder] Extension context invalidated (extension was reloaded). " +
        "Please refresh this tab to re-activate Fly2Git."
      );
      return;
    }

    debug("NormalizedSubmission created:", normalizedPayload.problem.slug, "(" + normalizedPayload.submission.language + ") ID:", submissionId);
    debug("Forwarding accepted submission to background for ID:", submissionId);

    var sendPromise;
    try {
      sendPromise = chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        payload: normalizedPayload,
      });
    } catch (ctxErr) {
      console.error(
        "[Fly2Git][AtCoder] Extension context lost — refresh this tab. (" +
        ((ctxErr && ctxErr.message) || String(ctxErr)) + ")"
      );
      return;
    }

    sendPromise
      .then(function (response) {
        if (response && response.ok) {
          debug("GitHub sync completed successfully for ID:", submissionId);
        } else {
          var errText = (response && response.error) || "unknown error";
          var errCode = (response && response.code) || "unknown code";
          console.error(
            "[Fly2Git][AtCoder] Background sync failed | error: " +
            errText + " | code: " + errCode + " | id: " + submissionId
          );
        }
      })
      .catch(function (err) {
        console.error(
          "[Fly2Git][AtCoder] Could not reach background | " +
          ((err && err.message) || String(err))
        );
      });
  }

  // ---------------------------------------------------------------
  // 5. DOM Fallback: MutationObserver on Submissions Table
  // ---------------------------------------------------------------
  function cleanupObserver() {
    if (activeObserver) {
      try {
        activeObserver.disconnect();
      } catch (_) {}
      activeObserver = null;
    }
    if (observerTimeout) {
      clearTimeout(observerTimeout);
      observerTimeout = null;
    }
  }

  function setupDomFallbackObserver(submissionId, staged, statusTd) {
    if (!statusTd || !staged) return;

    cleanupObserver();

    // Check if cell is ALREADY accepted
    var initialContent = statusTd.innerHTML || "";
    if (/\bAC\b|label-success|Accepted/i.test(initialContent) && !/waiting-judge|\bWJ\b/i.test(initialContent)) {
      debug("DOM cell already AC for", submissionId);
      processAcceptedPayload({
        platform: "atcoder",
        problem: {
          slug: staged.taskId,
          title: staged.title || staged.taskId,
          difficulty: null,
          url: staged.url,
        },
        submission: {
          id: String(submissionId),
          status: "Accepted",
          language: staged.language,
          code: staged.code,
        },
        metadata: {
          timestamp: Date.now(),
        },
      });
      return;
    }

    debug("Setting up DOM fallback observer for submission ID:", submissionId);

    activeObserver = new MutationObserver(function () {
      var content = statusTd.innerHTML || "";
      var isAC = /\bAC\b|label-success|Accepted/i.test(content) && !/waiting-judge|\bWJ\b/i.test(content);
      var isTerminalFail = /\b(WA|TLE|MLE|RE|CE|OLE|IE)\b|label-warning|Wrong Answer/i.test(content) && !/waiting-judge|\bWJ\b/i.test(content);

      if (isAC) {
        debug("DOM fallback detected AC for", submissionId);
        cleanupObserver();
        var payload = {
          platform: "atcoder",
          problem: {
            slug: staged.taskId,
            title: staged.title || staged.taskId,
            difficulty: null,
            url: staged.url,
          },
          submission: {
            id: String(submissionId),
            status: "Accepted",
            language: staged.language,
            code: staged.code,
          },
          metadata: {
            timestamp: Date.now(),
          },
        };
        processAcceptedPayload(payload);
      } else if (isTerminalFail) {
        debug("DOM fallback detected terminal failure for", submissionId);
        cleanupObserver();
      }
    });

    try {
      activeObserver.observe(statusTd, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      // Bounded 60s timeout for DOM fallback observer
      observerTimeout = setTimeout(function () {
        debug("DOM fallback observer timed out after 60s");
        cleanupObserver();
      }, 60000);
    } catch (e) {
      debug("Failed to attach MutationObserver:", e.message);
    }
  }

  // ---------------------------------------------------------------
  // 6. Dual-Channel Event Listeners & Bridge Coordination
  // ---------------------------------------------------------------
  // 1. Staging capture event from atcoder-inject.js
  window.addEventListener("FLY2GIT_ATCODER_STAGE_SUBMISSION", function (event) {
    if (!event || !event.detail) return;
    saveStaging(event.detail);
  });

  // 2. Accepted submission event from atcoder-inject.js
  window.addEventListener("FLY2GIT_ATCODER_ACCEPTED", function (event) {
    if (!event || !event.detail) return;
    processAcceptedPayload(event.detail);
  });

  // 3. PostMessage router
  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== "https://atcoder.jp") return;
    var data = event.data;
    if (!data || data.source !== "fly2git-atcoder") return;

    if (data.type === "STAGE_SUBMISSION") {
      saveStaging(data.payload);
    } else if (data.type === "ACCEPTED") {
      processAcceptedPayload(data.payload);
    }
  });

  // Check for submissions page and correlate
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkForSubmissionsPage);
  } else {
    checkForSubmissionsPage();
  }

  // Export helpers for unit testing if running under Node
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      validatePayload: validatePayload,
      processAcceptedPayload: processAcceptedPayload,
      saveStaging: saveStaging,
      loadStaging: loadStaging,
      clearStaging: clearStaging,
      checkForSubmissionsPage: checkForSubmissionsPage,
      emittedAcceptanceKeys: emittedAcceptanceKeys,
      cleanupObserver: cleanupObserver,
      STAGING_STORAGE_KEY: STAGING_STORAGE_KEY,
      STAGING_TTL_MS: STAGING_TTL_MS,
      MAX_CODE_LENGTH: MAX_CODE_LENGTH,
    };
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
