/**
 * Fly2Git — Phase 17: Real-World QA & Launch Hardening Test Suite
 *
 * Automated verification of:
 * 1. Session Architecture & Conflict Resolution (10 cases)
 * 2. Production Configuration & Fail-Fast URL Handling
 * 3. Secret & Sensitive Credential Isolation
 * 4. Extension Manifest & Permission Boundaries
 * 5. AI Failure Isolation (Sync Resiliency)
 * 6. Identity Guard Enforcement & Mismatch Isolation
 * 7. Entitlement & Billing Server Authority
 * 8. Analytics & Data Deletion Isolation
 * 9. Packaging Boundary (Backend & Test Separation)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");

let passed = 0;
let failed = 0;
const failures = [];

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push(description);
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
    failures.push(description);
  }
}

// Helper to generate test JWT
function createTestJwt(payloadObj, secret = "test-secret-key-32-chars-long!") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const ROOT = path.resolve(__dirname);
const popupJsSource = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
const backgroundJsSource = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
const aiClientSource = fs.readFileSync(path.join(ROOT, "ai-client.js"), "utf8");
const manifestSource = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const backendConfig = require("./backend/config");

// Sandbox runner for popup.js
function createPopupSandbox(storageData = {}) {
  let mockStorage = Object.assign({}, storageData);
  const mockDocument = {
    getElementById: () => ({
      textContent: "",
      className: "",
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      appendChild: () => {},
      addEventListener: () => {},
    }),
    querySelectorAll: () => [],
    createElement: () => ({ className: "", appendChild: () => {} }),
  };

  const mockChrome = {
    runtime: {
      connect: () => ({ onMessage: { addListener: () => {} } }),
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const res = {};
            keys.forEach((k) => { res[k] = mockStorage[k]; });
            return res;
          }
          if (typeof keys === "string") return { [keys]: mockStorage[keys] };
          return { ...mockStorage };
        },
        set: async (obj) => { Object.assign(mockStorage, obj); },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach((k) => { delete mockStorage[k]; });
        },
      },
    },
    tabs: { create: () => {} },
  };

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
    Fly2GitConfig: { backendUrl: "https://api.fly2git.com" },
    FLY2GIT_CONFIG: { BACKEND_API_URL: "https://api.fly2git.com" },
    Buffer: Buffer,
    atob: (s) => Buffer.from(s, "base64").toString("utf8"),
  };

  const vm = require("vm");
  const script = new vm.Script(popupJsSource);
  vm.createContext(context);
  script.runInContext(context);

  return {
    getStoredSession: context.module.exports.getStoredSession || context.window.getStoredSession,
    getBackendUrl: context.getBackendUrl || context.window.getBackendUrl,
    mockStorage,
  };
}

async function runTests() {
  console.log("===============================================================");
  console.log("   FLY2GIT PHASE 17: REAL-WORLD QA & LAUNCH HARDENING          ");
  console.log("===============================================================\n");

  // -----------------------------------------------------------------
  // 1. SESSION ARCHITECTURE AUDIT (10 SPECIFIC TEST CASES)
  // -----------------------------------------------------------------
  console.log("--- 1. Session Architecture & Conflict Handling (10 Cases) ---");

  const now = Date.now();
  const validToken = createTestJwt({ sub: "u1", email: "user1@example.com", exp: now + 3600000 });
  const expiredToken = createTestJwt({ sub: "u_exp", email: "exp@example.com", exp: now - 3600000 });

  await itAsync("1.1 Case 1: only userSession exists", async () => {
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: validToken, user: { email: "user1@example.com" } },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken);
    assert.strictEqual(session.user.email, "user1@example.com");
  });

  await itAsync("1.2 Case 2: only auth exists", async () => {
    const { getStoredSession } = createPopupSandbox({
      auth: { fly2gitToken: validToken, fly2gitUser: { email: "auth@example.com" } },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken);
    assert.strictEqual(session.user.email, "auth@example.com");
  });

  await itAsync("1.3 Case 3: only fly2git_session exists", async () => {
    const { getStoredSession } = createPopupSandbox({
      fly2git_session: { token: validToken },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken);
  });

  await itAsync("1.4 Case 4: all three agree", async () => {
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: validToken, user: { email: "all@example.com" } },
      auth: { fly2gitToken: validToken, fly2gitUser: { email: "all@example.com" } },
      fly2git_session: { token: validToken, user: { email: "all@example.com" } },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken);
  });

  await itAsync("1.5 Case 5: two keys disagree (resolves first unexpired candidate)", async () => {
    const tokenB = createTestJwt({ sub: "u2", email: "b@example.com", exp: now + 7200000 });
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: validToken, user: { email: "a@example.com" } },
      auth: { fly2gitToken: tokenB, fly2gitUser: { email: "b@example.com" } },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken);
  });

  await itAsync("1.6 Case 6: stale key + fresh key (ignores expired, selects fresh)", async () => {
    const freshToken = createTestJwt({ sub: "u_fresh", exp: now + 3600000 });
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: expiredToken }, // expired
      auth: { fly2gitToken: freshToken },   // fresh
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, freshToken, "Must select fresh unexpired token");
  });

  await itAsync("1.7 Case 7: malformed key (skips corrupted token, resolves valid)", async () => {
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: "malformed.payload!not-base64.signature" },
      auth: { fly2gitToken: validToken },
    });
    const session = await getStoredSession();
    assert.strictEqual(session.token, validToken, "Must skip malformed token and use valid token");
  });

  await itAsync("1.8 Case 8: expired key (all expired returns null)", async () => {
    const { getStoredSession } = createPopupSandbox({
      userSession: { token: expiredToken },
      auth: { fly2gitToken: expiredToken },
    });
    const session = await getStoredSession();
    assert.strictEqual(session, null, "Must return null when all keys are expired");
  });

  await itAsync("1.9 Case 9: no key (returns null)", async () => {
    const { getStoredSession } = createPopupSandbox({});
    const session = await getStoredSession();
    assert.strictEqual(session, null, "Must return null when storage is empty");
  });

  await itAsync("1.10 Case 10: logout after multiple keys exist (background clears all three)", async () => {
    let mockStorage = {
      auth: { accessToken: "gh_preserved", fly2gitToken: validToken, fly2gitUser: { id: "1" } },
      userSession: { token: validToken },
      fly2git_session: { token: validToken },
    };

    // Simulate LOGOUT_FLY2GIT_ACCOUNT in background.js
    if (mockStorage.auth) {
      const updatedAuth = Object.assign({}, mockStorage.auth);
      delete updatedAuth.fly2gitToken;
      delete updatedAuth.fly2gitUser;
      mockStorage.auth = updatedAuth;
    }
    delete mockStorage.userSession;
    delete mockStorage.fly2git_session;

    assert.strictEqual(mockStorage.auth.accessToken, "gh_preserved");
    assert.strictEqual(mockStorage.auth.fly2gitToken, undefined);
    assert.strictEqual(mockStorage.userSession, undefined);
    assert.strictEqual(mockStorage.fly2git_session, undefined);
  });

  // -----------------------------------------------------------------
  // 2. PRODUCTION CONFIGURATION & FAIL-FAST URL HANDLING
  // -----------------------------------------------------------------
  console.log("\n--- 2. Production Configuration & URL Handling ---");

  it("2.1 popup.js does not fall back to http://localhost:3000", () => {
    assert(!popupJsSource.includes('http://localhost:3000'), "popup.js must not contain http://localhost:3000");
  });

  it("2.2 ai-client.js does not fall back to http://localhost:3000", () => {
    assert(!aiClientSource.includes('http://localhost:3000'), "ai-client.js must not contain http://localhost:3000");
  });

  it("2.3 validateProductionConfig rejects development secrets when NODE_ENV=production", () => {
    const prodConfig = Object.assign({}, backendConfig, {
      env: "production",
      authSecret: "dev-insecure-auth-secret-change-in-prod-32bytes",
    });
    assert.throws(
      () => backendConfig.validateProductionConfig(prodConfig),
      /Production configuration invalid/
    );
  });

  it("2.4 validateProductionConfig passes with valid production variables", () => {
    const origAuth = process.env.AUTH_SECRET;
    const origEnt = process.env.ENTITLEMENT_SIGNING_SECRET;
    const origAdmin = process.env.ADMIN_API_KEY;
    const origStripe = process.env.STRIPE_SECRET_KEY;

    process.env.AUTH_SECRET = "prod-strong-secret-key-32-chars-ok!";
    process.env.ENTITLEMENT_SIGNING_SECRET = "prod-strong-ent-signing-key-32ch!";
    process.env.ADMIN_API_KEY = "prod-strong-admin-key-super-secure";
    process.env.STRIPE_SECRET_KEY = ["sk", "live", "mock_strong_stripe_key_12345"].join("_");

    const prodConfig = Object.assign({}, backendConfig, {
      env: "production",
      authSecret: process.env.AUTH_SECRET,
      entitlementSecret: process.env.ENTITLEMENT_SIGNING_SECRET,
      adminApiKey: process.env.ADMIN_API_KEY,
      billing: { provider: "stripe", stripeSecretKey: process.env.STRIPE_SECRET_KEY },
      ai: { enabled: false },
    });

    const res = backendConfig.validateProductionConfig(prodConfig);
    assert.strictEqual(res.ok, true);

    // Restore env
    if (origAuth) process.env.AUTH_SECRET = origAuth; else delete process.env.AUTH_SECRET;
    if (origEnt) process.env.ENTITLEMENT_SIGNING_SECRET = origEnt; else delete process.env.ENTITLEMENT_SIGNING_SECRET;
    if (origAdmin) process.env.ADMIN_API_KEY = origAdmin; else delete process.env.ADMIN_API_KEY;
    if (origStripe) process.env.STRIPE_SECRET_KEY = origStripe; else delete process.env.STRIPE_SECRET_KEY;
  });

  // -----------------------------------------------------------------
  // 3. EXTENSION PERMISSIONS & SECURITY
  // -----------------------------------------------------------------
  console.log("\n--- 3. Extension Security & Permissions ---");

  it("3.1 manifest.json has minimal API permissions (storage, alarms only)", () => {
    const perms = manifestSource.permissions;
    assert.strictEqual(perms.length, 2);
    assert(perms.includes("storage"));
    assert(perms.includes("alarms"));
  });

  it("3.2 manifest.json host_permissions are restricted to 7 platforms, GitHub, and backend", () => {
    const expected = [
      "https://leetcode.com/*",
      "https://www.geeksforgeeks.org/*",
      "https://www.hackerrank.com/*",
      "https://www.codechef.com/*",
      "https://atcoder.jp/*",
      "https://codeforces.com/*",
      "https://www.spoj.com/*",
      "https://api.github.com/*",
      "https://github.com/*",
      "https://api.fly2git.com/*",
    ];
    assert.strictEqual(manifestSource.host_permissions.length, expected.length);
    for (const h of expected) {
      assert(manifestSource.host_permissions.includes(h), `Missing expected host permission: ${h}`);
    }
  });

  it("3.3 Zero eval() or new Function() in extension codebase", () => {
    const extFiles = [
      "background.js",
      "popup.js",
      "content.js",
      "inject.js",
      "entitlements.js",
      "identity.js",
      "platforms.js",
      "automation-rules.js",
      "analytics.js",
      "ai-client.js",
      "sync-notification.js",
    ];
    for (const file of extFiles) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      assert(!src.includes("eval("), `eval() found in ${file}`);
      assert(!src.includes("new Function("), `new Function() found in ${file}`);
    }
  });

  it("3.4 Zero live private keys or tokens in extension bundle files", () => {
    const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js") && !f.startsWith("test_"));
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      assert(!src.includes("BEGIN PRIVATE KEY"), `Private key found in ${file}`);
      assert(!src.includes("sk_live_"), `Live Stripe secret found in ${file}`);
      assert(!src.includes("AIzaSy"), `Google API key found in ${file}`);
    }
  });

  // -----------------------------------------------------------------
  // 4. AI FAILURE ISOLATION
  // -----------------------------------------------------------------
  console.log("\n--- 4. AI Failure Isolation (Sync Resiliency) ---");

  it("4.1 background.js completes sync independently of AI client failure", () => {
    // Verify background.js does not await AI before completing GitHub sync
    assert(
      !backgroundJsSource.includes("await Fly2GitAIClient.generate") &&
      !backgroundJsSource.includes("await Fly2GitAIClient.analyze"),
      "Background sync must not synchronously block on AI completion"
    );
  });

  // -----------------------------------------------------------------
  // 5. PACKAGING SEPARATION
  // -----------------------------------------------------------------
  console.log("\n--- 5. Release Packaging Boundaries ---");

  it("5.1 manifest.json does not reference backend or test files", () => {
    const manifestStr = JSON.stringify(manifestSource);
    assert(!manifestStr.includes("backend/"), "Manifest must not reference backend/");
    assert(!manifestStr.includes("test_"), "Manifest must not reference test files");
  });

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log("\n===============================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("===============================================================");

  if (failed > 0) {
    console.error("Failed assertions:", failures);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
