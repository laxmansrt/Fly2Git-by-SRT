// Fly2Git — by SRT
// Privileged bridge: validates messages coming from the LeetCode page world
// before forwarding the minimum required payload to the service worker.
(function () {
  "use strict";

  if (!window.location.hostname.endsWith("leetcode.com")) return;
  if (window.__FLY2GIT_LEETCODE_CONTENT_INITIALIZED__) return;
  window.__FLY2GIT_LEETCODE_CONTENT_INITIALIZED__ = true;

  const EXPECTED_ORIGIN = "https://leetcode.com";
  const DIFFICULTIES = new Set(["Easy", "Medium", "Hard", "Unknown"]);
  const MAX_CODE_LENGTH = 200_000;
  const emittedAcceptanceKeys = new Set(); // Guard: leetcode:slug:submissionId

  function debug(...args) {
    console.log("[Fly2Git][Bridge]", ...args);
  }

  function isExtensionContextValid() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return false;
      chrome.runtime.getURL("");
      return true;
    } catch (e) {
      return false;
    }
  }

  var detectedIdentity = null;

  function detectDomIdentity() {
    try {
      var userLink = document.querySelector('a[href^="/u/"], a[href^="/profile/"], #navbar_user_avatar');
      var username = null;
      if (userLink && userLink.getAttribute("href")) {
        var m = userLink.getAttribute("href").match(/\/(?:u|profile)\/([^/?#]+)/);
        if (m) username = m[1];
      }
      if (username) {
        detectedIdentity = { username: username, platformUserId: username };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "leetcode",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
    } catch (_) {}
  }

  detectDomIdentity();
  setTimeout(detectDomIdentity, 1500);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== EXPECTED_ORIGIN) return;

    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    // Handle Identity Detection broadcast from page context
    if ((msg.source === "fly2git-leetcode" || msg.source === "fly2git") && msg.type === "IDENTITY_DETECTED") {
      if (msg.payload && (msg.payload.username || msg.payload.platformUserId)) {
        detectedIdentity = {
          username: msg.payload.username || null,
          platformUserId: msg.payload.platformUserId || null,
        };
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({
            type: "PLATFORM_IDENTITY_DETECTED",
            platform: "leetcode",
            identity: detectedIdentity,
          }).catch(function () {});
        }
      }
      return;
    }

    if ((msg.source !== "fly2git-leetcode" && msg.source !== "fly2git") || msg.type !== "ACCEPTED") return;

    const p = msg.payload;
    if (!p || typeof p !== "object") return;

    // Support both nested NormalizedSubmission format and legacy flat format from inject.js
    const problem = (p.problem && typeof p.problem === "object") ? p.problem : p;
    const submission = (p.submission && typeof p.submission === "object") ? p.submission : p;

    const slug = typeof problem.slug === "string" ? problem.slug : "";
    const title = typeof problem.title === "string" ? problem.title : "";
    const difficulty = typeof problem.difficulty === "string" ? problem.difficulty : "";
    const url = typeof problem.url === "string" ? problem.url : "";

    const submissionId = String(submission.id != null ? submission.id : (p.submissionId != null ? p.submissionId : ""));
    const lang = typeof (submission.language || submission.lang) === "string" ? (submission.language || submission.lang) : "";
    const code = typeof submission.code === "string" ? submission.code : "";
    const status = typeof submission.status === "string" ? submission.status : "Accepted";

    if (!code || code.length > MAX_CODE_LENGTH) return;
    if (!lang || lang.length > 50 || lang.toLowerCase() === "unknown") return;
    if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.length > 200) return;
    if (!title || title.length > 300) return;
    if (!difficulty || !DIFFICULTIES.has(difficulty)) return;
    if (!url || !/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/.test(url)) return;
    if (!submissionId || !/^\d+$/.test(submissionId) || submissionId.length > 100) return;
    if (status !== "Accepted") return;

    console.log("[Fly2Git][LeetCode] Bridge received submission", {
      submissionId: submissionId,
      slug: slug,
      lang: lang,
    });

    const acceptanceKey = "leetcode:" + slug + ":" + submissionId;
    if (emittedAcceptanceKeys.has(acceptanceKey)) {
      debug("Duplicate LeetCode submission ignored", acceptanceKey);
      return;
    }
    emittedAcceptanceKeys.add(acceptanceKey);
    if (emittedAcceptanceKeys.size > 100) {
      emittedAcceptanceKeys.delete(emittedAcceptanceKeys.values().next().value);
    }

    if (!isExtensionContextValid()) {
      console.warn(
        "[Fly2Git][Bridge] Extension context invalidated (extension was reloaded). " +
        "Please refresh this tab to re-activate Fly2Git."
      );
      return;
    }

    debug("Accepted payload validated", submissionId);

    var userIdentity = p.user || detectedIdentity;

    const normalizedSubmission = {
      platform: "leetcode",
      user: userIdentity,
      problem: {
        slug: slug,
        title: title,
        difficulty: difficulty,
        url: url,
      },
      submission: {
        id: submissionId,
        status: "Accepted",
        language: lang,
        code: code,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    try {
      chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        payload: normalizedSubmission,
      }).then((response) => {
        if (response?.ok) debug("Background sync completed", response);
        else console.error("[Fly2Git][Bridge] Background sync failed", response);
      }).catch((error) => {
        console.error("[Fly2Git][Bridge] Could not reach background", error);
      });
    } catch (ctxErr) {
      console.error("[Fly2Git][Bridge] Extension context lost — refresh this tab.", ctxErr);
    }
  });

  console.log("[Fly2Git] v1.1.6 content bridge loaded");
  debug("Bridge loaded");
})();
