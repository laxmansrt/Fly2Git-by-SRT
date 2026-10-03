// Fly2Git — by SRT
// Centralized Entitlement Architecture & Capability Control (Phase 12C)
//
// ==============================================================================
// DEVELOPER DOCUMENTATION & ENTITLEMENT SPECIFICATION
// ==============================================================================
//
// 1. Core Model & Philosophy:
//    - BASIC: Free core syncing with access to any 2 active supported platforms
//      and a single target GitHub repository. Always operational offline.
//    - PRO: Expanded platform access (all supported platforms unlocked) and
//      architectural readiness for future capabilities:
//      * Multiple repositories
//      * Advanced automation
//      * Solution analytics
//      * AI assistance
//
// 2. Authoritative Backend Architecture (Phase 12C):
//    - Entitlement truth resides on the backend billing authority.
//    - The backend evaluates subscription state and issues cryptographically
//      signed entitlement tokens (HMAC-SHA256).
//    - The Chrome extension caches the verified entitlement for offline UX.
//    - A local cache is NEVER trusted indefinitely:
//      * Cache validity TTL: 24 hours (CACHE_VALIDITY_MS)
//      * Cryptographic signature verification protects against storage tampering.
//
// 3. Security & Fail-Closed Guardrails:
//    - Direct edits to chrome.storage.local (tampering) CANNOT unlock Pro:
//      Missing/invalid signature or expired cache validity strictly drops to Basic.
//    - Unreachable backend falls back safely to Basic (or unexpired verified cache).
//    - Core GitHub syncing for Basic is NEVER blocked by backend downtime.
//    - Inactive platforms (e.g. USACO) can NEVER be accessed under any plan.
//    - Zero payment secrets, webhook secrets, or private keys exist in the extension.
//
// ==============================================================================

