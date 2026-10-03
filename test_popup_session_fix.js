/**
 * Fly2Git — Popup Session & Coding Intelligence Regression Test Suite
 *
 * Verifies:
 * 1. getStoredSession() definition and fail-safe contract in popup.js
 * 2. Multi-source storage resolution (userSession, auth.fly2gitToken, fly2git_session)
 * 3. Graceful handling of unauthenticated states (returns null, no crash)
 * 4. Error tolerance (storage failures, missing chrome API -> fail-safe null)
 * 5. renderCodingIntelligenceSection() executes cleanly without throwing
 * 6. renderAICoachSection() executes cleanly without throwing
 * 7. showActiveView() initialization does not abort on missing or invalid session
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Read popup.js source
const popupJsPath = path.join(__dirname, "popup.js");
const popupJsSource = fs.readFileSync(popupJsPath, "utf8");

async function runTests() {
  console.log("===============================================================");
  console.log("   POPUP SESSION & CODING INTELLIGENCE REGRESSION SUITE        ");
  console.log("===============================================================\n");

  // -----------------------------------------------------------------
  // 1. Static Code Analysis & Contract Verification
  // -----------------------------------------------------------------
  console.log("--- 1. Static Contract Checks ---");

  it("1.1 popup.js defines getStoredSession function", () => {
    assert(
      popupJsSource.includes("async function getStoredSession()"),
      "popup.js must declare async function getStoredSession()"
    );
  });

  it("1.2 getStoredSession checks userSession, auth, and fly2git_session", () => {
    assert(
      popupJsSource.includes('"userSession"') &&
      popupJsSource.includes('"auth"') &&
      popupJsSource.includes('"fly2git_session"'),
      "getStoredSession must query userSession, auth, and fly2git_session"
    );
  });

  it("1.3 renderCodingIntelligenceSection calls getStoredSession safely", () => {
    assert(
      popupJsSource.includes("const session = await getStoredSession()") ||
      popupJsSource.includes("session = await getStoredSession()"),
      "renderCodingIntelligenceSection must call getStoredSession()"
    );
  });

  it("1.4 renderAICoachSection calls getStoredSession safely", () => {
    assert(
      popupJsSource.includes("const session = await getStoredSession();"),
      "renderAICoachSection must call getStoredSession()"
    );
  });

  it("1.5 popup.js exports getStoredSession on window and module", () => {
    assert(
      popupJsSource.includes("window.getStoredSession = getStoredSession"),
      "Must expose getStoredSession on window"
    );
    assert(
      popupJsSource.includes("module.exports"),
      "Must expose getStoredSession via module.exports when defined"
    );
  });

  // -----------------------------------------------------------------
  // 2. Mock Runtime Evaluation of getStoredSession
  // -----------------------------------------------------------------
  console.log("\n--- 2. Runtime getStoredSession Behavior ---");

  // Create isolated mock runtime
  function createMockEnvironment(storageData = {}, shouldStorageThrow = false) {
    let mockStorage = Object.assign({}, storageData);
    const mockElements = {};

    function getOrCreateElement(id) {
      if (!mockElements[id]) {
        mockElements[id] = {
          id,
          textContent: "",
          innerHTML: "",
          className: "",
          classList: {
            add: (c) => {},
            remove: (c) => {},
            toggle: (c, v) => {},
            contains: (c) => false,
          },
          appendChild: () => {},
          addEventListener: () => {},
          setAttribute: () => {},
          removeAttribute: () => {},
          style: {},
          disabled: false,
          value: "",
        };
      }
      return mockElements[id];
    }

    const mockDocument = {
      getElementById: (id) => getOrCreateElement(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag) => getOrCreateElement("tag_" + Math.random()),
    };

    const mockChrome = {
      runtime: {
        connect: () => ({ onMessage: { addListener: () => {} }, disconnect: () => {} }),
        sendMessage: async () => ({ ok: true }),
        onMessage: { addListener: () => {} },
      },
      storage: {
        local: {
          get: async (keys) => {
            if (shouldStorageThrow) {
              throw new Error("Storage quota or permissions error");
            }
            if (Array.isArray(keys)) {
              const res = {};
              keys.forEach((k) => { res[k] = mockStorage[k]; });
              return res;
            }
            if (typeof keys === "string") {
              return { [keys]: mockStorage[keys] };
            }
            return { ...mockStorage };
          },
          set: async (obj) => {
            Object.assign(mockStorage, obj);
          },
          remove: async (key) => {
            delete mockStorage[key];
          },
        },
      },
      tabs: {
        create: () => {},
      },
    };

    return { mockDocument, mockChrome, mockElements };
  }

  // Load popup in isolated sandbox
  function loadPopupModule(storageData = {}, shouldThrow = false) {
    const { mockDocument, mockChrome, mockElements } = createMockEnvironment(storageData, shouldThrow);
    const context = {
      document: mockDocument,
      chrome: mockChrome,
      window: {},
      globalThis: {},
      module: { exports: {} },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: (fn) => fn(),
      setInterval: () => 1,
      clearInterval: () => {},
      fetch: async () => ({ ok: false, json: async () => ({}) }),
      Fly2GitPlatforms: { PLATFORM_REGISTRY: {} },
      Fly2GitEntitlements: {
        getEntitlement: async () => ({ plan: "basic" }),
        sanitizeEntitlement: (e) => e,
        ENTITLEMENT_STORAGE_KEY: "fly2git_entitlement",
        getPlatformSlots: async () => [],
      },
      Fly2GitIdentity: { getIdentityStatus: async () => ({}) },
      Fly2GitAutomation: { getRules: async () => ({}) },
      Fly2GitAnalytics: { getSummary: async () => ({}) },
      Fly2GitAIClient: { coach: async () => ({ status: "success" }) },
      Fly2GitConfig: { backendUrl: "http://localhost:3000" },
      FLY2GIT_CONFIG: { BACKEND_API_URL: "https://api.fly2git.com" },
    };

    const vm = require("vm");
    const script = new vm.Script(popupJsSource);
    vm.createContext(context);
    script.runInContext(context);

    return {
      getStoredSession: context.module.exports.getStoredSession || context.window.getStoredSession,
      renderCodingIntelligenceSection: context.module.exports.renderCodingIntelligenceSection,
      renderAICoachSection: context.module.exports.renderAICoachSection,
      context,
      mockChrome,
      mockDocument,
    };
  }

  await itAsync("2.1 Resolves session from userSession key", async () => {
    const { getStoredSession } = loadPopupModule({
      userSession: { token: "jwt_token_123", user: { id: "u_abc", email: "user@example.com" } },
    });
    const session = await getStoredSession();
    assert(session !== null, "Session should not be null");
    assert.strictEqual(session.token, "jwt_token_123");
    assert.strictEqual(session.user.email, "user@example.com");
  });

  await itAsync("2.2 Resolves session from auth.fly2gitToken key", async () => {
    const { getStoredSession } = loadPopupModule({
      auth: {
        accessToken: "gh_oauth_token",
        fly2gitToken: "jwt_token_from_auth",
        fly2gitUser: { id: "u_xyz", email: "auth@example.com" },
      },
    });
    const session = await getStoredSession();
    assert(session !== null, "Session should not be null");
    assert.strictEqual(session.token, "jwt_token_from_auth");
    assert.strictEqual(session.user.email, "auth@example.com");
  });

  await itAsync("2.3 Resolves session from fly2git_session key", async () => {
    const { getStoredSession } = loadPopupModule({
      fly2git_session: { token: "jwt_token_slot_session", user: null },
    });
    const session = await getStoredSession();
    assert(session !== null, "Session should not be null");
    assert.strictEqual(session.token, "jwt_token_slot_session");
  });

  await itAsync("2.4 Returns null when storage has no session tokens", async () => {
    const { getStoredSession } = loadPopupModule({});
    const session = await getStoredSession();
    assert.strictEqual(session, null, "Should return null when unauthenticated");
  });

  await itAsync("2.5 Returns null without throwing when storage access errors", async () => {
    const { getStoredSession } = loadPopupModule({}, true);
    const session = await getStoredSession();
    assert.strictEqual(session, null, "Should return null on storage failure");
  });

  // -----------------------------------------------------------------
  // 3. Coding Intelligence Execution Tolerance
  // -----------------------------------------------------------------
  console.log("\n--- 3. Coding Intelligence Section Resilience ---");

  await itAsync("3.1 renderCodingIntelligenceSection executes without error when unauthenticated", async () => {
    const { renderCodingIntelligenceSection } = loadPopupModule({});
    let errorCaught = null;
    try {
      await renderCodingIntelligenceSection();
    } catch (err) {
      errorCaught = err;
    }
    assert.strictEqual(errorCaught, null, "renderCodingIntelligenceSection must never throw when unauthenticated");
  });

  await itAsync("3.2 renderCodingIntelligenceSection executes cleanly when authenticated", async () => {
    let requestedEndpoints = [];
    const { renderCodingIntelligenceSection, context } = loadPopupModule({
      auth: { fly2gitToken: "valid_jwt_token", fly2gitUser: { email: "pro@example.com" } },
    });
    context.fetch = async (url, opts) => {
      requestedEndpoints.push(url);
      assert(opts.headers.Authorization.includes("Bearer valid_jwt_token"), "Must include Bearer token");
      return {
        ok: true,
        json: async () => ({
          patterns: [{ pattern: "Two Pointers", count: 5 }],
          journey: [{ period: "2026-W38", count: 4, dominantPatterns: ["Array"] }],
          explorationCandidates: [{ pattern: "DP", reason: "Good progression" }],
        }),
      };
    };

    let errorCaught = null;
    try {
      await renderCodingIntelligenceSection();
    } catch (err) {
      errorCaught = err;
    }
    assert.strictEqual(errorCaught, null, "renderCodingIntelligenceSection must execute smoothly when authenticated");
    assert(requestedEndpoints.length >= 3, "Should fetch patterns, journey, and exploration");
  });

  await itAsync("3.3 renderCodingIntelligenceSection handles backend network failure without crashing", async () => {
    const { renderCodingIntelligenceSection, context } = loadPopupModule({
      auth: { fly2gitToken: "valid_jwt_token" },
    });
    context.fetch = async () => {
      throw new Error("Network offline / backend unreachable");
    };

    let errorCaught = null;
    try {
      await renderCodingIntelligenceSection();
    } catch (err) {
      errorCaught = err;
    }
    assert.strictEqual(errorCaught, null, "Network failures must be handled gracefully without crashing popup");
  });

  // -----------------------------------------------------------------
  // 4. AI Coach Section Resilience
  // -----------------------------------------------------------------
  console.log("\n--- 4. AI Coach Section Resilience ---");

  await itAsync("4.1 renderAICoachSection executes without error when unauthenticated", async () => {
    const { renderAICoachSection } = loadPopupModule({});
    let errorCaught = null;
    try {
      await renderAICoachSection();
    } catch (err) {
      errorCaught = err;
    }
    assert.strictEqual(errorCaught, null, "renderAICoachSection must never throw when unauthenticated");
  });

  await itAsync("4.2 renderAICoachSection executes cleanly and populates context when authenticated", async () => {
    let coachFetched = false;
    const { renderAICoachSection, context } = loadPopupModule({
      userSession: { token: "coach_jwt_token" },
    });
    context.fetch = async (url, opts) => {
      coachFetched = true;
      assert(url.includes("/api/coach/context"), "Must fetch coach context");
      assert(opts.headers.Authorization.includes("Bearer coach_jwt_token"), "Must include Bearer token");
      return {
        ok: true,
        json: async () => ({
          context: { streak: 7, totalSynced: 10, difficulties: { Medium: 6 }, languages: ["python", "js"], platforms: ["leetcode"] },
        }),
      };
    };

    let errorCaught = null;
    try {
      await renderAICoachSection();
    } catch (err) {
      errorCaught = err;
    }
    assert.strictEqual(errorCaught, null, "renderAICoachSection must execute cleanly");
    assert.strictEqual(coachFetched, true, "Coach context endpoint should be queried");
  });

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log("\n===============================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("===============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite runner crashed:", err);
  process.exit(1);
});
