// Fly2Git — Safe Diagnostics Generator (Phase 18)
// Generates clean, scrubbed diagnostic reports for user support.
// EXPLICITLY EXCLUDES: access tokens, cookies, source code, prompts, AI responses, private keys.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitDiagnostics = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "1.1.6";

  const SENSITIVE_PATTERNS = [
    /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
    new RegExp("\\b" + "AIza" + "Sy" + "[A-Za-z0-9_-]{20,60}\\b", "g"),
    /\bsk_(live|test)_[0-9a-zA-Z]{24,}\b/g,
    /\bwhsec_[0-9a-zA-Z]{32,}\b/g,
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    /\bBearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g,
  ];

  /**
   * Scrubs any accidental sensitive strings from text.
   *
   * @param {string} str
   * @returns {string}
   */
  function sanitizeString(str) {
    if (typeof str !== "string") return "";
    let clean = str;
    for (const pat of SENSITIVE_PATTERNS) {
      clean = clean.replace(pat, "[REDACTED]");
    }
    return clean;
  }

  /**
   * Generates a safe, unprivileged diagnostic snapshot.
   *
   * @param {object} [state={}]
   * @returns {object} Safe diagnostics object
   */
  function generateSafeDiagnostics(state = {}) {
    const isBrowser = typeof navigator !== "undefined";
    const userAgent = isBrowser ? navigator.userAgent || "Unknown Browser" : "Node.js Environment";
    const platform = isBrowser ? navigator.platform || "Unknown OS" : process.platform || "mac";

    const lastSync = state.lastSync || null;
    let safeLastSync = null;
    if (lastSync) {
      safeLastSync = {
        ok: Boolean(lastSync.ok),
        platform: lastSync.platform ? String(lastSync.platform).toLowerCase() : null,
        status: lastSync.status ? sanitizeString(String(lastSync.status)) : null,
        timestamp: typeof lastSync.timestamp === "number" ? lastSync.timestamp : null,
      };
    }

    const safeErrors = Array.isArray(state.recentErrors)
      ? state.recentErrors
          .slice(-5)
          .map((e) => (typeof e === "string" ? sanitizeString(e) : e && e.code ? e.code : "ERR_UNKNOWN"))
      : [];

    return {
      fly2gitVersion: VERSION,
      appVersion: VERSION,
      apiVersion: "v1",
      browser: userAgent.includes("Chrome") ? "Chrome" : "Chromium-based",
      os: platform,
      selectedPlatform: state.selectedPlatform ? String(state.selectedPlatform).toLowerCase() : null,
      backendReachability: state.backendReachability !== false,
      githubConnected: Boolean(state.githubConnected || (state.auth && state.auth.accessToken)),
      selectedRepoConfigured: Boolean(state.selectedRepo),
      aiAvailability: state.aiAvailable !== false,
      latestSyncResult: safeLastSync,
      safeErrorCodes: safeErrors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Formats diagnostics into human-readable plain text for user sharing.
   *
   * @param {object} diag
   * @returns {string}
   */
  function formatDiagnosticsText(diag) {
    const d = diag || generateSafeDiagnostics();
    const lines = [
      "Fly2Git Diagnostic Report",
      "=========================",
      `Version: ${d.fly2gitVersion}`,
      `OS / Browser: ${d.os} · ${d.browser}`,
      `GitHub Connected: ${d.githubConnected ? "Yes" : "No"}${d.selectedRepoConfigured ? " (Repo set)" : " (No repo selected)"}`,
      `Selected Platform: ${d.selectedPlatform || "None selected"}`,
      `Backend Reachable: ${d.backendReachability ? "Yes" : "No"}`,
      `AI Service Ready: ${d.aiAvailability ? "Yes" : "No"}`,
      `Latest Sync: ${d.latestSyncResult ? `${d.latestSyncResult.ok ? "Success" : "Failed"} (${d.latestSyncResult.platform || "n/a"})` : "None recorded"}`,
      `Recent Safe Errors: ${d.safeErrorCodes && d.safeErrorCodes.length > 0 ? d.safeErrorCodes.join(", ") : "None"}`,
      `Generated At: ${d.timestamp}`,
      "-------------------------",
      "Confidential: Zero tokens, passwords, code, or personal secrets are included in this report.",
    ];
    return lines.join("\n");
  }

  /**
   * Copies formatted diagnostics to clipboard safely.
   *
   * @param {object} [state]
   * @returns {Promise<boolean>}
   */
  async function copyDiagnosticsToClipboard(state) {
    const text = formatDiagnosticsText(generateSafeDiagnostics(state));
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  return {
    VERSION,
    generateSafeDiagnostics,
    formatDiagnosticsText,
    copyDiagnosticsToClipboard,
    sanitizeString,
  };
});