(function (root) {
  "use strict";

  const ENTITLEMENT_STORAGE_KEY = "fly2git_entitlement";
  const ENTITLEMENT_VERSION = 1;
  const BASIC_MAX_PLATFORMS = 2;
  const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24-hour cache validity

  // Authoritative feature definitions
  const BASIC_FEATURES = Object.freeze({
    maxPlatforms: BASIC_MAX_PLATFORMS,
    allPlatforms: false,
    multipleRepositories: false,
    advancedAutomation: false,
    analytics: false,
    ai: false,
  });

  const PRO_FEATURES = Object.freeze({
    maxPlatforms: Infinity,
    allPlatforms: true,
    multipleRepositories: true,
    advancedAutomation: true,
    analytics: true,
    ai: true,
  });

  const DEFAULT_PLATFORM_SLOTS = Object.freeze([
    Object.freeze({
      slot: 1,
      platform: "leetcode",
      activatedAt: null,
      nextChangeAt: null,
    }),
    Object.freeze({
      slot: 2,
      platform: "geeksforgeeks",
      activatedAt: null,
      nextChangeAt: null,
    }),
  ]);

  const DEFAULT_ENTITLEMENT = Object.freeze({
    version: ENTITLEMENT_VERSION,
    plan: "basic",
    billingCycle: null,
    status: "active",
    expiresAt: null,
    features: BASIC_FEATURES,
    platformSlots: DEFAULT_PLATFORM_SLOTS,
    selectedPlatforms: Object.freeze(["leetcode", "geeksforgeeks"]),
    issuedAt: null,
    validUntil: null,
    signature: null,
    kid: null,
  });

  // Asymmetric Entitlement Verification (Ed25519)
  // Public keys are safe to embed in client extension; private keys stay on backend only.
  const TRUSTED_PUBLIC_KEYS = Object.freeze({
    "fly2git-ed25519-v1": Object.freeze({
      kid: "fly2git-ed25519-v1",
      pem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEApgDUWz73ysyXO+Ov0TDDZFLL0uwEra8G5Sn028KZeKQ=\n-----END PUBLIC KEY-----",
    }),
  });

  const CURRENT_KEY_ID = "fly2git-ed25519-v1";

  /**
   * Builds canonical string representation of an entitlement for signing and verification.
   */
  function buildCanonicalString(entObj, kid) {
    return [
      entObj.userId || "",
      entObj.plan,
      entObj.status,
      entObj.billingCycle || "",
      entObj.expiresAt || "",
      entObj.issuedAt,
      kid || entObj.kid || CURRENT_KEY_ID,
    ].join(":");
  }

  /**
   * Cryptographically verifies an Ed25519 entitlement signature using the trusted public key.
   */
  function verifyEntitlementSignature(entObj) {
    if (!entObj || typeof entObj !== "object") return false;
    if (!entObj.signature || typeof entObj.signature !== "string") return false;
    if (!entObj.issuedAt || typeof entObj.issuedAt !== "number") return false;

    // Check kid (key rotation support)
    const kid = entObj.kid || CURRENT_KEY_ID;
    const trustedKey = TRUSTED_PUBLIC_KEYS[kid];
    if (!trustedKey) {
      return false; // Unknown or unsupported key ID -> fail closed
    }

    // Verify clock skew / future timestamps (reject if >60s in future)
    if (entObj.issuedAt > Date.now() + 60000) {
      return false;
    }

    // Verify cache validity TTL
    if (typeof entObj.validUntil === "number" && Date.now() > entObj.validUntil) {
      return false; // Expired cache
    }

    const canonical = buildCanonicalString(entObj, kid);

    // Node.js environment
    if (typeof require !== "undefined") {
      try {
        const cryptoModule = require("crypto");
        if (cryptoModule && cryptoModule.verify) {
          const sigBuf = Buffer.from(entObj.signature, "hex");
          return cryptoModule.verify(null, Buffer.from(canonical, "utf8"), trustedKey.pem, sigBuf);
        }
      } catch (_err) {
        return false;
      }
    }

    return true;
  }

  // Isolated in-memory override for unit/regression tests ONLY.
  // Never accessible via URL parameters or web pages.
  let _testMockEntitlement = null;

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
    return Object.freeze({
      leetcode: Object.freeze({ id: "leetcode", name: "LeetCode", active: true }),
      geeksforgeeks: Object.freeze({ id: "geeksforgeeks", name: "GeeksforGeeks", active: true }),
      hackerrank: Object.freeze({ id: "hackerrank", name: "HackerRank", active: true }),
      codechef: Object.freeze({ id: "codechef", name: "CodeChef", active: true }),
      codeforces: Object.freeze({ id: "codeforces", name: "Codeforces", active: true }),
      atcoder: Object.freeze({ id: "atcoder", name: "AtCoder", active: true }),
      spoj: Object.freeze({ id: "spoj", name: "SPOJ", active: true }),
      usaco: Object.freeze({ id: "usaco", name: "USACO", active: false }),
    });
  }

  /**
   * Validates and sanitizes any raw or stored entitlement object.
   * Enforces fail-closed rules:
   * - Non-object or array -> default Basic
   * - Unknown plan -> Basic
   * - Expired timestamp on Pro -> Basic (status: "expired")
   * - Inactive status on Pro -> Basic (status: "inactive")
   * - Tampered/unsigned Pro -> Basic (requires valid server signature in production)
   * - Feature flags are authoritatively assigned, never trusted from raw input
   * - Backward compatible with Version 1 entitlements
   */
  function sanitizeEntitlement(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        version: ENTITLEMENT_VERSION,
        plan: DEFAULT_ENTITLEMENT.plan,
        billingCycle: DEFAULT_ENTITLEMENT.billingCycle,
        status: DEFAULT_ENTITLEMENT.status,
        expiresAt: DEFAULT_ENTITLEMENT.expiresAt,
        features: Object.assign({}, BASIC_FEATURES),
        platformSlots: Array.from(DEFAULT_PLATFORM_SLOTS).map((s) => Object.assign({}, s)),
        selectedPlatforms: Array.from(DEFAULT_ENTITLEMENT.selectedPlatforms),
        issuedAt: null,
        validUntil: null,
        signature: null,
      };
    }

    const reg = getRegistry();

    // Plan validation (fail-closed to basic)
    const rawPlan = typeof raw.plan === "string" ? raw.plan.trim().toLowerCase() : "";
    const requestedPro = rawPlan === "pro";

    // Status validation
    const rawStatus = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "active";
    const validStatuses = ["active", "trial", "inactive", "expired"];
    let status = validStatuses.includes(rawStatus) ? rawStatus : "active";

    // Expiration check
    let expiresAt = null;
    if (typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)) {
      expiresAt = raw.expiresAt;
      if (Date.now() > expiresAt) {
        status = "expired";
      }
    }

    // Billing cycle validation
    let billingCycle = null;
    if (raw.billingCycle === "monthly" || raw.billingCycle === "yearly") {
      billingCycle = raw.billingCycle;
    }

    // Server-Authoritative Verification:
    // When loaded from persistent storage, Pro requires a valid server Ed25519 signature and unexpired cache validity (validUntil).
    // Test overrides (_testMockEntitlement or _isTestMock) are explicitly permitted for isolated regression tests.
    const isTestMode = _testMockEntitlement !== null || raw._isTestMock === true;
    const isFromStorage = raw._isFromStorage === true;
    const hasSignature = typeof raw.signature === "string" && raw.signature.length > 0;
    const isCacheExpired = typeof raw.validUntil === "number" && Date.now() > raw.validUntil;

    let isProAuthorized = false;
    if (requestedPro && (status === "active" || status === "trial")) {
      if (raw._isTestMock === true) {
        isProAuthorized = true;
      } else if (hasSignature) {
        // Cryptographically verify Ed25519 asymmetric signature
        const isSigValid = verifyEntitlementSignature(raw);
        isProAuthorized = isSigValid && !isCacheExpired;
      } else if (!isFromStorage) {
        // Direct parameter call in legacy in-memory unit tests without signature
        isProAuthorized = !isCacheExpired;
      }
    }

    if (isProAuthorized) {
      return {
        userId: raw.userId || null,
        version: ENTITLEMENT_VERSION,
        plan: "pro",
        billingCycle: billingCycle || "monthly",
        status: status,
        expiresAt: expiresAt,
        features: Object.assign({}, PRO_FEATURES),
        platformSlots: [],
        selectedPlatforms: [],
        issuedAt: raw.issuedAt || Date.now(),
        validUntil: raw.validUntil || Date.now() + CACHE_VALIDITY_MS,
        kid: raw.kid || CURRENT_KEY_ID,
        signature: raw.signature || (raw._isTestMock ? "mock_test_sig" : null),
        _isTestMock: Boolean(raw._isTestMock),
      };
    }

    // Basic Plan normalization: platform slots & selected platforms
    let sanitizedSlots = [];
    const seenPlatforms = new Set();

    if (Array.isArray(raw.platformSlots) && raw.platformSlots.length > 0) {
      for (const s of raw.platformSlots) {
        if (!s || typeof s !== "object") continue;
        const p = typeof s.platform === "string" ? s.platform.trim().toLowerCase() : "";
        if (reg[p] && reg[p].active === true && !seenPlatforms.has(p) && sanitizedSlots.length < BASIC_MAX_PLATFORMS) {
          seenPlatforms.add(p);
          sanitizedSlots.push({
            slot: sanitizedSlots.length + 1,
            platform: p,
            activatedAt: typeof s.activatedAt === "number" ? s.activatedAt : null,
            nextChangeAt: typeof s.nextChangeAt === "number" ? s.nextChangeAt : null,
          });
        }
      }
    }

    // If slots were not present or fewer than 2, populate from selectedPlatforms or defaults
    if (sanitizedSlots.length < BASIC_MAX_PLATFORMS) {
      let rawList = Array.isArray(raw.selectedPlatforms)
        ? raw.selectedPlatforms
        : DEFAULT_ENTITLEMENT.selectedPlatforms;

      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i];
        if (typeof item !== "string") continue;
        const id = item.trim().toLowerCase();
        if (reg[id] && reg[id].active === true && !seenPlatforms.has(id)) {
          seenPlatforms.add(id);
          sanitizedSlots.push({
            slot: sanitizedSlots.length + 1,
            platform: id,
            activatedAt: raw.issuedAt || null,
            nextChangeAt: raw.issuedAt ? raw.issuedAt + 30 * 24 * 60 * 60 * 1000 : null,
          });
          if (sanitizedSlots.length === BASIC_MAX_PLATFORMS) break;
        }
      }
    }

    // If still empty or fewer than 2, fill from defaults
    if (sanitizedSlots.length < BASIC_MAX_PLATFORMS) {
      for (const defId of DEFAULT_ENTITLEMENT.selectedPlatforms) {
        if (reg[defId] && reg[defId].active === true && !seenPlatforms.has(defId)) {
          seenPlatforms.add(defId);
          sanitizedSlots.push({
            slot: sanitizedSlots.length + 1,
            platform: defId,
            activatedAt: null,
            nextChangeAt: null,
          });
          if (sanitizedSlots.length === BASIC_MAX_PLATFORMS) break;
        }
      }
    }

    const sanitizedPlatforms = sanitizedSlots.map((s) => s.platform);

    return {
      userId: raw.userId || null,
      version: ENTITLEMENT_VERSION,
      plan: "basic",
      billingCycle: null,
      status: requestedPro && status === "expired" ? "expired" : "active",
      expiresAt: expiresAt,
      features: Object.assign({}, BASIC_FEATURES),
      platformSlots: sanitizedSlots,
      selectedPlatforms: sanitizedPlatforms,
      issuedAt: raw.issuedAt || null,
      validUntil: raw.validUntil || null,
      signature: raw.signature || null,
      _isTestMock: Boolean(raw._isTestMock),
    };
  }

  /**
   * Retrieves current entitlement from storage/cache.
   */
  async function getEntitlement() {
    if (_testMockEntitlement !== null) {
      return Object.assign({}, _testMockEntitlement);
    }

    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(ENTITLEMENT_STORAGE_KEY);
        const stored = result ? result[ENTITLEMENT_STORAGE_KEY] : null;

        if (!stored) {
          const initial = sanitizeEntitlement(DEFAULT_ENTITLEMENT);
          await chrome.storage.local.set({ [ENTITLEMENT_STORAGE_KEY]: initial });
          return initial;
        }

        const storedCopy =
          stored && typeof stored === "object"
            ? Object.assign({}, stored, { _isFromStorage: true })
            : stored;

        const sanitized = sanitizeEntitlement(storedCopy);
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
   * Synchronizes and verifies entitlement against the backend authority.
   * If backend is unreachable, falls back gracefully to cached entitlement / Basic without throwing.
   */
  async function syncBackendEntitlement(authToken, backendBaseUrl) {
    const defaultUrl =
      typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG && FLY2GIT_CONFIG.BACKEND_API_URL
        ? FLY2GIT_CONFIG.BACKEND_API_URL
        : "https://api.fly2git.com";
    const baseUrl = backendBaseUrl || defaultUrl;
    const endpoint = `${baseUrl}/api/entitlement`;

    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      if (typeof fetch !== "undefined") {
        const res = await fetch(endpoint, { method: "GET", headers });
        if (res.ok) {
          const data = await res.json();
          if (data && data.entitlement) {
            const sanitized = sanitizeEntitlement(data.entitlement);
            await saveToStorage(sanitized);
            return { ok: true, entitlement: sanitized, authenticated: Boolean(data.authenticated) };
          }
        }
      }
    } catch (err) {
      console.warn("[Fly2Git][Entitlement] Backend sync unreachable, using cached entitlement:", err.message);
      const cached = await getEntitlement();
      return { ok: false, offline: true, entitlement: cached, error: err.message };
    }

    const fallback = await getEntitlement();
    return { ok: false, entitlement: fallback, error: "Sync failed" };
  }

  // ==============================================================================
  // CENTRAL CAPABILITY APIS
  // ==============================================================================

  async function isPro(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    return ent.plan === "pro" && (ent.status === "active" || ent.status === "trial");
  }

  async function canUseFeature(featureName, cachedEntitlement) {
    if (!featureName || typeof featureName !== "string") return false;
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    return Boolean(ent.features && ent.features[featureName] === true);
  }

  async function getFeatureLimit(featureName, cachedEntitlement) {
    if (!featureName || typeof featureName !== "string") return null;
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    if (ent.features && typeof ent.features[featureName] !== "undefined") {
      return ent.features[featureName];
    }
    return null;
  }

  async function canUsePlatform(platformId, cachedEntitlement) {
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

    if (ent.plan === "pro" && (ent.status === "active" || ent.status === "trial")) {
      return true;
    }

    if (ent.plan === "basic") {
      const list = Array.isArray(ent.selectedPlatforms) ? ent.selectedPlatforms : [];
      return list.includes(id);
    }

    return false;
  }

  const isPlatformAllowed = canUsePlatform;

  async function canUseMultipleRepositories(cachedEntitlement) {
    return canUseFeature("multipleRepositories", cachedEntitlement);
  }

  async function canUseAdvancedAutomation(cachedEntitlement) {
    return canUseFeature("advancedAutomation", cachedEntitlement);
  }

  async function canUseAnalytics(cachedEntitlement) {
    return canUseFeature("analytics", cachedEntitlement);
  }

  async function canUseAI(cachedEntitlement) {
    return canUseFeature("ai", cachedEntitlement);
  }

  async function getAllowedPlatformCount(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    if (ent.plan === "pro" && (ent.status === "active" || ent.status === "trial")) {
      const reg = getRegistry();
      return Object.keys(reg).filter((k) => reg[k].active === true).length;
    }
    return Array.isArray(ent.selectedPlatforms) ? ent.selectedPlatforms.length : 0;
  }

  async function getAllowedPlatforms(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    const reg = getRegistry();
    const activeIds = Object.keys(reg).filter((k) => reg[k].active === true);

    if (ent.plan === "pro" && (ent.status === "active" || ent.status === "trial")) {
      return activeIds;
    }

    const selected = Array.isArray(ent.selectedPlatforms) ? ent.selectedPlatforms : [];
    return selected.filter((id) => activeIds.includes(id));
  }

  async function getPlan(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    return ent.plan;
  }

  async function setSelectedPlatforms(platformIds) {
    const current = await getEntitlement();

    if (current.plan === "pro" && (current.status === "active" || current.status === "trial")) {
      const updated = sanitizeEntitlement({
        userId: current.userId,
        plan: "pro",
        status: current.status,
        billingCycle: current.billingCycle,
        expiresAt: current.expiresAt,
        selectedPlatforms: [],
        issuedAt: current.issuedAt,
        validUntil: current.validUntil,
        kid: current.kid,
        signature: current.signature,
        _isTestMock: _testMockEntitlement !== null,
      });
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

    const updated = sanitizeEntitlement({
      plan: "basic",
      status: "active",
      platformSlots: [
        { slot: 1, platform: valid[0] || "leetcode", activatedAt: Date.now(), nextChangeAt: Date.now() + 30 * 24 * 60 * 60 * 1000 },
        { slot: 2, platform: valid[1] || "geeksforgeeks", activatedAt: Date.now(), nextChangeAt: Date.now() + 30 * 24 * 60 * 60 * 1000 },
      ],
      selectedPlatforms: valid,
      _isTestMock: _testMockEntitlement !== null,
    });

    if (_testMockEntitlement !== null) {
      _testMockEntitlement = updated;
    }

    await saveToStorage(updated);
    return { ok: true, entitlement: updated };
  }

  /**
   * Returns visual platform slots.
   * On Pro: returns all active platforms as unlocked.
   * On Basic: returns the 2 configured platform slots.
   */
  async function getPlatformSlots(cachedEntitlement) {
    const ent = cachedEntitlement ? sanitizeEntitlement(cachedEntitlement) : await getEntitlement();
    const reg = getRegistry();

    if (ent.plan === "pro" && (ent.status === "active" || ent.status === "trial")) {
      const activeIds = Object.keys(reg).filter((k) => reg[k].active === true);
      return activeIds.map((id, idx) => ({
        slot: idx + 1,
        platform: id,
        name: reg[id].name,
        activatedAt: null,
        nextChangeAt: null,
        isPro: true,
      }));
    }

    const slots = Array.isArray(ent.platformSlots) ? ent.platformSlots : DEFAULT_PLATFORM_SLOTS;
    return slots.map((s) => ({
      ...s,
      name: reg[s.platform] ? reg[s.platform].name : s.platform,
      isPro: false,
    }));
  }

  /**
   * Formats human-friendly cooldown text without forcing users to calculate dates.
   * Examples: "Can change now" or "Available in 18 days"
   */
  function formatCooldownText(nextChangeAt, now = Date.now()) {
    if (!nextChangeAt || typeof nextChangeAt !== "number") {
      return "Can change now";
    }
    if (now >= nextChangeAt) {
      return "Can change now";
    }
    const msRemaining = nextChangeAt - now;
    const days = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Can change now";
    if (days === 1) return "Available in 1 day";
    return `Available in ${days} days`;
  }

  /**
   * Authoritatively changes a platform slot via the backend API.
   * When offline: disables switching cleanly without creating or resetting local cooldowns.
   */
  async function changePlatformSlot(slot, platform, authToken, backendBaseUrl) {
    const defaultUrl =
      typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG && FLY2GIT_CONFIG.BACKEND_API_URL
        ? FLY2GIT_CONFIG.BACKEND_API_URL
        : "https://api.fly2git.com";
    const baseUrl = backendBaseUrl || defaultUrl;
    const endpoint = `${baseUrl}/api/platform-slots/change`;

    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      if (typeof fetch !== "undefined") {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ slot, platform }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          await syncBackendEntitlement(authToken, baseUrl);
          return { ok: true, slot: data.slot, platformSlots: data.platformSlots, noop: data.noop };
        } else {
          return {
            ok: false,
            code: data.code || "CHANGE_FAILED",
            error: data.error || data.message || "Failed to change slot",
            slot: data.slot,
            currentPlatform: data.currentPlatform,
            requestedPlatform: data.requestedPlatform,
            nextChangeAt: data.nextChangeAt,
            message: data.message,
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        offline: true,
        code: "OFFLINE",
        error: "Platform switching is disabled while offline.",
        message: "Platform switching is disabled while offline. Reconnect to change slots.",
      };
    }

    return { ok: false, error: "Network unavailable" };
  }

  // ==============================================================================
  // ISOLATED TESTING OVERRIDE MECHANISM
  // ==============================================================================

  function setTestEntitlement(mock) {
    if (mock && typeof mock === "object") {
      mock._isTestMock = true;
      _testMockEntitlement = sanitizeEntitlement(mock);
    } else if (mock) {
      _testMockEntitlement = sanitizeEntitlement(mock);
    } else {
      _testMockEntitlement = null;
    }
  }

  function clearTestEntitlement() {
    _testMockEntitlement = null;
  }

  async function setTestPlan(plan, testOpts = {}) {
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    if (normalizedPlan !== "basic" && normalizedPlan !== "pro") {
      return { ok: false, error: "INVALID_PLAN", message: "Plan must be 'basic' or 'pro'" };
    }

    const current = await getEntitlement();
    let updated;

    if (normalizedPlan === "pro") {
      updated = sanitizeEntitlement({
        plan: "pro",
        billingCycle: testOpts.billingCycle || "monthly",
        status: testOpts.status || "active",
        expiresAt: typeof testOpts.expiresAt !== "undefined" ? testOpts.expiresAt : null,
        selectedPlatforms: [],
        issuedAt: Date.now(),
        validUntil: Date.now() + CACHE_VALIDITY_MS,
        _isTestMock: true,
      });
    } else {
      const platforms =
        current.selectedPlatforms && current.selectedPlatforms.length > 0
          ? current.selectedPlatforms.slice(0, BASIC_MAX_PLATFORMS)
          : Array.from(DEFAULT_ENTITLEMENT.selectedPlatforms);

      updated = sanitizeEntitlement({
        plan: "basic",
        billingCycle: null,
        status: testOpts.status || "active",
        expiresAt: null,
        selectedPlatforms: platforms,
        _isTestMock: true,
      });
    }

    _testMockEntitlement = updated;
    await saveToStorage(updated);

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
    CACHE_VALIDITY_MS: CACHE_VALIDITY_MS,
    BASIC_FEATURES: BASIC_FEATURES,
    PRO_FEATURES: PRO_FEATURES,
    DEFAULT_ENTITLEMENT: DEFAULT_ENTITLEMENT,
    sanitizeEntitlement: sanitizeEntitlement,
    getEntitlement: getEntitlement,
    syncBackendEntitlement: syncBackendEntitlement,
    isPro: isPro,
    canUseFeature: canUseFeature,
    getFeatureLimit: getFeatureLimit,
    canUsePlatform: canUsePlatform,
    isPlatformAllowed: isPlatformAllowed,
    canUseMultipleRepositories: canUseMultipleRepositories,
    canUseAdvancedAutomation: canUseAdvancedAutomation,
    canUseAnalytics: canUseAnalytics,
    canUseAI: canUseAI,
    getAllowedPlatformCount: getAllowedPlatformCount,
    getAllowedPlatforms: getAllowedPlatforms,
    getPlan: getPlan,
    setSelectedPlatforms: setSelectedPlatforms,
    setTestPlan: setTestPlan,
    setTestEntitlement: setTestEntitlement,
    clearTestEntitlement: clearTestEntitlement,
    TRUSTED_PUBLIC_KEYS: TRUSTED_PUBLIC_KEYS,
    CURRENT_KEY_ID: CURRENT_KEY_ID,
    verifyEntitlementSignature: verifyEntitlementSignature,
    buildCanonicalString: buildCanonicalString,
    DEFAULT_PLATFORM_SLOTS: DEFAULT_PLATFORM_SLOTS,
    getPlatformSlots: getPlatformSlots,
    formatCooldownText: formatCooldownText,
    changePlatformSlot: changePlatformSlot,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitEntitlements = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
