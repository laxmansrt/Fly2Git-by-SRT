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

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== EXPECTED_ORIGIN) return;

    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if ((msg.source !== "fly2git-leetcode" && msg.source !== "fly2git") || msg.type !== "ACCEPTED") return;

    const p = msg.payload;
    if (!p || typeof p !== "object") return;
    if (typeof p.code !== "string" || !p.code || p.code.length > MAX_CODE_LENGTH) return;
    if (typeof p.lang !== "string" || !p.lang || p.lang.length > 50 || p.lang.toLowerCase() === "unknown") return;
    if (typeof p.slug !== "string" || !/^[a-z0-9-]+$/.test(p.slug) || p.slug.length > 200) return;
    if (typeof p.title !== "string" || !p.title || p.title.length > 300) return;
    if (typeof p.difficulty !== "string" || !DIFFICULTIES.has(p.difficulty)) return;
    if (typeof p.url !== "string" || !/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/.test(p.url)) return;
    if (typeof p.submissionId !== "string" || !/^\d+$/.test(p.submissionId) || p.submissionId.length > 100) return;

    const acceptanceKey = "leetcode:" + p.slug + ":" + p.submissionId;
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

    debug("Accepted payload validated", p.submissionId);

    try {
      chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        payload: {
          platform: "LeetCode",
          problem: {
            slug: p.slug,
            title: p.title,
            difficulty: p.difficulty,
            url: p.url,
          },
          submission: {
            id: p.submissionId,
            status: "Accepted",
            language: p.lang,
            code: p.code,
          },
          metadata: {
            timestamp: Date.now(),
          },
        },
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
