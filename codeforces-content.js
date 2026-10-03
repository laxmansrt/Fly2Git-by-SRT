// Fly2Git — by SRT
// Codeforces content bridge (ISOLATED world)
//
// Responsibilities:
// 1. Verify hostname === "codeforces.com" and singleton guard.
// 2. Receive staging payload from codeforces-inject.js and store it in
//    extension-owned session storage (chrome.storage.session) with 30s TTL.
//    (ZERO use of window.sessionStorage).
// 3. Coordinate submission discovery by sending POLL_CODEFORCES_STATUS
//    messages to background.js (which performs the actual API fetch to
//    https://codeforces.com/api/user.status). Content script NEVER makes
//    cross-origin API requests directly.
// 4. Rate-limit bounded polling: max 12 attempts, 3.5s interval (~42s timeout).
// 5. Contest safety: suppress syncing if author.participantType === "CONTESTANT" during active contests.
// 6. Verdict parsing: OK -> Accepted; terminal failures -> halt without syncing.
// 7. Clear staging immediately upon terminal resolution or correlation.
// 8. Forward NormalizedSubmission to background via PUSH_TO_GITHUB.
// 9. De-duplicate submissions via codeforces:${contestId}:${problemIndex}:${submissionId}.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, cookies, CSRF secrets, passwords, or auth headers.
// - Never logs complete source code.
// - Zero use of page-level window.sessionStorage for submission staging.
// - Never places source code into sync history, diagnostics, logs, or UI.
// - Zero direct cross-origin fetch calls — all API traffic goes through background.js.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) {
    if (typeof module !== "undefined" && module.exports) {
      exportModule();
    }
    return;
  }

  var hostname = window.location.hostname || "";
  if (hostname !== "codeforces.com" && !hostname.endsWith(".codeforces.com")) {
    return;
  }

  if (window.__FLY2GIT_CODEFORCES_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_CODEFORCES_CONTENT_INITIALIZED__ = true;

  var DEBUG = true;
  var MAX_CODE_LENGTH = 200000;
  var POLL_INTERVAL_MS = 3500; // >= 2000ms official rate limit
  var MAX_POLL_ATTEMPTS = 12; // ~42 seconds total discovery window
  var STAGING_TTL_MS = 30000; // 30 seconds

  var emittedSubmissionKeys = new Set(); // Guard: codeforces:contestId:problemIndex:submissionId
  var activeDiscoveryTimer = null;
  var currentPollAttempt = 0;
  var isDiscovering = false;
  var detectedIdentity = null;

  function detectCodeforcesIdentity() {
    try {
      var userEl = document.querySelector('a[href^="/profile/"]');
      var handle = null;
      if (userEl && userEl.getAttribute("href")) {
        var m = userEl.getAttribute("href").match(/\/profile\/([^/?#]+)/);
        if (m) handle = m[1];
      }
      if (handle) {
        detectedIdentity = { username: handle, platformUserId: handle };
        safeSendMessage({
          type: "PLATFORM_IDENTITY_DETECTED",
          platform: "codeforces",
          identity: detectedIdentity,
        });
      }
    } catch (_) {}
  }

  detectCodeforcesIdentity();
  setTimeout(detectCodeforcesIdentity, 1500);

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][Codeforces-Content]");
    console.log.apply(console, args);
  }

  debug("Content bridge initialized on", window.location.pathname);

  var TERMINAL_FAILURES = Object.freeze([
    "WRONG_ANSWER",
    "COMPILATION_ERROR",
    "RUNTIME_ERROR",
    "TIME_LIMIT_EXCEEDED",
    "MEMORY_LIMIT_EXCEEDED",
    "IDLENESS_LIMIT_EXCEEDED",
    "SECURITY_VIOLATED",
    "CRASHED",
    "INPUT_PREPARATION_CRASHED",
    "CHALLENGED",
    "SKIPPED",
    "REJECTED",
    "PARTIAL",
  ]);

  function isTerminalFailure(verdict) {
    if (!verdict || typeof verdict !== "string") return false;
    return TERMINAL_FAILURES.indexOf(verdict.toUpperCase()) !== -1;
  }

  function isAcceptedVerdict(verdict) {
    if (!verdict || typeof verdict !== "string") return false;
    return verdict.toUpperCase() === "OK";
  }

  function normalizeLanguage(rawLang) {
    if (!rawLang || typeof rawLang !== "string") return null;
    var l = rawLang.trim().toLowerCase();

    // JavaScript / Node (check BEFORE Java to avoid partial match)
    if (l.includes("javascript") || l.includes("node")) return "javascript";

    // C++
    if (l.includes("c++") || l.includes("g++") || l.includes("clang++")) return "cpp";

    // C
    if (l.includes("gnu c") || l === "c" || l.startsWith("c11") || l.startsWith("c99")) return "c";

    // Python / PyPy
    if (l.includes("python") || l.includes("pypy")) return "python";

    // Java
    if (l.includes("java")) return "java";

    // Kotlin
    if (l.includes("kotlin")) return "kotlin";

    // Rust
    if (l.includes("rust")) return "rust";

    // Go
    if (l === "go" || l.startsWith("go ") || l.includes("golang")) return "go";

    // C#
    if (l.includes("c#") || l.includes(".net") || l.includes("mono c#")) return "csharp";

    return null;
  }

  /**
   * Validates staging payload schema and bounds before session storage.
   */
  function validateStagingPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (typeof payload.handle !== "string" || !payload.handle || payload.handle.length > 100) return false;
    if (typeof payload.contestId !== "number" || payload.contestId <= 0) return false;
    if (typeof payload.problemIndex !== "string" || !payload.problemIndex || payload.problemIndex.length > 10) return false;
    if (typeof payload.code !== "string" || !payload.code || payload.code.length > MAX_CODE_LENGTH) return false;
    if (typeof payload.timestamp !== "number") return false;
    return true;
  }

  /**
   * Checks whether an official API submission matches the staged submission.
   */
  function isMatchingSubmission(sub, staging) {
    if (!sub || !sub.problem || !staging) return false;

    // Match contest ID
    var subContestId = sub.contestId || sub.problem.contestId;
    if (subContestId !== staging.contestId) return false;

    // Match problem index
    var subIndex = String(sub.problem.index || "").toUpperCase();
    var stagingIndex = String(staging.problemIndex || "").toUpperCase();
    if (subIndex !== stagingIndex) return false;

    // Match creation timestamp within window [-30s, +120s]
    var subTimeMs = (sub.creationTimeSeconds || 0) * 1000;
    if (subTimeMs < staging.timestamp - 30000 || subTimeMs > staging.timestamp + 120000) {
      return false;
    }

    // Match author handle
    if (sub.author && Array.isArray(sub.author.members)) {
      var hasHandle = sub.author.members.some(function (m) {
        return m.handle && m.handle.toLowerCase() === staging.handle.toLowerCase();
      });
      if (!hasHandle) return false;
    }

    return true;
  }

  /**
   * Builds the canonical NormalizedSubmission object from API submission and staging.
   */
  function buildNormalizedSubmission(sub, staging) {
    var raw = sub.programmingLanguage || (staging && staging.language) || "cpp";
    var canonicalLang = normalizeLanguage(raw) || (staging && staging.language) || "cpp";
    if (!canonicalLang) return null;

    var rating = (sub.problem && sub.problem.rating != null) ? String(sub.problem.rating) : "Unknown";
    var slug = "codeforces-" + staging.contestId + "-" + staging.problemIndex;
    var title = (sub.problem && sub.problem.name) || staging.title || slug;
    var problemUrl = "https://codeforces.com/contest/" + staging.contestId + "/problem/" + staging.problemIndex;

    var authorHandle = (staging && staging.handle) || (detectedIdentity && detectedIdentity.username) || null;

    return {
      platform: "codeforces",
      user: authorHandle ? { username: authorHandle, platformUserId: authorHandle } : null,
      problem: {
        slug: slug,
        title: title,
        difficulty: rating,
        url: problemUrl,
      },
      submission: {
        id: String(sub.id),
        status: "Accepted",
        language: canonicalLang,
        code: staging.code,
      },
      metadata: {
        timestamp: (sub.creationTimeSeconds || 0) * 1000 || Date.now(),
      },
    };
  }

  function stopDiscovery() {
    isDiscovering = false;
    if (activeDiscoveryTimer) {
      clearTimeout(activeDiscoveryTimer);
      activeDiscoveryTimer = null;
    }
    currentPollAttempt = 0;
  }

  /**
   * Starts sequential bounded polling of official Codeforces user.status API.
   */
  function startSubmissionDiscovery(staging) {
    if (isDiscovering) {
      debug("Discovery is already in progress");
      return;
    }

    if (!validateStagingPayload(staging)) {
      debug("Invalid staging payload provided for discovery");
      return;
    }

    isDiscovering = true;
    currentPollAttempt = 0;

    debug("Starting official API discovery for user:", staging.handle, "contest:", staging.contestId, "index:", staging.problemIndex);

    function pollStep() {
      if (!isDiscovering) return;
      currentPollAttempt++;

      if (currentPollAttempt > MAX_POLL_ATTEMPTS) {
        debug("Discovery reached maximum attempts (" + MAX_POLL_ATTEMPTS + ") — stopping polling");
        stopDiscovery();
        safeClearStaging();
        return;
      }

      // Delegate API request to background service worker (boundary hardening).
      // The content script never performs cross-origin fetches to codeforces.com/api.
      safeSendMessage(
        { type: "POLL_CODEFORCES_STATUS", handle: staging.handle },
        function (response) {
          if (!response || !response.ok || !Array.isArray(response.submissions)) {
            debug("Background API poll returned error:", response ? response.error : "no response");
            scheduleNextStep();
            return;
          }

          var submissions = response.submissions;
          var matched = null;

          for (var i = 0; i < submissions.length; i++) {
            if (isMatchingSubmission(submissions[i], staging)) {
              matched = submissions[i];
              break;
            }
          }

          if (!matched) {
            debug("No matching submission found in attempt", currentPollAttempt);
            scheduleNextStep();
            return;
          }

          debug("Identified matching submission ID:", matched.id, "verdict:", matched.verdict);

          // 1. CONTEST SAFETY CHECK
          if (matched.author && matched.author.participantType === "CONTESTANT") {
            console.warn("[Fly2Git][Codeforces] Submission belongs to an active rated contest participant — Fly2Git pauses syncing during active Codeforces contests.");
            stopDiscovery();
            safeClearStaging();
            return;
          }

          // 2. TERMINAL FAILURE CHECK
          if (isTerminalFailure(matched.verdict)) {
            debug("Submission finished with terminal failure (" + matched.verdict + ") — halting without sync");
            stopDiscovery();
            safeClearStaging();
            return;
          }

          // 3. ACCEPTED VERDICT CHECK
          if (isAcceptedVerdict(matched.verdict)) {
            var dedupKey = "codeforces:" + staging.contestId + ":" + staging.problemIndex + ":" + matched.id;
            if (emittedSubmissionKeys.has(dedupKey)) {
              debug("Submission already processed:", dedupKey);
              stopDiscovery();
              safeClearStaging();
              return;
            }

            var normalized = buildNormalizedSubmission(matched, staging);
            if (!normalized) {
              debug("Failed to normalize submission — halting");
              stopDiscovery();
              safeClearStaging();
              return;
            }

            emittedSubmissionKeys.add(dedupKey);
            stopDiscovery();
            safeClearStaging();

            debug("Dispatching PUSH_TO_GITHUB for submission ID:", matched.id);
            safeSendMessage({
              type: "PUSH_TO_GITHUB",
              payload: normalized,
            });
            return;
          }

          // 4. TRANSIENT / TESTING
          debug("Submission verdict is non-terminal (" + matched.verdict + ") — continuing discovery");
          scheduleNextStep();
        }
      );
    }

    function scheduleNextStep() {
      if (!isDiscovering) return;
      activeDiscoveryTimer = setTimeout(pollStep, POLL_INTERVAL_MS);
    }

    // First attempt immediately
    pollStep();
  }

  function safeSendMessage(msg, callback) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(msg, callback || function () {});
      }
    } catch (_) {}
  }

  function safeClearStaging() {
    safeSendMessage({ type: "CLEAR_CODEFORCES_STAGING" });
  }

  // Listen for STAGE_SUBMISSION from MAIN world (codeforces-inject.js)
  window.addEventListener("message", function (event) {
    if (!event || event.origin !== "https://codeforces.com") return;
    if (!event.data || event.data.source !== "FLY2GIT_CODEFORCES_INJECT") return;

    if (event.data.type === "STAGE_SUBMISSION") {
      var payload = event.data.payload;
      if (!validateStagingPayload(payload)) {
        debug("Rejected malformed staging payload from MAIN world");
        return;
      }

      debug("Received valid staging payload from MAIN world — sending to background");
      safeSendMessage({
        type: "STAGE_CODEFORCES_SUBMISSION",
        payload: payload,
      }, function () {
        // Initiate discovery
        startSubmissionDiscovery(payload);
      });
    }
  });

  // On page load, check if there is existing active staging (e.g. following form redirect)
  try {
    safeSendMessage({ type: "GET_CODEFORCES_STAGING" }, function (res) {
      if (res && res.staging) {
        var staging = res.staging;
        var age = Date.now() - (staging.timestamp || 0);
        if (age < STAGING_TTL_MS) {
          debug("Found unexpired staging in session storage (age: " + Math.round(age / 1000) + "s) — starting discovery");
          startSubmissionDiscovery(staging);
        } else {
          debug("Found expired staging in session storage — clearing");
          safeClearStaging();
        }
      }
    });
  } catch (_) {}

  function exportModule() {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = {
        validateStagingPayload: validateStagingPayload,
        isTerminalFailure: isTerminalFailure,
        isAcceptedVerdict: isAcceptedVerdict,
        normalizeLanguage: normalizeLanguage,
        isMatchingSubmission: isMatchingSubmission,
        buildNormalizedSubmission: buildNormalizedSubmission,
        TERMINAL_FAILURES: TERMINAL_FAILURES,
        POLL_INTERVAL_MS: POLL_INTERVAL_MS,
        MAX_POLL_ATTEMPTS: MAX_POLL_ATTEMPTS,
        STAGING_TTL_MS: STAGING_TTL_MS,
      };
    }
  }

  exportModule();
})(typeof globalThis !== "undefined" ? globalThis : this);
