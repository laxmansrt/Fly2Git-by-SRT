// Fly2Git — by SRT
// HackerRank content bridge (ISOLATED world)
//
// Responsibilities:
// 1. Listen for FLY2GIT_HACKERRANK_ACCEPTED custom events and window messages
//    from hackerrank-inject.js (MAIN world).
// 2. Validate incoming normalized submission payload.
// 3. De-duplicate acceptance events via submission-specific key:
//    hackerrank:${slug}:${submissionId}
// 4. Forward PUSH_TO_GITHUB message to the background service worker.
// 5. Defend against extension context invalidation.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, cookies, or authorization headers.
// - Never logs source code.
// - Validates all payload fields before forwarding to background.
//
// DOES NOT TOUCH: inject.js, content.js, gfg-inject.js, gfg-content.js

(function () {
  "use strict";

  if (!window.location.hostname.endsWith("hackerrank.com")) return;
  if (window.__FLY2GIT_HACKERRANK_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_HACKERRANK_CONTENT_INITIALIZED__ = true;

  console.log("[Fly2Git] HackerRank content bridge loaded");

  var MAX_CODE_LENGTH = 200000;
  var emittedAcceptanceKeys = new Set(); // Guard: hackerrank:slug:submissionId
  var detectedIdentity = null;

  function detectHackerRankIdentity() {
    try {
      var userEl = document.querySelector('a[href^="/profile/"], .profile-username, .username, [data-analytics="NavBarUserDropdown"]');
      var username = null;
      if (userEl && userEl.getAttribute("href")) {
        var m = userEl.getAttribute("href").match(/\/profile\/([^/?#]+)/);
        if (m) username = m[1];
      }
      if (!username && userEl) {
        var txt = userEl.textContent.trim();
        if (txt && !txt.includes("Log In") && !txt.includes("Sign Up") && txt.length <= 50) {
          username = txt;
        }
      }
      if (username) {
        detectedIdentity = { username: username, platformUserId: username };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "hackerrank",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
    } catch (_) {}
  }

  detectHackerRankIdentity();
  setTimeout(detectHackerRankIdentity, 1500);

  function debug() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][HackerRank]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // Extension context validity check
  // Invokes chrome.runtime.getURL("") which immediately throws
  // "Extension context invalidated." if extension was reloaded.
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
  // Payload validation
  // ---------------------------------------------------------------
  function validatePayload(p) {
    if (!p || typeof p !== "object") return "Empty or non-object payload";

    var platform = (p.platform || "").toString().toLowerCase();
    if (platform !== "hackerrank") {
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
    if (!p.submission.id || typeof p.submission.id !== "string" || p.submission.id.length > 100) {
      return "Invalid submission ID";
    }
    if (p.submission.status !== "Accepted") {
      return "Submission status is not Accepted: " + p.submission.status;
    }
    if (!p.submission.language || typeof p.submission.language !== "string" || p.submission.language.length > 50 || p.submission.language.toLowerCase() === "unknown") {
      return "Invalid language identifier";
    }
    if (!p.submission.code || typeof p.submission.code !== "string" || p.submission.code.trim().length === 0) {
      return "Submission code is empty";
    }
    if (p.submission.code.length > MAX_CODE_LENGTH) {
      return "Submission code exceeds maximum permitted length";
    }

    return null; // Valid
  }

  // ---------------------------------------------------------------
  // Forward to Background
  // ---------------------------------------------------------------
  function processAcceptedPayload(normalizedPayload) {
    var validationError = validatePayload(normalizedPayload);
    if (validationError) {
      console.warn("[Fly2Git][HackerRank] Payload rejected:", validationError);
      return;
    }

    normalizedPayload.user = normalizedPayload.user || detectedIdentity;

    var slug = normalizedPayload.problem.slug;
    var submissionId = normalizedPayload.submission.id;
    var acceptanceKey = "hackerrank:" + slug + ":" + submissionId;

    if (emittedAcceptanceKeys.has(acceptanceKey)) {
      debug("Duplicate submission ignored", acceptanceKey);
      return;
    }

    emittedAcceptanceKeys.add(acceptanceKey);
    // Maintain maximum set size to prevent memory leaks in long-running tabs
    if (emittedAcceptanceKeys.size > 100) {
      emittedAcceptanceKeys.delete(emittedAcceptanceKeys.values().next().value);
    }

    if (!isExtensionContextValid()) {
      console.warn(
        "[Fly2Git][HackerRank] Extension context invalidated (extension was reloaded). " +
        "Please refresh this tab to re-activate Fly2Git."
      );
      return;
    }

    debug("Forwarding accepted submission to background", submissionId);

    var sendPromise;
    try {
      sendPromise = chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        payload: normalizedPayload,
      });
    } catch (ctxErr) {
      console.error(
        "[Fly2Git][HackerRank] Extension context lost — refresh this tab. (" +
        (ctxErr && ctxErr.message || String(ctxErr)) + ")"
      );
      return;
    }

    sendPromise
      .then(function (response) {
        if (response && response.ok) {
          debug("Background sync completed", response);
        } else {
          var errText = (response && response.error) || "unknown error";
          var errCode = (response && response.code) || "unknown code";
          console.error(
            "[Fly2Git][HackerRank] Background sync failed | error: " +
            errText + " | code: " + errCode + " | id: " + submissionId
          );
        }
      })
      .catch(function (err) {
        console.error(
          "[Fly2Git][HackerRank] Could not reach background | " +
          (err && err.message || String(err))
        );
      });
  }

  // ---------------------------------------------------------------
  // Event Listeners (Dual-Channel: CustomEvent and window.postMessage)
  // ---------------------------------------------------------------
  window.addEventListener("FLY2GIT_HACKERRANK_ACCEPTED", function (event) {
    if (!event || !event.detail) return;
    processAcceptedPayload(event.detail);
  });

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== "https://www.hackerrank.com") return;
    var data = event.data;
    if (data && data.source === "fly2git-hackerrank" && data.type === "ACCEPTED") {
      processAcceptedPayload(data.payload);
    }
  });

})();
