// Fly2Git — by SRT
// GeeksforGeeks content bridge (ISOLATED world)
//
// Responsibilities:
// 1. Watch the DOM for the GFG acceptance signal via MutationObserver.
// 2. On acceptance: dispatch FLY2GIT_GFG_REQUEST to page context (gfg-inject.js).
// 3. Collect the FLY2GIT_GFG_RESPONSE payload.
// 4. Validate the payload and forward PUSH_TO_GITHUB to the service worker.
// 5. Survive SPA navigation by re-attaching the observer on URL change.
//
// SECURITY:
// - Never reads cookies, tokens, or credentials.
// - Never logs source code.
// - Validates all fields before forwarding to background.
//
// DOES NOT TOUCH: inject.js, content.js, background.js, platforms.js, manifest.json
(function () {
  "use strict";

  if (!window.location.hostname.endsWith("geeksforgeeks.org")) return;
  if (window.__FLY2GIT_GFG_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_GFG_CONTENT_INITIALIZED__ = true;

  console.log("[Fly2Git] v1.1.6 GFG content bridge loaded");

  var MAX_CODE_LENGTH = 200000;
  // 2s cooldown debounces rapid DOM mutations during the initial result render.
  // Cross-render duplicates are handled by emittedAcceptanceKeys.
  var ACCEPT_COOLDOWN_MS = 2000;
  var GFG_ORIGIN = "https://www.geeksforgeeks.org";

  // ---------------------------------------------------------------
  // Acceptance signals — multiple strings to handle GFG UI variants
  // ---------------------------------------------------------------
  var ACCEPTED_SIGNALS = [
    "problem solved successfully",
    "correct answer",
  ];

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  var lastEmittedAt = 0;
  var emittedAcceptanceKeys = new Set(); // Guard: geeksforgeeks:slug:submissionId
  var bodyObserver = null;
  var lastObservedPath = "";
  var detectedIdentity = null;

  function detectGfgIdentity() {
    try {
      var userEl = document.querySelector('a[href*="/user/"], .user_profile, .header-user-profile');
      var username = null;
      if (userEl && userEl.getAttribute("href")) {
        var m = userEl.getAttribute("href").match(/\/user\/([^/?#]+)/);
        if (m) username = m[1];
      }
      if (!username && userEl) {
        var txt = userEl.textContent.trim();
        if (txt && !txt.includes("Sign In") && !txt.includes("Login") && txt.length <= 50) {
          username = txt;
        }
      }
      if (username) {
        detectedIdentity = { username: username, platformUserId: username };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "geeksforgeeks",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
    } catch (_) {}
  }

  function debug() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][GFG]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // Extension context validity check
  //
  // When the extension is reloaded while a tab is open, Chrome
  // invalidates the content script's context. chrome.runtime.id
  // is just a string property that might not throw, but calling
  // chrome.runtime.getURL("") is a native Blink binding that
  // throws "Extension context invalidated." immediately.
  // Checking it early lets us self-disconnect the observer rather
  // than letting every DOM mutation trigger an error.
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
  // Acceptance detection — scans DOM text for known acceptance signals
  // ---------------------------------------------------------------
  function isAcceptanceSignalPresent() {
    if (!document.body) return false;
    var text = (document.body.innerText || "").toLowerCase();
    for (var i = 0; i < ACCEPTED_SIGNALS.length; i++) {
      if (text.indexOf(ACCEPTED_SIGNALS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Payload extraction — asks gfg-inject.js (MAIN world) for data
  // via CustomEvent bridge. Returns a Promise.
  // ---------------------------------------------------------------
  function requestPayloadFromPageContext() {
    return new Promise(function (resolve, reject) {
      try {
        var timeout = setTimeout(function () {
          window.removeEventListener("FLY2GIT_GFG_RESPONSE", onResponse);
          reject(new Error("Timed out waiting for FLY2GIT_GFG_RESPONSE"));
        }, 5000);

        function onResponse(event) {
          clearTimeout(timeout);
          resolve(event.detail || {});
        }

        window.addEventListener("FLY2GIT_GFG_RESPONSE", onResponse, { once: true });
        window.dispatchEvent(new CustomEvent("FLY2GIT_GFG_REQUEST"));
      } catch (e) {
        // Catches "Extension context invalidated." when Chrome kills the
        // content script context after extension reload.
        reject(e);
      }
    });
  }

  // ---------------------------------------------------------------
  // Validation — minimal check before forwarding to background
  // The background further validates via validateNormalizedSubmission.
  // ---------------------------------------------------------------
  function validatePayload(p) {
    if (!p || typeof p !== "object") return "Empty payload";
    if (!p.codeExtracted || typeof p.code !== "string" || p.code.length === 0) {
      return "Code could not be extracted from editor";
    }
    if (p.code.length > MAX_CODE_LENGTH) return "Code exceeds maximum length";
    if (!p.slug || typeof p.slug !== "string" || p.slug.length > 200) return "Invalid or missing slug";
    if (p.title && (typeof p.title !== "string" || p.title.length > 300)) return "Invalid title";
    if (p.difficulty && (typeof p.difficulty !== "string" || p.difficulty.length > 50)) return "Invalid difficulty";
    // language must be a non-null string (normalizeGfgLanguage returns null for unknowns)
    if (!p.language || typeof p.language !== "string" || p.language.length > 50 || p.language.toLowerCase() === "unknown") {
      return "Could not normalize language (raw: " + JSON.stringify(p.language) + ")";
    }
    if (p.submissionId && (typeof p.submissionId !== "string" || p.submissionId.length > 100)) return "Invalid submissionId";
    return null; // valid
  }

  // ---------------------------------------------------------------
  // Emit — forward validated payload to background as NormalizedSubmission
  // ---------------------------------------------------------------
  function emitAccepted(raw) {
    var validationError = validatePayload(raw);
    if (validationError) {
      console.warn("[Fly2Git][GFG] Payload rejected:", validationError);
      return;
    }

    debug("Forwarding accepted submission to background", raw.submissionId);

    var userIdentity = raw.user || detectedIdentity;

    // Build NormalizedSubmission structure
    var normalizedPayload = {
      platform: "GeeksforGeeks",
      user: userIdentity,
      problem: {
        slug: raw.slug,
        title: raw.title || raw.slug,
        difficulty: raw.difficulty || "Unknown",
        url: raw.url || window.location.href,
      },
      submission: {
        id: raw.submissionId,
        status: "Accepted",
        language: raw.language,
        code: raw.code,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    // ---------------------------------------------------------------
    // sendMessage wrapped in try/catch.
    //
    // Chrome's context invalidation is not reliably detectable via
    // typeof checks: chrome.runtime.sendMessage can appear valid
    // (typeof === "function") yet throw when invoked.
    // The try/catch is the only bulletproof guard.
    // isExtensionContextValid() at handlePotentialAcceptance fires
    // first and self-disconnects the observer; this is the fallback
    // for any gap between the two checks.
    // ---------------------------------------------------------------
    var sendPromise;
    try {
      sendPromise = chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        payload: normalizedPayload,
      });
    } catch (ctxErr) {
      console.error(
        "[Fly2Git][GFG] Extension context lost — refresh this tab. (" +
        (ctxErr && ctxErr.message || String(ctxErr)) + ")"
      );
      return;
    }

    sendPromise.then(function (response) {
      if (response && response.ok) {
        debug("Background sync completed", response);
      } else {
        var errText = (response && response.error) || "unknown error";
        var errCode = (response && response.code)  || "unknown code";
        var errLang = normalizedPayload.submission && normalizedPayload.submission.language;
        console.error(
          "[Fly2Git][GFG] Background sync failed" +
          " | error: " + errText +
          " | code: "  + errCode +
          " | lang: "  + errLang +
          " | slug: "  + (normalizedPayload.problem && normalizedPayload.problem.slug)
        );
      }
    }).catch(function (err) {
      console.error("[Fly2Git][GFG] Could not reach background | " + (err && err.message || String(err)));
    });
  }

  // ---------------------------------------------------------------
  // Acceptance handler — called when MutationObserver sees a signal
  // ---------------------------------------------------------------
  function handlePotentialAcceptance() {
    // ---- Context validity check (MUST be first) ----
    // If the extension was reloaded while this tab stayed open,
    // chrome.runtime is dead. Disconnect the observer permanently
    // so it stops firing on every DOM mutation and log once.
    if (!isExtensionContextValid()) {
      console.warn(
        "[Fly2Git][GFG] Extension context invalidated — " +
        "refresh this tab to re-activate Fly2Git."
      );
      if (bodyObserver) {
        bodyObserver.disconnect();
        bodyObserver = null;
      }
      return;
    }

    var now = Date.now();
    if (now - lastEmittedAt < ACCEPT_COOLDOWN_MS) {
      // Within cooldown window — already handled this acceptance event
      return;
    }

    if (!isAcceptanceSignalPresent()) return;

    lastEmittedAt = now;
    debug("Acceptance signal detected");

    // Give the DOM a moment to finish rendering then extract
    setTimeout(function () {
      requestPayloadFromPageContext().then(function (payload) {
        if (!payload || !payload.slug || !payload.submissionId) {
          debug("Incomplete payload received, skipping");
          return;
        }

        // Acceptance guard: prevents MutationObserver from processing the same
        // accepted result multiple times while allowing different languages,
        // modified code, or new submissions for the same slug to proceed.
        var acceptanceKey = "geeksforgeeks:" + payload.slug + ":" + payload.submissionId;
        if (emittedAcceptanceKeys.has(acceptanceKey)) {
          debug("Duplicate acceptance key detected, skipping", acceptanceKey);
          return;
        }

        emittedAcceptanceKeys.add(acceptanceKey);
        if (emittedAcceptanceKeys.size > 100) {
          emittedAcceptanceKeys.delete(emittedAcceptanceKeys.values().next().value);
        }
        // Isolate emitAccepted errors from the page-context catch below.
        // emitAccepted failing (e.g. context invalidated) must not be
        // misreported as "Page context request failed".
        try {
          emitAccepted(payload);
        } catch (emitErr) {
          console.error("[Fly2Git][GFG] emitAccepted threw: " + (emitErr && emitErr.message || String(emitErr)));
        }
      }).catch(function (err) {
        var msg = (err && err.message) || String(err);
        if (msg.indexOf("Extension context invalidated") !== -1) {
          console.warn(
            "[Fly2Git][GFG] Extension context invalidated (extension was reloaded). " +
            "Please refresh this tab to re-activate Fly2Git."
          );
          if (bodyObserver) {
            bodyObserver.disconnect();
            bodyObserver = null;
          }
          return;
        }
        // This catch is for actual requestPayloadFromPageContext failures
        // (e.g. gfg-inject.js timeout, CustomEvent not firing).
        console.warn("[Fly2Git][GFG] Page context request failed:", msg);
      });
    }, 300);
  }

  // ---------------------------------------------------------------
  // MutationObserver — watches document.body for DOM changes
  // ---------------------------------------------------------------
  function startObserver() {
    if (!document.body) {
      setTimeout(startObserver, 100);
      return;
    }

    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }

    bodyObserver = new MutationObserver(function () {
      handlePotentialAcceptance();
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
    lastObservedPath = window.location.pathname;
    detectGfgIdentity();
    debug("Observer started on", lastObservedPath);
  }

  // ---------------------------------------------------------------
  // SPA navigation handler — GFG does not trigger full page reloads.
  // Poll pathname every 1.5s and re-attach observer on navigation.
  // ---------------------------------------------------------------
  var navInterval = setInterval(function () {
    if (!isExtensionContextValid()) {
      clearInterval(navInterval);
      if (bodyObserver) {
        bodyObserver.disconnect();
        bodyObserver = null;
      }
      return;
    }
    var currentPath = window.location.pathname;
    if (currentPath !== lastObservedPath) {
      debug("SPA navigation detected:", lastObservedPath, "->", currentPath);
      // Reset cooldown for the new problem
      lastEmittedAt = 0;
      startObserver();
    }
  }, 1500);

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  if (document.body) {
    startObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startObserver);
  }

})();
