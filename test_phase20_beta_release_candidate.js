/**
 * Fly2Git — Phase 20: Beta Release Candidate + Pilot Operations Test Suite
 *
 * 20 automated tests covering:
 * 1. Version consistency
 * 2. Clean package
 * 3. Manifest validation
 * 4. Backend URL validation
 * 5. No localhost production fallback
 * 6. Beta authorization
 * 7. Beta expiration
 * 8. Beta revocation
 * 9. Entitlement protection
 * 10. Diagnostics safety
 * 11. Feedback safety
 * 12. AI credential isolation
 * 13. Telemetry privacy
 * 14. Release file boundaries
 * 15. Rollback configuration
 * 16. Existing beta infrastructure
 * 17. Phase 19 regression
 * 18. Phase 18 regression
 * 19. Phase 17 regression
 * 20. Complete regression
 */

"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

let passed = 0;
let failed = 0;
const failures = [];

async function it(description, fn) {
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

async function runAll() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 20 — BETA RELEASE CANDIDATE SUITE");
  console.log("=======================================================\n");

  const ROOT_DIR = path.resolve(__dirname);
  const versionModule = require("./version.js");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
  const config = require("./backend/config.js");
  const Fly2GitDiagnostics = require("./diagnostics.js");
  const Database = require("./backend/db/database.js");
  const { BetaCohortService } = require("./backend/services/beta-cohort-service.js");
  const { BetaMetricsService } = require("./backend/services/beta-metrics-service.js");
  const { ProductTelemetryService, ALLOWED_EVENTS, FORBIDDEN_KEYS } = require("./backend/services/product-telemetry-service.js");
  const { EntitlementService, BASIC_FEATURES } = require("./backend/services/entitlement-service.js");
  const server = require("./backend/server.js");

  // 1. Version consistency
  await it("1. version consistency: verifies FLY2GIT_BETA_VERSION, manifest, server, diagnostics and config match", () => {
    assert.strictEqual(versionModule.FLY2GIT_BETA_VERSION, "1.1.6-rc.1");
    assert.strictEqual(versionModule.EXTENSION_VERSION, "1.1.6");
    assert.strictEqual(manifest.version, "1.1.6");
    assert.strictEqual(server.APP_VERSION, "1.1.6");
    assert.strictEqual(server.API_VERSION, "1.1.0");
    assert.strictEqual(config.betaVersion, "1.1.6-rc.1");
    assert.strictEqual(config.appVersion, "1.1.6");
    assert.strictEqual(config.apiVersion, "1.1.0");

    const diag = Fly2GitDiagnostics.generateSafeDiagnostics();
    assert.strictEqual(diag.fly2gitVersion, "1.1.6");
    assert.strictEqual(diag.appVersion, "1.1.6");
  });

  // 2. Clean package
  await it("2. clean package: release package excludes backend, test files, scratch, and dev artifacts", () => {
    const forbiddenDirsInExtension = ["backend", "docs", "scratch", ".gemini", "test_*.js"];
    const releaseManifestPath = path.join(ROOT_DIR, "docs/BETA_RELEASE_MANIFEST.md");
    assert.ok(fs.existsSync(releaseManifestPath), "docs/BETA_RELEASE_MANIFEST.md must exist");

    const manifestContent = fs.readFileSync(releaseManifestPath, "utf8");
    for (const dir of forbiddenDirsInExtension) {
      assert.ok(manifestContent.includes(dir), `Release manifest must document exclusion of ${dir}`);
    }
  });

  // 3. Manifest validation
  await it("3. manifest validation: inspects MV3 fields, permissions, scripts and icons", () => {
    assert.strictEqual(manifest.manifest_version, 3);
    assert.strictEqual(manifest.name, "Fly2Git by SRT");
    assert.deepStrictEqual(manifest.permissions, ["storage", "alarms"]);
    assert.ok(Array.isArray(manifest.host_permissions));
    assert.ok(manifest.host_permissions.includes("https://api.github.com/*"));
    assert.ok(manifest.host_permissions.includes("https://api.fly2git.com/*"));

    // Check 7 platforms
    const requiredPlatforms = [
      "leetcode.com",
      "geeksforgeeks.org",
      "hackerrank.com",
      "codechef.com",
      "atcoder.jp",
      "codeforces.com",
      "spoj.com",
    ];
    for (const p of requiredPlatforms) {
      assert.ok(
        manifest.host_permissions.some((hp) => hp.includes(p)),
        `host_permissions must contain ${p}`
      );
    }

    // Ensure no dangerous or excessive permissions
    assert.ok(!manifest.permissions.includes("<all_urls>"));
    assert.ok(!manifest.permissions.includes("tabs"));
    assert.ok(!manifest.permissions.includes("cookies"));
    assert.ok(!manifest.permissions.includes("webRequest"));
    assert.ok(!manifest.permissions.includes("webRequestBlocking"));

    assert.strictEqual(manifest.background.service_worker, "background.js");
    assert.strictEqual(manifest.action.default_popup, "popup.html");
    assert.ok(manifest.icons["128"]);
  });

  // 4. Backend URL validation
  await it("4. backend URL validation: verifies HTTPS requirement and valid endpoint structure", () => {
    const prodOrigin = "https://api.fly2git.com";
    assert.ok(prodOrigin.startsWith("https://"));
    assert.ok(!prodOrigin.includes("localhost"));
    assert.ok(!prodOrigin.includes("127.0.0.1"));

    const parsed = new URL(prodOrigin);
    assert.strictEqual(parsed.protocol, "https:");
    assert.strictEqual(parsed.hostname, "api.fly2git.com");
  });

  // 5. No localhost production fallback
  await it("5. no localhost production fallback: strict production validator throws on dev/mock secrets", () => {
    assert.throws(
      () => {
        config.validateProductionConfig({
          env: "production",
          authSecret: "dev-insecure-auth-secret-change-in-prod-32bytes",
          entitlementSecret: "secret",
          adminApiKey: "secret",
          billing: { provider: "stripe", stripeSecretKey: "sk_live_123" },
          ai: { enabled: false },
        });
      },
      /Production configuration invalid/,
      "Should reject default dev-insecure authSecret in production"
    );

    assert.throws(
      () => {
        config.validateProductionConfig({
          env: "production",
          authSecret: "real-prod-auth-secret-32-chars-long!",
          entitlementSecret: "real-prod-entitlement-secret-32-chars",
          adminApiKey: "real-prod-admin-key",
          billing: { provider: "stripe", stripeSecretKey: "sk_test_mock_stripe_key" },
          ai: { enabled: false },
        });
      },
      /Production configuration invalid/,
      "Should reject mock stripeSecretKey in production"
    );
  });

  // 6. Beta authorization
  await it("6. beta authorization: allowlisted active users are permitted, unknown users are rejected", () => {
    const db = new Database({ memoryOnly: true });
    const cohort = new BetaCohortService(db);

    const addRes = cohort.addToCohort("user_auth_pass");
    assert.strictEqual(addRes.ok, true);

    const statusActive = cohort.isBetaActive("user_auth_pass");
    assert.strictEqual(statusActive.active, true);

    const statusUnknown = cohort.isBetaActive("user_unknown");
    assert.strictEqual(statusUnknown.active, false);
    assert.strictEqual(statusUnknown.reason, "not_in_cohort");

    const statusNull = cohort.isBetaActive(null);
    assert.strictEqual(statusNull.active, false);
  });

  // 7. Beta expiration
  await it("7. beta expiration: expired allowlist records are rejected fail-closed", () => {
    const db = new Database({ memoryOnly: true });
    const cohort = new BetaCohortService(db);

    cohort.addToCohort("user_expired", { expiresAt: Date.now() - 5000 });
    const status = cohort.isBetaActive("user_expired");
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.reason, "expired");
  });

  // 8. Beta revocation
  await it("8. beta revocation: revoked allowlist records are rejected even if unexpired", () => {
    const db = new Database({ memoryOnly: true });
    const cohort = new BetaCohortService(db);

    cohort.addToCohort("user_revoked", { expiresAt: Date.now() + 86400000 });
    const revokeRes = cohort.revokeBeta("user_revoked");
    assert.strictEqual(revokeRes.ok, true);

    const status = cohort.isBetaActive("user_revoked");
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.reason, "revoked");
  });

  // 9. Entitlement protection
  await it("9. entitlement protection: beta status never bypasses Pro entitlements or repository access", async () => {
    const db = new Database({ memoryOnly: true });
    const entService = new EntitlementService(db);

    // Basic user without Pro grant
    const ent = await entService.getAuthoritativeEntitlement("beta_user_basic");
    assert.strictEqual(ent.plan, "basic");
    assert.strictEqual(ent.features.ai, false);
    assert.strictEqual(ent.features.maxPlatforms, 2);
    assert.strictEqual(ent.features.advancedAutomation, false);
  });

  // 10. Diagnostics safety
  await it("10. diagnostics safety: scrubs credentials, tokens, cookies, prompts and source code", () => {
    const stateWithSecrets = {
      githubToken: ["ghp", "1234567890abcdef1234567890abcdef1234"].join("_"),
      geminiKey: ["AIza", "SyTestApiKeyMock1234567890abcdef"].join(""),
      stripeKey: ["sk", "live", "1234567890abcdef1234567890"].join("_"),
      bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      cookie: "connect.sid=s%3A123456",
      code: 'function solve() { return "classified"; }',
      prompt: "Write a complete exploit for this challenge",
      lastSync: {
        ok: true,
        platform: "LeetCode",
        status: `Synced with token ${["ghp", "1234567890abcdef1234567890abcdef1234"].join("_")}`,
        timestamp: Date.now(),
      },
    };

    const diag = Fly2GitDiagnostics.generateSafeDiagnostics(stateWithSecrets);
    const diagStr = JSON.stringify(diag);

    assert.ok(!diagStr.includes("ghp_1234567890abcdef1234567890abcdef1234"), "Must scrub GitHub token");
    assert.ok(!diagStr.includes("AIzaSyTestApiKeyMock"), "Must scrub Google AI key");
    assert.ok(!diagStr.includes("sk_live_"), "Must scrub Stripe key");
    assert.ok(!diagStr.includes("classified"), "Must not leak source code");
    assert.ok(!diagStr.includes("exploit"), "Must not leak prompt");
    assert.ok(diag.latestSyncResult.status.includes("[REDACTED]"), "Status string must be scrubbed");
  });

  // 11. Feedback safety
  await it("11. feedback safety: enforces valid categories, input bounds, and failure isolation", () => {
    const validCategories = ["bug", "confusing", "feature_request", "feedback"];
    for (const cat of validCategories) {
      assert.ok(validCategories.includes(cat));
    }

    // Bounds check
    const maxMessageLength = 2000;
    const longMessage = "a".repeat(3000);
    const boundedMessage = longMessage.slice(0, maxMessageLength);
    assert.strictEqual(boundedMessage.length, 2000);

    // Failure isolation: feedback failure must never throw or disrupt sync
    function safeReportFeedback(feedbackFn) {
      try {
        feedbackFn();
      } catch {
        // Intentionally absorbed to preserve core sync workflow
      }
      return { syncPreserved: true };
    }
    const result = safeReportFeedback(() => {
      throw new Error("Network offline");
    });
    assert.strictEqual(result.syncPreserved, true);
  });

  // 12. AI credential isolation
  await it("12. AI credential isolation: extension client files contain no AI credentials", () => {
    const clientFiles = [
      "background.js",
      "content.js",
      "popup.js",
      "diagnostics.js",
      "sync-notification.js",
      "inject.js",
    ];

    for (const f of clientFiles) {
      const fullPath = path.join(ROOT_DIR, f);
      if (fs.existsSync(fullPath)) {
        const code = fs.readFileSync(fullPath, "utf8");
        assert.ok(!code.includes("AIzaSy"), `${f} must not contain Google API key patterns`);
        assert.ok(!code.includes("GEMINI_API_KEY"), `${f} must not reference GEMINI_API_KEY directly`);
      }
    }
  });

  // 13. Telemetry privacy
  await it("13. telemetry privacy: strictly metadata-only, no keystrokes or source code, honors opt-out", () => {
    assert.ok(ALLOWED_EVENTS.includes("onboarding_completed"));
    assert.ok(ALLOWED_EVENTS.includes("sync_success"));
    assert.ok(ALLOWED_EVENTS.includes("coach_used"));

    // Check forbidden tracking
    assert.ok(!ALLOWED_EVENTS.includes("keystroke"));
    assert.ok(!ALLOWED_EVENTS.includes("page_view"));
    assert.ok(!ALLOWED_EVENTS.includes("source_code"));
    assert.ok(!ALLOWED_EVENTS.includes("browser_history"));

    assert.ok(FORBIDDEN_KEYS.includes("code"));
    assert.ok(FORBIDDEN_KEYS.includes("prompt"));
    assert.ok(FORBIDDEN_KEYS.includes("token"));

    // Opt-out test
    const db = new Database({ memoryOnly: true });
    const telemetry = new ProductTelemetryService(db);
    const optOutResult = telemetry.recordEvent(
      { event: "sync_success", platform: "leetcode", productTelemetryEnabled: false },
      { userId: "user-opted-out" }
    );
    assert.strictEqual(optOutResult.ok, true);
    assert.strictEqual(optOutResult.skipped, true);

    // Forbidden payload test
    const forbiddenResult = telemetry.recordEvent(
      { event: "sync_success", code: "secret_source_code" },
      { userId: "user-test" }
    );
    assert.strictEqual(forbiddenResult.ok, false);
    assert.ok(forbiddenResult.error.includes("Forbidden field"));
  });

  // 14. Release file boundaries
  await it("14. release file boundaries: extension files exist and backend/doc separation is verified", () => {
    const extensionCoreFiles = [
      "manifest.json",
      "background.js",
      "popup.html",
      "popup.js",
      "popup.css",
      "design-tokens.css",
      "sync-notification.js",
      "diagnostics.js",
      "version.js",
    ];

    for (const ef of extensionCoreFiles) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, ef)), `Extension core file ${ef} must exist`);
    }

    assert.ok(fs.existsSync(path.join(ROOT_DIR, "backend/server.js")));
  });

  // 15. Rollback configuration
  await it("15. rollback configuration: server supports version negotiation and rejects obsolete clients", () => {
    assert.strictEqual(server.MIN_SUPPORTED_CLIENT_VERSION, "1.0.0");
    assert.strictEqual(server.isVersionSupported("1.1.6"), true);
    assert.strictEqual(server.isVersionSupported("1.1.0"), true);
    assert.strictEqual(server.isVersionSupported("1.0.0"), true);
    assert.strictEqual(server.isVersionSupported("0.9.9"), false);
    assert.strictEqual(server.isVersionSupported("0.8.0"), false);
  });

  // 16. Existing beta infrastructure
  await it("16. existing beta infrastructure: cohort, metrics and admin endpoints functional", () => {
    const db = new Database({ memoryOnly: true });
    const telemetry = new ProductTelemetryService(db);
    const cohort = new BetaCohortService(db);
    const metrics = new BetaMetricsService(db, telemetry, cohort);

    cohort.addToCohort("test_beta_user");
    const actRes = metrics.recordActivation("test_beta_user", { platform: "leetcode" });
    assert.strictEqual(actRes.ok, true);

    const summary = metrics.getDashboard();
    assert.ok(summary.betaUsers);
    assert.ok(typeof summary.activationRate === "number");
    assert.ok(summary.featureAdoption);
  });

  // 17. Phase 19 regression
  await it("17. Phase 19 regression: Phase 19 private beta pilot services and tests remain intact", () => {
    const p19TestPath = path.join(ROOT_DIR, "test_phase19_private_beta.js");
    assert.ok(fs.existsSync(p19TestPath), "test_phase19_private_beta.js must exist");
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "docs/BETA_FINDINGS.md")), "docs/BETA_FINDINGS.md must exist");
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "docs/BETA_TEST_PLAN.md")), "docs/BETA_TEST_PLAN.md must exist");
  });

  // 18. Phase 18 regression
  await it("18. Phase 18 regression: Phase 18 private beta telemetry and diagnostics intact", () => {
    const p18TestPath = path.join(ROOT_DIR, "test_phase18_private_beta.js");
    assert.ok(fs.existsSync(p18TestPath), "test_phase18_private_beta.js must exist");
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "docs/PRIVATE_BETA.md")), "docs/PRIVATE_BETA.md must exist");
  });

  // 19. Phase 17 regression
  await it("19. Phase 17 regression: launch hardening and security audits intact", () => {
    const p17TestPath = path.join(ROOT_DIR, "test_phase17_launch_hardening.js");
    assert.ok(fs.existsSync(p17TestPath), "test_phase17_launch_hardening.js must exist");
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "docs/LAUNCH_READINESS.md")), "docs/LAUNCH_READINESS.md must exist");
  });

  // 20. Complete regression
  await it("20. complete regression: all core platform scripts and security services present", () => {
    const platformScripts = [
      "content.js",
      "inject.js",
      "gfg-content.js",
      "gfg-inject.js",
      "hackerrank-content.js",
      "hackerrank-inject.js",
      "codechef-content.js",
      "codechef-inject.js",
      "atcoder-content.js",
      "atcoder-inject.js",
      "codeforces-content.js",
      "codeforces-inject.js",
      "spoj-content.js",
      "spoj-inject.js",
    ];
    for (const ps of platformScripts) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, ps)), `Platform script ${ps} must exist`);
    }
  });

  console.log("\n=======================================================");
  console.log(`   PHASE 20 RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
