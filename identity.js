// Fly2Git — by SRT
// Phase 11B: Platform Identity Guard
//
// Prevents submissions from a different coding-platform account from being
// silently synced into the currently selected GitHub repository.
//
// CORE RULE:
// Before any GitHub write:
// CURRENT PLATFORM IDENTITY must match STORED PLATFORM IDENTITY.
// - MATCH: allow
// - MISMATCH: block (ACCOUNT_MISMATCH)
// - UNKNOWN: block (ACCOUNT_IDENTITY_UNKNOWN)
// - FIRST USE / UNBOUND: block (IDENTITY_BINDING_REQUIRED)
//
// Storage:
// Minimal metadata only in chrome.storage.local under "platformIdentities".
// Never stores passwords, tokens, cookies, auth headers, CSRF tokens, or source code.
// Never infers identity from GitHub username or repository.

(function (root) {
  "use strict";

  var STORAGE_KEY = "platformIdentities";

  var STATUS = Object.freeze({
    MATCH: "MATCH",
    MISMATCH: "ACCOUNT_MISMATCH",
    BINDING_REQUIRED: "IDENTITY_BINDING_REQUIRED",
    UNKNOWN: "ACCOUNT_IDENTITY_UNKNOWN",
  });

  /**
   * Normalizes platform identifier into canonical lowercase key.
   */
  function normalizePlatformKey(platform) {
    if (!platform || typeof platform !== "string") return "unknown";
    return platform.toLowerCase().trim();
  }

  /**
   * Sanitizes and bounds an incoming identity object.
   * Strips all extraneous properties, cookies, tokens, or code.
   */
  function sanitizeIdentity(raw) {
    if (!raw || typeof raw !== "object") return null;

    var platformUserId = null;
    var username = null;

    if (raw.platformUserId !== undefined && raw.platformUserId !== null) {
      var pId = String(raw.platformUserId).trim();
      if (pId.length > 0 && pId.length <= 120) {
        platformUserId = pId;
      }
    }

    if (raw.username !== undefined && raw.username !== null) {
      var uName = String(raw.username).trim();
      if (uName.length > 0 && uName.length <= 120) {
        username = uName;
      }
    }

    // Must have at least one identifier to be a valid identity
    if (!platformUserId && !username) {
      return null;
    }

    var detectedAt = typeof raw.detectedAt === "number" && !isNaN(raw.detectedAt)
      ? raw.detectedAt
      : Date.now();

    return {
      platformUserId: platformUserId,
      username: username,
      detectedAt: detectedAt,
    };
  }

  /**
   * Compares two sanitized identities for a match.
   * Prefers stable platformUserId; falls back to case-insensitive username.
   */
  function isIdentityMatch(id1, id2) {
    if (!id1 || !id2) return false;

    // Both have platformUserId: compare stable IDs
    if (id1.platformUserId && id2.platformUserId) {
      return String(id1.platformUserId).trim() === String(id2.platformUserId).trim();
    }

    // Fallback: compare usernames case-insensitively
    if (id1.username && id2.username) {
      return id1.username.toLowerCase() === id2.username.toLowerCase();
    }

    return false;
  }

  /**
   * Safe getter for all stored platform identities with self-healing.
   */
  async function getStoredIdentities() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return {};
      }
      var res = await chrome.storage.local.get(STORAGE_KEY);
      var data = res && res[STORAGE_KEY];
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return {};
      }
      return data;
    } catch (_) {
      return {};
    }
  }

  /**
   * Safe setter for platform identities.
   */
  async function saveStoredIdentities(data) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: data || {} });
  }

  /**
   * Retrieves identity state for a specific platform.
   */
  async function getPlatformState(platform) {
    var key = normalizePlatformKey(platform);
    var all = await getStoredIdentities();
    var entry = all[key];

    if (!entry || typeof entry !== "object") {
      return {
        platform: key,
        bound: null,
        current: null,
        status: STATUS.UNKNOWN,
      };
    }

    return {
      platform: key,
      bound: entry.bound || null,
      current: entry.current || null,
      status: entry.status || STATUS.UNKNOWN,
    };
  }

  /**
   * Called by platform adapters when an account identity is detected on page load.
   * If identity changed from bound, marks mismatch immediately without clearing old binding.
   * If no bound identity exists, marks binding required.
   */
  async function onIdentityDetected(platform, rawIdentity) {
    var key = normalizePlatformKey(platform);
    var sanitized = sanitizeIdentity(rawIdentity);
    var all = await getStoredIdentities();
    var entry = all[key] || { bound: null, current: null, status: STATUS.UNKNOWN };

    // If identity is unknown / null (e.g. logged out or page still loading):
    // Do NOT invalidate an existing valid binding.
    if (!sanitized) {
      entry.current = null;
      all[key] = entry;
      await saveStoredIdentities(all);
      return {
        platform: key,
        bound: entry.bound,
        current: null,
        status: entry.bound ? STATUS.MATCH : STATUS.UNKNOWN,
      };
    }

    entry.current = sanitized;

    if (!entry.bound) {
      // First use: binding required
      entry.status = STATUS.BINDING_REQUIRED;
    } else if (isIdentityMatch(sanitized, entry.bound)) {
      // Matches bound account
      entry.status = STATUS.MATCH;
    } else {
      // Differs from bound account: mismatch
      entry.status = STATUS.MISMATCH;
    }

    all[key] = entry;
    await saveStoredIdentities(all);

    return {
      platform: key,
      bound: entry.bound,
      current: entry.current,
      status: entry.status,
    };
  }

  /**
   * Authoritative verification performed by background.js immediately before sync.
   * Returns { ok: true, status: "MATCH", bound, current } or { ok: false, status: ... }
   */
  async function verifySubmissionIdentity(platform, rawSubmissionIdentity) {
    var key = normalizePlatformKey(platform);
    var all = await getStoredIdentities();
    var entry = all[key] || { bound: null, current: null, status: STATUS.UNKNOWN };

    // Resolve current identity: from submission payload or last detected current identity
    var current = sanitizeIdentity(rawSubmissionIdentity) || entry.current;

    // Rule 1: Unknown identity -> block sync
    if (!current) {
      return {
        ok: false,
        status: STATUS.UNKNOWN,
        reason: "Coding account identity could not be determined for " + platform + ". Sync blocked for safety.",
        bound: entry.bound,
        current: null,
      };
    }

    // Update current in storage
    entry.current = current;

    // Rule 2: First use / No stored binding -> binding required
    if (!entry.bound) {
      entry.status = STATUS.BINDING_REQUIRED;
      all[key] = entry;
      await saveStoredIdentities(all);
      return {
        ok: false,
        status: STATUS.BINDING_REQUIRED,
        reason: "New coding account detected for " + platform + " (" + (current.username || current.platformUserId) + "). Explicit confirmation required.",
        bound: null,
        current: current,
      };
    }

    // Rule 3: Current identity differs from bound -> mismatch
    if (!isIdentityMatch(current, entry.bound)) {
      entry.status = STATUS.MISMATCH;
      all[key] = entry;
      await saveStoredIdentities(all);
      return {
        ok: false,
        status: STATUS.MISMATCH,
        reason: "Different coding account detected for " + platform + ". Current: " +
          (current.username || current.platformUserId) + ", Bound: " +
          (entry.bound.username || entry.bound.platformUserId) + ". Automatic sync paused.",
        bound: entry.bound,
        current: current,
      };
    }

    // Rule 4: Match -> allow
    entry.status = STATUS.MATCH;
    all[key] = entry;
    await saveStoredIdentities(all);

    return {
      ok: true,
      status: STATUS.MATCH,
      bound: entry.bound,
      current: current,
    };
  }

  /**
   * Explicit binding / rebinding by user action ("Use this account").
   * Updates only this platform's bound account.
   * Does NOT affect other platforms or GitHub repository selection.
   */
  async function bindPlatformIdentity(platform, rawIdentity) {
    var key = normalizePlatformKey(platform);
    var all = await getStoredIdentities();
    var entry = all[key] || { bound: null, current: null, status: STATUS.UNKNOWN };

    var toBind = sanitizeIdentity(rawIdentity) || entry.current;
    if (!toBind) {
      throw new Error("Cannot bind platform identity: no valid account identity provided or detected for " + platform);
    }

    var boundRecord = {
      platformUserId: toBind.platformUserId || null,
      username: toBind.username || null,
      boundAt: Date.now(),
    };

    entry.bound = boundRecord;
    entry.current = toBind;
    entry.status = STATUS.MATCH;

    all[key] = entry;
    await saveStoredIdentities(all);

    return {
      ok: true,
      platform: key,
      status: STATUS.MATCH,
      bound: boundRecord,
      current: toBind,
    };
  }

  /**
   * Resets / clears identity binding for a specific platform (explicit user action).
   */
  async function clearPlatformBinding(platform) {
    var key = normalizePlatformKey(platform);
    var all = await getStoredIdentities();
    if (all[key]) {
      all[key].bound = null;
      all[key].status = all[key].current ? STATUS.BINDING_REQUIRED : STATUS.UNKNOWN;
      await saveStoredIdentities(all);
    }
    return { ok: true, platform: key };
  }

  var exportsObj = {
    STATUS: STATUS,
    normalizePlatformKey: normalizePlatformKey,
    sanitizeIdentity: sanitizeIdentity,
    isIdentityMatch: isIdentityMatch,
    getStoredIdentities: getStoredIdentities,
    getPlatformState: getPlatformState,
    onIdentityDetected: onIdentityDetected,
    verifySubmissionIdentity: verifySubmissionIdentity,
    bindPlatformIdentity: bindPlatformIdentity,
    clearPlatformBinding: clearPlatformBinding,
  };

  // Export for service worker (importScripts), browser globals, and Node testing
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitIdentity = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
