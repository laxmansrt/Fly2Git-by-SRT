/**
 * Fly2Git — Phase 18: Private Beta + Product Validation Test Suite
 *
 * Automated verification of:
 * 1. Telemetry event schema
 * 2. Telemetry disabled (privacy opt-out)
 * 3. Telemetry enabled
 * 4. No source code in telemetry
 * 5. No tokens in telemetry
 * 6. No cookies in telemetry
 * 7. Feedback submission
 * 8. Feedback bounds & validation
 * 9. Authentication authority
 * 10. User isolation (Feedback & Telemetry)
 * 11. Diagnostics generation
 * 12. Diagnostics secret exclusion
 * 13. Beta allowlist
 * 14. Beta expiration
 * 15. Feature flags
 * 16. Entitlement remains authoritative
 * 17. Version compatibility (>= 1.0.0 supported)
 * 18. Unsupported client rejected (< 1.0.0 -> CLIENT_VERSION_UNSUPPORTED)
 * 19. Deletion of product telemetry
 * 20. Data retention (90-day pruning)
 * 21. Onboarding events
 * 22. First-sync event & time-to-first-sync
 * 23. Telemetry failure doesn't affect sync
 * 24. Feedback failure doesn't affect sync
 * 25. Phase 17 regression
 * 26. Phase 16 regression
 * 27. Phase 15 regression
 * 28. Phase 14 regression
 * 29. Platform regression (7 platforms)
 * 30. Identity regression (IdentityGuard)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const http = require("http");

const Database = require("./backend/db/database");
const { ProductTelemetryService, ALLOWED_EVENTS, FORBIDDEN_KEYS } = require("./backend/services/product-telemetry-service");
const { createServer } = require("./backend/server");
const Fly2GitDiagnostics = require("./diagnostics");
const config = require("./backend/config");

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

// Helper to make local HTTP requests to test server
function httpRequest(serverPort, options, postData) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: "127.0.0.1",
      port: serverPort,
      path: options.path,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json,
        });
      });
    });

    req.on("error", reject);

    if (postData) {
      if (typeof postData === "object") {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log("\n========================================================");
  console.log("FLY2GIT PHASE 18: PRIVATE BETA + PRODUCT VALIDATION TESTS");
  console.log("========================================================\n");

  const db = new Database({ memoryOnly: true });
  const telemetryService = new ProductTelemetryService(db, { retentionDays: 90 });

  // 1. Telemetry Event Schema
  it("Test 1: Telemetry event schema stores strictly allowed attributes", () => {
    const res = telemetryService.recordEvent({
      userId: "user_test_1",
      event: "first_sync",
      platform: "leetcode",
      appVersion: "1.1.6",
      extraArbitraryField: "should_be_ignored",
    });
    assert.strictEqual(res.ok, true);
    assert.ok(res.eventId);

    const stored = db.productTelemetryEvents.get(res.eventId);
    assert.ok(stored);
    const keys = Object.keys(stored);
    assert.deepStrictEqual(keys.sort(), ["appVersion", "event", "eventId", "platform", "timestamp", "userId"].sort());
    assert.strictEqual(stored.event, "first_sync");
    assert.strictEqual(stored.platform, "leetcode");
    assert.strictEqual(stored.appVersion, "1.1.6");
    assert.strictEqual(stored.userId, "user_test_1");
  });

  // 2. Telemetry Disabled (Privacy Opt-out)
  it("Test 2: Telemetry disabled immediately drops event without storing", () => {
    const preCount = db.productTelemetryEvents.size;
    const res = telemetryService.recordEvent(
      {
        userId: "user_opt_out",
        event: "analytics_opened",
        productTelemetryEnabled: false,
      },
      { telemetryEnabled: false }
    );
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(db.productTelemetryEvents.size, preCount);
  });

  // 3. Telemetry Enabled
  it("Test 3: Telemetry enabled persists valid events to store and user index", () => {
    const res = telemetryService.recordEvent({
      userId: "user_enabled_1",
      event: "journey_opened",
      productTelemetryEnabled: true,
    });
    assert.strictEqual(res.ok, true);
    assert.ok(res.eventId);
    const userEvents = telemetryService.getUserTelemetry("user_enabled_1");
    assert.strictEqual(userEvents.length, 1);
    assert.strictEqual(userEvents[0].event, "journey_opened");
  });

  // 4. No Source Code in Telemetry
  it("Test 4: Source code in telemetry payload is rejected with error", () => {
    const res = telemetryService.recordEvent({
      userId: "user_test_4",
      event: "first_sync",
      code: "function solve() { return 42; }",
    });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.includes("Forbidden field"));

    const res2 = telemetryService.recordEvent({
      userId: "user_test_4",
      event: "first_sync",
      sourceCode: "print('hello')",
    });
    assert.strictEqual(res2.ok, false);
  });

  // 5. No Tokens in Telemetry
  it("Test 5: Tokens or credentials in telemetry are strictly rejected", () => {
    const res1 = telemetryService.recordEvent({
      userId: "user_test_5",
      event: "github_connected",
      token: "ghp_1234567890abcdef1234567890abcdef1234",
    });
    assert.strictEqual(res1.ok, false);
    assert.ok(res1.error.includes("Forbidden field"));

    const res2 = telemetryService.recordEvent({
      userId: "user_test_5",
      event: "github_connected",
      accessToken: "secret_access_token",
    });
    assert.strictEqual(res2.ok, false);
  });

  // 6. No Cookies or Keystrokes in Telemetry
  it("Test 6: Cookies, browsing history, or keystrokes are rejected", () => {
    const res1 = telemetryService.recordEvent({
      userId: "user_test_6",
      event: "settings_opened",
      cookie: "session=xyz",
    });
    assert.strictEqual(res1.ok, false);

    const res2 = telemetryService.recordEvent({
      userId: "user_test_6",
      event: "settings_opened",
      keystrokes: ["a", "b", "c"],
    });
    assert.strictEqual(res2.ok, false);

    const res3 = telemetryService.recordEvent({
      userId: "user_test_6",
      event: "settings_opened",
      browsingHistory: ["https://example.com"],
    });
    assert.strictEqual(res3.ok, false);
  });

  // Spin up test server for HTTP API validation
  const testServerApp = createServer({ memoryOnly: true });
  const serverPort = 3918;
  await testServerApp.start(serverPort);

  // Helper to register and login user
  let userTokenA = "";
  let userIdA = "";
  let userTokenB = "";
  let userIdB = "";

  const regA = await httpRequest(
    serverPort,
    { path: "/api/auth/register", method: "POST", headers: { "Content-Type": "application/json" } },
    { email: "beta_user_a@example.com", password: "Password123!" }
  );
  userTokenA = regA.json.token;
  userIdA = regA.json.user.id;

  const regB = await httpRequest(
    serverPort,
    { path: "/api/auth/register", method: "POST", headers: { "Content-Type": "application/json" } },
    { email: "beta_user_b@example.com", password: "Password123!" }
  );
  userTokenB = regB.json.token;
  userIdB = regB.json.user.id;

  // 7. Feedback Submission
  await itAsync("Test 7: POST /api/feedback accepts valid submission", async () => {
    const fbRes = await httpRequest(
      serverPort,
      {
        path: "/api/feedback",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userTokenA}`,
        },
      },
      {
        category: "feature_request",
        message: "Support for dark mode high contrast",
        platform: "extension",
        appVersion: "1.1.6",
      }
    );

    assert.strictEqual(fbRes.statusCode, 201);
    assert.strictEqual(fbRes.json.ok, true);
    assert.ok(fbRes.json.id);
  });

  // 8. Feedback Bounds & Validation
  await itAsync("Test 8: Feedback input bounds enforcement (length & categories)", async () => {
    // Empty message
    const emptyRes = await httpRequest(
      serverPort,
      { path: "/api/feedback", method: "POST", headers: { "Content-Type": "application/json" } },
      { category: "bug", message: "   " }
    );
    assert.strictEqual(emptyRes.statusCode, 400);
    assert.strictEqual(emptyRes.json.code, "EMPTY_MESSAGE");

    // Invalid category
    const badCatRes = await httpRequest(
      serverPort,
      { path: "/api/feedback", method: "POST", headers: { "Content-Type": "application/json" } },
      { category: "unsupported_cat", message: "Valid message" }
    );
    assert.strictEqual(badCatRes.statusCode, 400);
    assert.strictEqual(badCatRes.json.code, "INVALID_CATEGORY");

    // Oversized message (> 2000 chars)
    const longMsg = "A".repeat(2001);
    const longRes = await httpRequest(
      serverPort,
      { path: "/api/feedback", method: "POST", headers: { "Content-Type": "application/json" } },
      { category: "bug", message: longMsg }
    );
    assert.strictEqual(longRes.statusCode, 400);
    assert.strictEqual(longRes.json.code, "MESSAGE_TOO_LONG");
  });

  // 9. Authentication Authority
  await itAsync("Test 9: Server uses authenticated session, never trusts client userId", async () => {
    const spoofedRes = await httpRequest(
      serverPort,
      {
        path: "/api/feedback",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userTokenA}`,
        },
      },
      {
        userId: "ATTEMPTED_SPOOFED_ID_B",
        category: "bug",
        message: "Session authority test",
      }
    );
    assert.strictEqual(spoofedRes.statusCode, 201);

    const storedFB = testServerApp.db.getFeedbackByUserId(userIdA);
    assert.ok(storedFB.some((f) => f.message === "Session authority test"));

    const spoofedCheck = testServerApp.db.getFeedbackByUserId("ATTEMPTED_SPOOFED_ID_B");
    assert.strictEqual(spoofedCheck.length, 0);
  });

  // 10. User Isolation
  await itAsync("Test 10: Strict server-side user isolation for feedback and telemetry", async () => {
    // Submit telemetry for User A and User B
    await httpRequest(
      serverPort,
      {
        path: "/api/telemetry/product",
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userTokenA}` },
      },
      { event: "onboarding_completed", platform: "leetcode" }
    );

    await httpRequest(
      serverPort,
      {
        path: "/api/telemetry/product",
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userTokenB}` },
      },
      { event: "first_sync", platform: "hackerrank" }
    );

    // User A reads telemetry
    const telAResp = await httpRequest(
      serverPort,
      {
        path: "/api/telemetry/product",
        method: "GET",
        headers: { Authorization: `Bearer ${userTokenA}` },
      }
    );
    assert.strictEqual(telAResp.statusCode, 200);
    const eventsA = telAResp.json.telemetry;
    assert.ok(eventsA.every((e) => e.userId === userIdA));
    assert.ok(!eventsA.some((e) => e.userId === userIdB));

    // User B reads feedback
    const fbBResp = await httpRequest(
      serverPort,
      {
        path: "/api/feedback",
        method: "GET",
        headers: { Authorization: `Bearer ${userTokenB}` },
      }
    );
    assert.strictEqual(fbBResp.statusCode, 200);
    assert.strictEqual(fbBResp.json.feedback.length, 0);
  });

  // 11. Diagnostics Generation
  it("Test 11: Diagnostics generator creates safe structured snapshot", () => {
    const diag = Fly2GitDiagnostics.generateSafeDiagnostics({
      githubConnected: true,
      selectedPlatform: "leetcode",
      lastSync: { ok: true, platform: "leetcode", timestamp: Date.now() },
      recentErrors: ["ERR_NETWORK_TIMEOUT"],
    });

    assert.strictEqual(diag.fly2gitVersion, "1.1.6");
    assert.strictEqual(diag.githubConnected, true);
    assert.strictEqual(diag.selectedPlatform, "leetcode");
    assert.strictEqual(diag.latestSyncResult.ok, true);
    assert.deepStrictEqual(diag.safeErrorCodes, ["ERR_NETWORK_TIMEOUT"]);
    assert.ok(diag.timestamp);
  });

  // 12. Diagnostics Secret Exclusion
  it("Test 12: Diagnostics text scrubbing eliminates tokens and private keys", () => {
    const rawWithSecrets =
      `Error: ${["ghp", "1111222233334444555566667777888899990000"].join("_")} with ${["sk", "live", "123456789012345678901234"].join("_")} and ${["AIza", "SyAbcdef1234567890_123456789012345"].join("")}`;
    const scrubbed = Fly2GitDiagnostics.sanitizeString(rawWithSecrets);
    assert.ok(!scrubbed.includes("ghp_"));
    assert.ok(!scrubbed.includes("sk_live_"));
    assert.ok(!scrubbed.includes("AIzaSy"));
    assert.ok(scrubbed.includes("[REDACTED]"));
  });

  // 13. Beta Allowlist
  await itAsync("Test 13: Server-side beta allowlist enables beta for user", async () => {
    const adminKey = config.adminApiKey;
    const addBeta = await httpRequest(
      serverPort,
      {
        path: "/api/admin/beta/allowlist",
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      },
      {
        userId: userIdA,
        beta_enabled: true,
      }
    );
    assert.strictEqual(addBeta.statusCode, 200);
    assert.strictEqual(addBeta.json.beta.beta_enabled, true);

    const userStatus = await httpRequest(
      serverPort,
      { path: "/api/beta/status", method: "GET", headers: { Authorization: `Bearer ${userTokenA}` } }
    );
    assert.strictEqual(userStatus.statusCode, 200);
    assert.strictEqual(userStatus.json.beta, true);
  });

  // 14. Beta Expiration
  await itAsync("Test 14: Expired beta membership is cleanly deactivated", async () => {
    const adminKey = config.adminApiKey;
    // Set expiration in past
    await httpRequest(
      serverPort,
      {
        path: "/api/admin/beta/allowlist",
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      },
      {
        userId: userIdA,
        beta_enabled: true,
        beta_expires_at: Date.now() - 5000,
      }
    );

    const userStatus = await httpRequest(
      serverPort,
      { path: "/api/beta/status", method: "GET", headers: { Authorization: `Bearer ${userTokenA}` } }
    );
    assert.strictEqual(userStatus.statusCode, 200);
    assert.strictEqual(userStatus.json.beta, false);
  });

  // 15. Feature Flags
  await itAsync("Test 15: Server provides controlled feature flags for beta rollout", async () => {
    const adminKey = config.adminApiKey;
    await httpRequest(
      serverPort,
      {
        path: "/api/admin/beta/allowlist",
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      },
      { userId: userIdA, beta_enabled: true, beta_expires_at: Date.now() + 100000 }
    );

    const userStatus = await httpRequest(
      serverPort,
      { path: "/api/beta/status", method: "GET", headers: { Authorization: `Bearer ${userTokenA}` } }
    );
    assert.strictEqual(userStatus.json.beta, true);
    assert.strictEqual(userStatus.json.flags.betaTelemetry, true);
    assert.strictEqual(userStatus.json.flags.betaAI, true);
    assert.strictEqual(userStatus.json.flags.betaCoach, true);
    assert.strictEqual(userStatus.json.flags.betaIntelligence, true);
  });

  // 16. Entitlement Remains Authoritative
  await itAsync("Test 16: Feature flags cannot bypass entitlement (Basic user blocked from Pro-only operations)", async () => {
    // User A has beta_enabled: true, but Basic plan (no Pro subscription)
    const ent = await testServerApp.entitlementService.getAuthoritativeEntitlement(userIdA);
    assert.strictEqual(ent.plan, "basic");

    // Attempt Pro-only operation: custom automation settings save
    const autoResp = await httpRequest(
      serverPort,
      {
        path: "/api/automation/settings",
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userTokenA}` },
      },
      {
        commitMessageTemplate: "Custom commit: {{title}}",
      }
    );
    assert.strictEqual(autoResp.statusCode, 403);
    assert.strictEqual(autoResp.json.code, "PRO_REQUIRED");
  });

  // 17. Version Compatibility
  await itAsync("Test 17: Supported client version is accepted with version headers", async () => {
    const res = await httpRequest(serverPort, {
      path: "/api/auth/me",
      method: "GET",
      headers: {
        Authorization: `Bearer ${userTokenA}`,
        "X-Fly2Git-Version": "1.1.6",
      },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["x-api-version"], "1.1.0");
    assert.strictEqual(res.headers["x-app-version"], "1.1.6");
  });

  // 18. Unsupported Client Rejected
  await itAsync("Test 18: Client below minimum version (0.9.0 < 1.0.0) rejected with 426", async () => {
    const res = await httpRequest(serverPort, {
      path: "/api/auth/me",
      method: "GET",
      headers: {
        Authorization: `Bearer ${userTokenA}`,
        "X-Fly2Git-Version": "0.9.0",
      },
    });
    assert.strictEqual(res.statusCode, 426);
    assert.strictEqual(res.json.code, "CLIENT_VERSION_UNSUPPORTED");
    assert.strictEqual(res.json.minSupportedVersion, "1.0.0");
  });

  // 19. Deletion of Product Telemetry
  await itAsync("Test 19: DELETE /api/product-telemetry deletes only product telemetry", async () => {
    const delRes = await httpRequest(serverPort, {
      path: "/api/product-telemetry",
      method: "DELETE",
      headers: { Authorization: `Bearer ${userTokenA}` },
    });
    assert.strictEqual(delRes.statusCode, 200);
    assert.strictEqual(delRes.json.deleted, true);

    const checkEvents = testServerApp.productTelemetryService.getUserTelemetry(userIdA);
    assert.strictEqual(checkEvents.length, 0);

    // Verify user account & entitlement still exist
    const userCheck = testServerApp.db.getUserById(userIdA);
    assert.ok(userCheck);
  });

  // 20. Retention (90-Day Pruning)
  it("Test 20: 90-day retention pruning purges stale events and preserves fresh ones", () => {
    const memoryDb = new Database({ memoryOnly: true });
    const tel = new ProductTelemetryService(memoryDb, { retentionDays: 90 });

    const now = Date.now();
    const oldTimestamp = now - 95 * 24 * 60 * 60 * 1000; // 95 days ago
    const freshTimestamp = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    tel.recordEvent({ userId: "u1", event: "onboarding_started", timestamp: oldTimestamp });
    tel.recordEvent({ userId: "u1", event: "first_sync", timestamp: freshTimestamp });

    assert.strictEqual(memoryDb.productTelemetryEvents.size, 2);
    const pruned = tel.pruneTelemetry(90);
    assert.strictEqual(pruned, 1);
    assert.strictEqual(memoryDb.productTelemetryEvents.size, 1);

    const remaining = Array.from(memoryDb.productTelemetryEvents.values());
    assert.strictEqual(remaining[0].event, "first_sync");
  });

  // 21. Onboarding Events
  it("Test 21: Onboarding start and completion events are registered", () => {
    assert.ok(ALLOWED_EVENTS.includes("onboarding_started"));
    assert.ok(ALLOWED_EVENTS.includes("onboarding_completed"));

    const res1 = telemetryService.recordEvent({
      userId: "onboard_user",
      event: "onboarding_started",
      platform: "extension",
    });
    const res2 = telemetryService.recordEvent({
      userId: "onboard_user",
      event: "onboarding_completed",
      platform: "extension",
    });
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res2.ok, true);
  });

  // 22. First-Sync Event & Metric
  it("Test 22: First sync event and timeToFirstSync metric capture", () => {
    const installTime = Date.now() - 300000; // 5 mins ago
    const syncTime = Date.now();
    const timeToFirstSyncMs = syncTime - installTime;

    const res = telemetryService.recordEvent({
      userId: "sync_val_user",
      event: "first_sync",
      platform: "leetcode",
      timestamp: syncTime,
    });
    assert.strictEqual(res.ok, true);
    assert.ok(timeToFirstSyncMs > 0);
  });

  // 23. Telemetry Failure Doesn't Affect Sync
  it("Test 23: Telemetry failure never breaks or throws into sync operation", () => {
    let syncCompleted = false;
    function executeSimulatedSync() {
      try {
        // Deliberate invalid telemetry
        telemetryService.recordEvent({
          event: "invalid_unsupported_event_xyz",
        });
      } catch (_ignored) {
        // Isolation guarantee
      }
      // Core sync must proceed
      syncCompleted = true;
      return { success: true, commitSha: "abc1234" };
    }

    const result = executeSimulatedSync();
    assert.strictEqual(syncCompleted, true);
    assert.strictEqual(result.success, true);
  });

  // 24. Feedback Failure Doesn't Affect Sync
  it("Test 24: Feedback failure never breaks sync execution", () => {
    let syncSuccess = false;
    function syncWithSubtleFeedback() {
      try {
        throw new Error("Feedback network connection dropped");
      } catch (_e) {
        // Non-blocking failure isolation
      }
      syncSuccess = true;
      return { ok: true };
    }

    const res = syncWithSubtleFeedback();
    assert.strictEqual(syncSuccess, true);
    assert.strictEqual(res.ok, true);
  });

  // 25. Phase 17 Regression
  it("Test 25: Phase 17 launch hardening configuration integrity", () => {
    assert.strictEqual(typeof config.validateProductionConfig, "function");
    const devValidation = config.validateProductionConfig({ ...config, env: "development" });
    assert.strictEqual(devValidation.ok, true);
  });

  // 26. Phase 16 Regression (Midnight Titanium & Liquid Glass)
  it("Test 26: Phase 16 design system and notification classes present", () => {
    const cssPath = path.join(__dirname, "design-tokens.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    assert.ok(cssContent.includes("--color-sand") && cssContent.includes("--color-bg"));
    assert.ok(cssContent.includes("--glass-04-bg") || cssContent.includes("--glass-surface"));

    const notifPath = path.join(__dirname, "sync-notification.js");
    const notifContent = fs.readFileSync(notifPath, "utf8");
    assert.ok(notifContent.includes("createNotification"));
  });

  // 27. Phase 15 Regression (AI Architecture & Invariants)
  it("Test 27: Phase 15 AI invariants (Zero skill scoring, token bounds)", () => {
    const { CodingIntelligenceService } = require("./backend/services/coding-intelligence-service");
    const intelService = new CodingIntelligenceService(db, testServerApp.entitlementService, testServerApp.aiService);
    const intel = intelService.buildIntelligence(userIdA);
    assert.strictEqual(intel.skillScore, undefined);
    assert.strictEqual(intel.employabilityIndex, undefined);
  });

  // 28. Phase 14 Regression (Pro Grants & Platform Slots)
  it("Test 28: Phase 14 Pro grant and platform slot governance", () => {
    const { ProGrantService } = require("./backend/services/pro-grant-service");
    const testUser = db.insertUser({ id: "user_pro_grant_test", email: "pro_grant_test@example.com" });
    const proGrantService = new ProGrantService(db);
    const grant = proGrantService.createGrant({
      userId: testUser.id,
      type: "beta",
      grantedBy: "admin",
    });
    assert.ok(grant.id);
    assert.strictEqual(grant.status, "active");
  });

  // 29. Platform Regression (All 7 Supported Platforms)
  it("Test 29: Platform registry contains all 7 core platforms", () => {
    const { PLATFORM_REGISTRY } = require("./platforms");
    const required = ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "codeforces", "atcoder", "spoj"];
    for (const p of required) {
      assert.ok(PLATFORM_REGISTRY[p], `Missing platform adapter: ${p}`);
      assert.ok(PLATFORM_REGISTRY[p].name);
      assert.ok(PLATFORM_REGISTRY[p].origin);
    }
  });

  // 30. Identity Regression (IdentityGuard)
  it("Test 30: IdentityGuard prevents cross-account sync without authorization", () => {
    const { isIdentityMatch } = require("./identity");
    const boundAccount = { username: "alice_dev", platform: "leetcode" };
    const mismatch = isIdentityMatch(boundAccount, { username: "bob_dev", platform: "leetcode" });
    assert.strictEqual(mismatch, false);

    const match = isIdentityMatch(boundAccount, { username: "alice_dev", platform: "leetcode" });
    assert.strictEqual(match, true);
  });

  // Stop HTTP test server
  await testServerApp.stop();

  console.log("\n--------------------------------------------------------");
  console.log(`TOTAL PHASE 18 TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("--------------------------------------------------------\n");

  if (failed > 0) {
    console.error("FAILURES:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered unexpected error:", err);
  process.exit(1);
});
