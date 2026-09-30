// Fly2Git — by SRT
// Privileged bridge: validates messages coming from the LeetCode page world
// before forwarding the minimum required payload to the service worker.
(function () {
  "use strict";

  const EXPECTED_ORIGIN = "https://leetcode.com";
  const DIFFICULTIES = new Set(["Easy", "Medium", "Hard", "Unknown"]);
  const MAX_CODE_LENGTH = 200_000;

  function debug(...args) {
    console.log("[Fly2Git][Bridge]", ...args);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== EXPECTED_ORIGIN) return;

    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.source !== "fly2git" || msg.type !== "ACCEPTED") return;

    const p = msg.payload;
    if (!p || typeof p !== "object") return;
    if (typeof p.code !== "string" || !p.code || p.code.length > MAX_CODE_LENGTH) return;
    if (typeof p.lang !== "string" || !p.lang || p.lang.length > 50) return;
    if (typeof p.slug !== "string" || !/^[a-z0-9-]+$/.test(p.slug)) return;
    if (typeof p.title !== "string" || !p.title || p.title.length > 300) return;
    if (typeof p.difficulty !== "string" || !DIFFICULTIES.has(p.difficulty)) return;
    if (typeof p.url !== "string" || !/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/.test(p.url)) return;
    if (typeof p.submissionId !== "string" || !/^\d+$/.test(p.submissionId)) return;

    debug("Accepted payload validated", p.submissionId);

    chrome.runtime.sendMessage({
      type: "PUSH_TO_GITHUB",
      payload: {
        code: p.code,
        lang: p.lang,
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        url: p.url,
        submissionId: p.submissionId,
      },
    }).then((response) => {
      if (response?.ok) debug("Background sync completed", response);
      else console.error("[Fly2Git][Bridge] Background sync failed", response);
    }).catch((error) => {
      console.error("[Fly2Git][Bridge] Could not reach background", error);
    });
  });

  console.log("[Fly2Git] v1.1.6 content bridge loaded");
  debug("Bridge loaded");
})();
