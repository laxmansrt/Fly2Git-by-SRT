// Fly2Git — by SRT
// Centralized Entitlement Module & Platform Access Control
//
// Single source of truth for platform access entitlements:
// - BASIC: User may select any 2 active supported platforms (defaults to LeetCode + GeeksforGeeks)
// - PRO: User has access to all active supported platforms (test entitlement only in this phase)
//
// Security & Architecture:
// - Enforces access strictly on normalized platform identities.
// - An inactive platform (e.g. HackerRank) can NEVER be accessed even if selected or on PRO.
// - Does not add secrets, backend calls, or payment logic.
// - Compatible with service worker (importScripts), popup (browser globals), and Node testing.

(function (root) {
  "use strict";

  const ENTITLEMENT_STORAGE_KEY = "fly2git_entitlement";
  const ENTITLEMENT_VERSION = 1;
  const BASIC_MAX_PLATFORMS = 2;

  const DEFAULT_ENTITLEMENT = Object.freeze({
    version: ENTITLEMENT_VERSION,
    plan: "basic",
    selectedPlatforms: Object.freeze(["leetcode", "geeksforgeeks"]),
  });

  /**
   * Resolves the platform registry safely from Fly2GitPlatforms or fallback definition.
   */
  function getRegistry() {
    if (typeof Fly2GitPlatforms !== "undefined" && Fly2GitPlatforms.PLATFORM_REGISTRY) {
      return Fly2GitPlatforms.PLATFORM_REGISTRY;
    }
    if (typeof root !== "undefined" && root.Fly2GitPlatforms && root.Fly2GitPlatforms.PLATFORM_REGISTRY) {
      return root.Fly2GitPlatforms.PLATFORM_REGISTRY;
    }
    // Fallback registry matching platforms.js
    return Object.freeze({
      leetcode: Object.freeze({ id: "leetcode", name: "LeetCode", active: true }),
      geeksforgeeks: Object.freeze({ id: "geeksforgeeks", name: "GeeksforGeeks", active: true }),
      hackerrank: Object.freeze({ id: "hackerrank", name: "HackerRank", active: true }),
      codechef: Object.freeze({ id: "codechef", name: "CodeChef", active: true }),
      codeforces: Object.freeze({ id: "codeforces", name: "Codeforces", active: false }),
      atcoder: Object.freeze({ id: "atcoder", name: "AtCoder", active: false }),
    });
  }

  /**
   * Sanitizes any raw or stored entitlement object, defending against:
   * - missing/malformed objects
   * - invalid plan values (falls back to "basic")
   * - unknown platform IDs
   * - inactive platform IDs in selectedPlatforms under BASIC
   * - duplicate platform IDs
   * - selectedPlatforms > 2 under BASIC (keeps at most 2)
   * - PRO plan normalization (selectedPlatforms normalized to [])
   */
  function sanitizeEntitlement(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        version: ENTITLEMENT_VERSION,
        plan: DEFAULT_ENTITLEMENT.plan,
        selectedPlatforms: Array.from(DEFAULT_ENTITLEMENT.selectedPlatforms),
      };
    }

    const reg = getRegistry();
    const plan = raw.plan === "pro" ? "pro" : "basic";

    if (plan === "pro") {
      return {
        version: ENTITLEMENT_VERSION,
        plan: "pro",
        selectedPlatforms: [],
      };
    }

    // BASIC plan: sanitize selectedPlatforms
    let rawList = Array.isArray(raw.selectedPlatforms) ? raw.selectedPlatforms : DEFAULT_ENTITLEMENT.selectedPlatforms;
    const seen = new Set();
    const sanitizedPlatforms = [];

    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (typeof item !== "string") continue;
      const id = item.trim().toLowerCase();

      // Only allow known, currently active platforms in BASIC selection
      if (reg[id] && reg[id].active === true && !seen.has(id)) {
        seen.add(id);
        sanitizedPlatforms.push(id);
        if (sanitizedPlatforms.length === BASIC_MAX_PLATFORMS) {
          break; // Keep at most 2
        }
      }
    }

    return {
      version: ENTITLEMENT_VERSION,
      plan: "basic",
      selectedPlatforms: sanitizedPlatforms,
    };
  }

  /**
   * Retrieves the current entitlement from chrome.storage.local,
   * self-healing missing or invalid records with default configuration.
   */
  async function getEntitlement() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(ENTITLEMENT_STORAGE_KEY);
        const stored = result ? result[ENTITLEMENT_STORAGE_KEY] : null;

        if (!stored) {
          const initial = sanitizeEntitlement(DEFAULT_ENTITLEMENT);
          await chrome.storage.local.set({ [ENTITLEMENT_STORAGE_KEY]: initial });
          return initial;
        }

        const sanitized = sanitizeEntitlement(stored);
        if (JSON.stringify(stored) !== JSON.stringify(sanitized)) {
          await chrome.storage.local.set({ [ENTITLEMENT_STORAGE_KEY]: sanitized });
        }
        return sanitized;
      }
    } catch (err) {
      console.warn("[Fly2Git][Entitlement] Failed to read storage, fallback to default:", err);
    }
    return sanitizeEntitlement(DEFAULT_ENTITLEMENT);
  }

  /**
   * Determines if a platform is authorized to synchronize under the current or provided entitlement.
   *
   * A platform is allowed if and only if:
   * 1. The platform exists in PLATFORM_REGISTRY.
   * 2. The platform is actually active in the extension (active === true).
   * 3. Either:
   *    a) Plan is "pro"
   *    b) Plan is "basic" AND selectedPlatforms contains the normalized platformId.
   */
  async function isPlatformAllowed(platformId, cachedEntitlement) {
    if (!platformId || typeof platformId !== "string") return false;
    const id = platformId.trim().toLowerCase();

    const reg = getRegistry();
    const entry = reg[id];
    if (!entry) return false;

    // Security boundary: inactive platforms can NEVER sync under ANY plan
    if (entry.active !== true) {
      return false;
    }

    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();

    if (ent.plan === "pro") {
      return true;
    }

    if (ent.plan === "basic") {
      return ent.selectedPlatforms.includes(id);
    }

    return false;
  }

  /**
   * Returns list of currently allowed, active platform IDs.
   */
  async function getAllowedPlatforms(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    const reg = getRegistry();
    const activeIds = Object.keys(reg).filter((k) => reg[k].active === true);

    if (ent.plan === "pro") {
      return activeIds;
    }

    return ent.selectedPlatforms.filter((id) => activeIds.includes(id));
  }

  /**
   * Returns the current plan name ("basic" or "pro").
   */
  async function getPlan(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    return ent.plan;
  }

  /**
   * Updates the selected platforms for the BASIC plan.
   * Rejects selections exceeding BASIC_MAX_PLATFORMS (2).
   */
  async function setSelectedPlatforms(platformIds) {
    const current = await getEntitlement();

    if (current.plan === "pro") {
      // Under PRO, all active platforms are allowed, selection is normalized
      const updated = { version: ENTITLEMENT_VERSION, plan: "pro", selectedPlatforms: [] };
      await saveToStorage(updated);
      return { ok: true, entitlement: updated };
    }

    if (!Array.isArray(platformIds)) {
      return { ok: false, error: "INVALID_ARGUMENT", message: "platformIds must be an array" };
    }

    const reg = getRegistry();
    const seen = new Set();
    const valid = [];

    for (let i = 0; i < platformIds.length; i++) {
      const item = platformIds[i];
      if (typeof item !== "string") continue;
      const id = item.trim().toLowerCase();
      if (reg[id] && reg[id].active === true && !seen.has(id)) {
        seen.add(id);
        valid.push(id);
      }
    }

    if (valid.length > BASIC_MAX_PLATFORMS) {
      return {
        ok: false,
        error: "BASIC_LIMIT_EXCEEDED",
        message: "Basic supports any 2 platforms. Upgrade to Pro to use all platforms.",
      };
    }

    const updated = {
      version: ENTITLEMENT_VERSION,
      plan: "basic",
      selectedPlatforms: valid,
    };

    await saveToStorage(updated);
    return { ok: true, entitlement: updated };
  }

  /**
   * Development-only helper to toggle between "basic" and "pro" testing states.
   * Clearly isolated from production subscription logic.
   */
  async function setTestPlan(plan) {
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    if (normalizedPlan !== "basic" && normalizedPlan !== "pro") {
      return { ok: false, error: "INVALID_PLAN", message: "Plan must be 'basic' or 'pro'" };
    }

    const current = await getEntitlement();
    let updated;

    if (normalizedPlan === "pro") {
      updated = {
        version: ENTITLEMENT_VERSION,
        plan: "pro",
        selectedPlatforms: [],
      };
    } else {
      const platforms = (current.selectedPlatforms && current.selectedPlatforms.length > 0)
        ? current.selectedPlatforms.slice(0, BASIC_MAX_PLATFORMS)
        : Array.from(DEFAULT_ENTITLEMENT.selectedPlatforms);

      updated = {
        version: ENTITLEMENT_VERSION,
        plan: "basic",
        selectedPlatforms: platforms,
      };
    }

    await saveToStorage(updated);
    console.log(`[Fly2Git][Entitlement][DEV] Test plan set to '${normalizedPlan}':`, updated);
    return { ok: true, entitlement: updated };
  }

  async function saveToStorage(entitlement) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [ENTITLEMENT_STORAGE_KEY]: entitlement });
    }
  }

  const exportsObj = {
    ENTITLEMENT_STORAGE_KEY: ENTITLEMENT_STORAGE_KEY,
    ENTITLEMENT_VERSION: ENTITLEMENT_VERSION,
    BASIC_MAX_PLATFORMS: BASIC_MAX_PLATFORMS,
    DEFAULT_ENTITLEMENT: DEFAULT_ENTITLEMENT,
    sanitizeEntitlement: sanitizeEntitlement,
    getEntitlement: getEntitlement,
    isPlatformAllowed: isPlatformAllowed,
    getAllowedPlatforms: getAllowedPlatforms,
    getPlan: getPlan,
    setSelectedPlatforms: setSelectedPlatforms,
    setTestPlan: setTestPlan,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitEntitlements = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
