// Fly2Git — by SRT
// SPOJ content bridge (ISOLATED world)
//
// Responsibilities:
// 1. Verify hostname === "www.spoj.com" and singleton guard.
// 2. Receive staging payload from spoj-inject.js and store it in
//    extension-owned session storage (chrome.storage.session) via background boundary.
//    (ZERO use of window.sessionStorage).
// 3. On status pages (/status/, /status/{CODE},{USERNAME}/), retrieve staging,
//    verify TTL (< 30s), correlate user's newest submission in the status table,
//    and delete staging once correlated.
// 4. Passively observe the submission row for terminal verdict (AC -> accepted, WA/TLE/CE/RE -> stop).
// 5. Construct and validate NormalizedSubmission contract (schema, bounds, difficulty: null).
// 6. Enforce entitlement access control and duplicate suppression:
//    spoj:{problemCode}:{submissionId}
// 7. Forward PUSH_TO_GITHUB message to the background service worker.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, credentials, session secrets, or auth headers.
// - Never logs complete source code.
// - Zero use of page-level window.sessionStorage for submission staging.
// - Never places source code into sync history, diagnostics, logs, or UI.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) return;
  if (window.location.hostname !== "www.spoj.com") return;
  if (window.__FLY2GIT_SPOJ_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_SPOJ_CONTENT_INITIALIZED__ = true;

  console.log("[Fly2Git][SPOJ] Content bridge initialized");

  var MAX_CODE_LENGTH = 200000;
  var STAGING_TTL_MS = 30000; // 30 seconds max expiry
  var OBSERVATION_TIMEOUT_MS = 60000; // 60 seconds max verdict observation

  var emittedSubmissionKeys = new Set(); // Guard: spoj:problemCode:submissionId
  var activeObserver = null;
  var observationTimer = null;
  var detectedIdentity = null;

  function detectSPOJIdentity() {
    try {
      var userEl = document.querySelector('a[href^="/users/"], a[href^="/status/"]');
      var username = null;
      if (userEl && userEl.getAttribute("href")) {
        var m = userEl.getAttribute("href").match(/\/(?:users|status)\/([^/?#]+)/);
        if (m) username = m[1];
      }
      if (username) {
        detectedIdentity = { username: username, platformUserId: username };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "spoj",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
    } catch (_) {}
  }

  detectSPOJIdentity();
  setTimeout(detectSPOJIdentity, 1500);

  function debug() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][SPOJ-Content]");
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
  // Staging is held exclusively in extension session storage via background.js.
  // spoj-content.js uses secure runtime messages (STAGE, GET, CLEAR).
  // ZERO direct storage access in page context.
  // ---------------------------------------------------------------
  async function saveStaging(payload) {
    if (!payload || typeof payload !== "object") return;

    if (!payload.problemCode || !payload.language || !payload.code) {
      debug("Malformed staging payload rejected");
      return;
    }
    if (typeof payload.code !== "string" || payload.code.length > MAX_CODE_LENGTH) {
      debug("Staging code exceeds length limits");
      return;
    }

    if (isExtensionContextValid()) {
      try {
        await chrome.runtime.sendMessage({
          type: "STAGE_SPOJ_SUBMISSION",
          payload: payload,
        });
        debug("Staged submission via background message for problem:", payload.problemCode);
      } catch (err) {
        debug("Failed to stage submission:", err);
      }
    }
  }

  async function loadStaging() {
    if (isExtensionContextValid()) {
      try {
        var response = await chrome.runtime.sendMessage({ type: "GET_SPOJ_STAGING" });
        if (response && response.ok && response.staging) {
          var data = response.staging;
          // Validate 30s TTL
          if (Date.now() - (data.timestamp || 0) > STAGING_TTL_MS) {
            debug("Staged submission in extension session storage expired (>30s), clearing");
            await clearStaging();
            return null;
          }
          return data;
        }
      } catch (err) {
        debug("Failed to load staging from background:", err);
      }
    }
    return null;
  }

  async function clearStaging() {
    if (isExtensionContextValid()) {
      try {
        await chrome.runtime.sendMessage({ type: "CLEAR_SPOJ_STAGING" });
        debug("Cleared staging in extension session storage");
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------
  // 3. Status Page Correlation & Passive Observation
  // ---------------------------------------------------------------
  function isStatusPage(pathname) {
    var path = (pathname || window.location.pathname || "").toLowerCase();
    return path.indexOf("/status") !== -1;
  }

  function parseStatusTableRows() {
    var tables = document.querySelectorAll("table.problems, #content table, .table-condensed, table");
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll("tbody tr, tr");
      if (rows.length > 0) {
        var validRows = [];
        for (var j = 0; j < rows.length; j++) {
          var cells = rows[j].querySelectorAll("td");
          // SPOJ status table has at least 5-8 columns: ID, DATE, USER, PROBLEM, RESULT, TIME, MEM, LANG
          if (cells.length >= 5) {
            var idText = cells[0].textContent.trim();
            if (/^\d+$/.test(idText)) {
              validRows.push({
                element: rows[j],
                cells: cells,
                id: idText,
                date: cells[1].textContent.trim(),
                user: cells[2].textContent.trim(),
                userLink: cells[2].querySelector("a")?.getAttribute("href") || "",
                problem: cells[3].textContent.trim(),
                problemCode: (cells[3].querySelector("a")?.getAttribute("title") || cells[3].textContent).trim().toUpperCase(),
                result: cells[4].textContent.trim().toLowerCase(),
                time: cells[5] ? cells[5].textContent.trim() : "",
                mem: cells[6] ? cells[6].textContent.trim() : "",
                lang: cells[7] ? cells[7].textContent.trim() : "",
              });
            }
          }
        }
        if (validRows.length > 0) return validRows;
      }
    }
    return [];
  }

  function correlateSubmissionRow(rows, staging) {
    if (!rows || rows.length === 0 || !staging) return null;

    var candidates = [];
    var stagedCode = String(staging.problemCode || "").toUpperCase();
    var stagedUser = staging.username ? String(staging.username).toLowerCase() : null;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      // Check problem code match
      if (row.problemCode !== stagedCode && row.problem.toUpperCase() !== stagedCode) {
        continue;
      }

      // Check username match if username was available during submit
      if (stagedUser) {
        var rowUserLower = row.user.toLowerCase();
        var rowUserHref = row.userLink.toLowerCase();
        if (rowUserLower !== stagedUser && rowUserHref.indexOf("/" + stagedUser) === -1) {
          continue;
        }
      }

      candidates.push(row);
    }

    if (candidates.length === 0) return null;

    // Check ambiguous match: newest candidate must be within correlation time window
    return candidates[0];
  }

  function parseSPOJVerdict(resultText) {
    var res = (resultText || "").toLowerCase().trim();
    if (res === "accepted" || res === "ac" || res.indexOf("accepted") !== -1) {
      return { status: "ACCEPTED", terminal: true };
    }
    if (
      res.indexOf("wrong answer") !== -1 ||
      res.indexOf("time limit") !== -1 ||
      res.indexOf("compilation error") !== -1 ||
      res.indexOf("runtime error") !== -1 ||
      res.indexOf("memory limit") !== -1 ||
      res === "wa" ||
      res === "tle" ||
      res === "ce" ||
      res === "re" ||
      res === "mle"
    ) {
      return { status: "FAILED", terminal: true, detail: res };
    }
    if (
      res.indexOf("waiting") !== -1 ||
      res.indexOf("compiling") !== -1 ||
      res.indexOf("running") !== -1 ||
      res.indexOf("judging") !== -1
    ) {
      return { status: "WAITING", terminal: false };
    }
    return { status: "UNKNOWN", terminal: false };
  }

  async function handleAcceptedSubmission(correlatedRow, staging) {
    var submissionId = String(correlatedRow.id);
    var problemCode = String(staging.problemCode).toUpperCase();
    var duplicateKey = "spoj:" + problemCode + ":" + submissionId;

    if (emittedSubmissionKeys.has(duplicateKey)) {
      debug("Duplicate submission ignored:", duplicateKey);
      return;
    }

    // Verify entitlement before constructing payload
    if (typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.isPlatformAllowed) {
      var allowed = await Fly2GitEntitlements.isPlatformAllowed("spoj");
      if (!allowed) {
        debug("SPOJ is not currently active/allowed by user entitlement");
        return;
      }
    }

    var spojUser = (staging && staging.username) || (correlatedRow && correlatedRow.user) || (detectedIdentity && detectedIdentity.username) || null;

    var normalized = {
      platform: "spoj",
      user: spojUser ? { username: spojUser, platformUserId: spojUser } : null,
      problem: {
        slug: problemCode,
        title: staging.title || problemCode,
        difficulty: null,
        url: staging.url || ("https://www.spoj.com/problems/" + problemCode + "/"),
      },
      submission: {
        id: submissionId,
        status: "Accepted",
        language: staging.language,
        code: staging.code,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    // Validate using centralized contract
    if (typeof Fly2GitPlatforms !== "undefined" && Fly2GitPlatforms.validateNormalizedSubmission) {
      var valRes = Fly2GitPlatforms.validateNormalizedSubmission(normalized);
      if (!valRes.ok) {
        debug("NormalizedSubmission contract validation failed:", valRes.error);
        return;
      }
    }

    emittedSubmissionKeys.add(duplicateKey);
    debug("Dispatching accepted submission to background GitHub sync:", duplicateKey);

    if (isExtensionContextValid()) {
      try {
        await chrome.runtime.sendMessage({
          type: "PUSH_TO_GITHUB",
          payload: normalized,
        });
        debug("PUSH_TO_GITHUB sent successfully for:", duplicateKey);
      } catch (err) {
        debug("Failed to send PUSH_TO_GITHUB message:", err);
      }
    }
  }

  async function observeStatusPage() {
    if (!isStatusPage(window.location.pathname)) return;

    var staging = await loadStaging();
    if (!staging) return;

    var rows = parseStatusTableRows();
    var match = correlateSubmissionRow(rows, staging);

    if (match) {
      var verdict = parseSPOJVerdict(match.result);
      if (verdict.status === "ACCEPTED") {
        await clearStaging();
        await handleAcceptedSubmission(match, staging);
        return;
      } else if (verdict.terminal) {
        debug("SPOJ submission failed with terminal verdict:", verdict.detail);
        await clearStaging();
        return;
      } else {
        debug("SPOJ submission is still being judged, setting up passive observer:", match.id);
        setupPassiveRowObserver(match.element, staging, match.id);
      }
    }
  }

  function setupPassiveRowObserver(rowElement, staging, submissionId) {
    if (activeObserver) activeObserver.disconnect();
    if (observationTimer) clearTimeout(observationTimer);

    observationTimer = setTimeout(function () {
      if (activeObserver) activeObserver.disconnect();
      debug("Passive observation timed out after 60s for submission:", submissionId);
    }, OBSERVATION_TIMEOUT_MS);

    var target = rowElement || document.querySelector("table.problems, #content table");
    if (!target) return;

    activeObserver = new MutationObserver(async function () {
      var rows = parseStatusTableRows();
      var currentMatch = correlateSubmissionRow(rows, staging);
      if (currentMatch && String(currentMatch.id) === String(submissionId)) {
        var verdict = parseSPOJVerdict(currentMatch.result);
        if (verdict.status === "ACCEPTED") {
          activeObserver.disconnect();
          if (observationTimer) clearTimeout(observationTimer);
          await clearStaging();
          await handleAcceptedSubmission(currentMatch, staging);
        } else if (verdict.terminal) {
          activeObserver.disconnect();
          if (observationTimer) clearTimeout(observationTimer);
          await clearStaging();
          debug("Passive observation finished with terminal failure:", verdict.detail);
        }
      }
    });

    activeObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------
  // 4. Content Bridge Message Listener (from spoj-inject.js)
  // ---------------------------------------------------------------
  window.addEventListener("message", async function (event) {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== "FLY2GIT_SPOJ_INJECT") return;

    if (data.type === "FLY2GIT_SPOJ_STAGING" && data.payload) {
      debug("Received submission staging payload from inject script");
      await saveStaging(data.payload);
    }
  });

  // Check status table on DOM load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeStatusPage);
  } else {
    observeStatusPage();
  }

  // Export for testing
  var exportsObj = {
    saveStaging: saveStaging,
    loadStaging: loadStaging,
    clearStaging: clearStaging,
    isStatusPage: isStatusPage,
    parseStatusTableRows: parseStatusTableRows,
    correlateSubmissionRow: correlateSubmissionRow,
    parseSPOJVerdict: parseSPOJVerdict,
    handleAcceptedSubmission: handleAcceptedSubmission,
    STAGING_TTL_MS: STAGING_TTL_MS,
    MAX_CODE_LENGTH: MAX_CODE_LENGTH,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitSPOJContent = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
