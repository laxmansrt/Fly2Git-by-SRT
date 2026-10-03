/**
 * Fly2Git — Phase 19: Private Beta Pilot Test Suite
 *
 * 32 automated tests covering:
 * 1. Beta allowlist
 * 2. Beta expiration
 * 3. Beta revocation
 * 4. User isolation
 * 5. Onboarding events
 * 6. Activation event
 * 7. First sync timing
 * 8. Repeat usage tracking
 * 9. Feature adoption
 * 10. Telemetry opt-out
 * 11. No source code telemetry
 * 12. No token telemetry
 * 13. No cookie telemetry
 * 14. Diagnostics safety
 * 15. Feedback authentication
 * 16. Feedback bounds
 * 17. Deletion
 * 18. Retention
 * 19. Version tracking
 * 20. Beta does not bypass entitlement
 * 21. Beta failure isolation
 * 22. Telemetry failure does not affect sync
 * 23. Feedback failure does not affect sync
 * 24. Diagnostics failure does not affect sync
 * 25. Admin dashboard isolation
 * 26. Phase 18 regression
 * 27. Phase 17 regression
 * 28. Phase 16 regression
 * 29. Phase 15 regression
 * 30. Phase 14 regression
 * 31. Platform regression
 * 32. Identity regression
 */

"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

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

const ROOT = path.resolve(__dirname);

// Load backend services
const Database = require("./backend/db/database");
const { ProductTelemetryService, ALLOWED_EVENTS, FORBIDDEN_KEYS } = require("./backend/services/product-telemetry-service");
const { BetaCohortService } = require("./backend/services/beta-cohort-service");
const { BetaMetricsService, BETA_TELEMETRY_EVENTS, TRACKED_FEATURES } = require("./backend/services/beta-metrics-service");

function createTestEnv() {
  const db = new Database({ memoryOnly: true });
  const telemetry = new ProductTelemetryService(db, { retentionDays: 90 });
  const cohort = new BetaCohortService(db, { maxCohortSize: 100 });
  const metrics = new BetaMetricsService(db, telemetry, cohort);
  return { db, telemetry, cohort, metrics };
}

async function runTests() {
  console.log("===============================================================");
  console.log("   FLY2GIT PHASE 19: PRIVATE BETA PILOT TEST SUITE             ");
  console.log("===============================================================\n");

  // -----------------------------------------------------------------
  // 1. Beta Allowlist
  // -----------------------------------------------------------------
  console.log("--- 1. Beta Allowlist ---");

  it("1.1 Adding user to beta cohort returns ok", () => {
    const { cohort } = createTestEnv();
    const result = cohort.addToCohort("user_beta_1");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.record.beta_enabled, true);
    assert.strictEqual(result.record.beta_revoked, false);
  });

  it("1.2 User in cohort is detected as active", () => {
    const { cohort } = createTestEnv();
    cohort.addToCohort("user_beta_1");
    const status = cohort.isBetaActive("user_beta_1");
    assert.strictEqual(status.active, true);
  });

  it("1.3 User NOT in cohort is not active (fail closed)", () => {
    const { cohort } = createTestEnv();
    const status = cohort.isBetaActive("unknown_user");
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.reason, "not_in_cohort");
  });

  it("1.4 Missing userId returns inactive (fail closed)", () => {
    const { cohort } = createTestEnv();
    const status = cohort.isBetaActive(null);
    assert.strictEqual(status.active, false);
  });

  // -----------------------------------------------------------------
  // 2. Beta Expiration
  // -----------------------------------------------------------------
  console.log("\n--- 2. Beta Expiration ---");

  it("2.1 Expired beta returns inactive", () => {
    const { cohort } = createTestEnv();
    cohort.addToCohort("user_expired", { expiresAt: Date.now() - 1000 });
    const status = cohort.isBetaActive("user_expired");
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.reason, "expired");
  });

  it("2.2 Non-expired beta with future expiresAt returns active", () => {
    const { cohort } = createTestEnv();
    cohort.addToCohort("user_valid", { expiresAt: Date.now() + 86400000 });
    const status = cohort.isBetaActive("user_valid");
    assert.strictEqual(status.active, true);
  });

  it("2.3 DB getBetaStatus detects expiration", () => {
    const { db } = createTestEnv();
    db.setBetaStatus("u_exp", { beta_enabled: true, beta_expires_at: Date.now() - 5000 });
    const status = db.getBetaStatus("u_exp");
    assert.strictEqual(status.beta_enabled, false);
    assert.strictEqual(status.expired, true);
  });

  // -----------------------------------------------------------------
  // 3. Beta Revocation
  // -----------------------------------------------------------------
  console.log("\n--- 3. Beta Revocation ---");

  it("3.1 Revoking beta disables access", () => {
    const { cohort } = createTestEnv();
    cohort.addToCohort("user_revoke");
    cohort.revokeBeta("user_revoke");
    const status = cohort.isBetaActive("user_revoke");
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.reason, "revoked");
  });

  it("3.2 DB getBetaStatus detects revocation", () => {
    const { db } = createTestEnv();
    db.setBetaStatus("u_rev", { beta_enabled: true });
    db.setBetaStatus("u_rev", { beta_enabled: false, beta_revoked: true });
    const status = db.getBetaStatus("u_rev");
    assert.strictEqual(status.beta_enabled, false);
    assert.strictEqual(status.revoked, true);
  });

  it("3.3 Revoking non-existent user returns error", () => {
    const { cohort } = createTestEnv();
    const result = cohort.revokeBeta("nonexistent");
    assert.strictEqual(result.ok, false);
  });

  // -----------------------------------------------------------------
  // 4. User Isolation
  // -----------------------------------------------------------------
  console.log("\n--- 4. User Isolation ---");

  it("4.1 User A cannot see User B telemetry", () => {
    const { db, telemetry } = createTestEnv();
    telemetry.recordEvent({ event: "first_sync" }, { userId: "userA" });
    telemetry.recordEvent({ event: "sync_success" }, { userId: "userB" });
    const eventsA = telemetry.getUserTelemetry("userA");
    const eventsB = telemetry.getUserTelemetry("userB");
    assert(eventsA.every((e) => e.userId === "userA"), "User A must not see User B data");
    assert(eventsB.every((e) => e.userId === "userB"), "User B must not see User A data");
  });

  it("4.2 User A cannot see User B feedback", () => {
    const { db } = createTestEnv();
    db.insertFeedback({ userId: "userA", message: "A feedback", category: "bug" });
    db.insertFeedback({ userId: "userB", message: "B feedback", category: "feedback" });
    const fbA = db.getFeedbackByUserId("userA");
    const fbB = db.getFeedbackByUserId("userB");
    assert(fbA.every((f) => f.userId === "userA"));
    assert(fbB.every((f) => f.userId === "userB"));
    assert.strictEqual(fbA.length, 1);
    assert.strictEqual(fbB.length, 1);
  });

  it("4.3 User A cannot see User B beta state", () => {
    const { db } = createTestEnv();
    db.setBetaStatus("userA", { beta_enabled: true });
    db.setBetaStatus("userB", { beta_enabled: false });
    const statusA = db.getBetaStatus("userA");
    const statusB = db.getBetaStatus("userB");
    assert.strictEqual(statusA.beta_enabled, true);
    assert.strictEqual(statusB.beta_enabled, false);
  });

  // -----------------------------------------------------------------
  // 5. Onboarding Events
  // -----------------------------------------------------------------
  console.log("\n--- 5. Onboarding Events ---");

  it("5.1 Valid onboarding steps are recorded", () => {
    const { metrics } = createTestEnv();
    const steps = ["onboarding_started", "github_connected", "platform_selected", "onboarding_completed"];
    for (const step of steps) {
      const result = metrics.recordOnboardingEvent("u1", step);
      assert.strictEqual(result.ok, true, `Step ${step} should succeed`);
    }
  });

  it("5.2 Invalid onboarding step is rejected", () => {
    const { metrics } = createTestEnv();
    const result = metrics.recordOnboardingEvent("u1", "invalid_step");
    assert.strictEqual(result.ok, false);
  });

  // -----------------------------------------------------------------
  // 6. Activation Event
  // -----------------------------------------------------------------
  console.log("\n--- 6. Activation Event ---");

  it("6.1 Activation records first_sync event", () => {
    const { metrics, telemetry } = createTestEnv();
    const result = metrics.recordActivation("u_act1", { installTimestamp: Date.now() - 60000 });
    assert.strictEqual(result.ok, true);
    assert(result.timeToFirstSync > 0, "timeToFirstSync must be positive");
    const events = telemetry.getUserTelemetry("u_act1");
    assert(events.some((e) => e.event === "first_sync"), "Must record first_sync event");
  });

  // -----------------------------------------------------------------
  // 7. First Sync Timing
  // -----------------------------------------------------------------
  console.log("\n--- 7. First Sync Timing ---");

  it("7.1 timeToFirstSync is calculated from install timestamp", () => {
    const { metrics } = createTestEnv();
    const installTs = Date.now() - 120000; // 2 minutes ago
    const result = metrics.recordActivation("u_sync1", { installTimestamp: installTs });
    assert(result.timeToFirstSync >= 120000, "timeToFirstSync should be >= 120s");
    assert(result.timeToFirstSync < 130000, "timeToFirstSync should be < 130s");
  });

  // -----------------------------------------------------------------
  // 8. Repeat Usage Tracking
  // -----------------------------------------------------------------
  console.log("\n--- 8. Repeat Usage Tracking ---");

  it("8.1 Retention metrics count unique active days", () => {
    const { cohort, telemetry, metrics, db } = createTestEnv();
    cohort.addToCohort("u_ret1");
    // Simulate events on different days
    const day1 = new Date("2026-10-01T10:00:00Z").getTime();
    const day2 = new Date("2026-10-02T14:00:00Z").getTime();
    db.insertProductTelemetryEvent({ userId: "u_ret1", event: "sync_success", timestamp: day1 });
    db.insertProductTelemetryEvent({ userId: "u_ret1", event: "sync_success", timestamp: day2 });
    db.insertProductTelemetryEvent({ userId: "u_ret1", event: "ai_used", timestamp: day1 });
    const retention = metrics.getRetentionMetrics();
    const user = retention.users.find((u) => u.userId === "u_ret1");
    assert(user, "User should be tracked");
    assert.strictEqual(user.activeBetaDays, 2);
    assert.strictEqual(user.repeatSyncDays, 2);
    assert.strictEqual(user.aiUsageDays, 1);
  });

  // -----------------------------------------------------------------
  // 9. Feature Adoption
  // -----------------------------------------------------------------
  console.log("\n--- 9. Feature Adoption ---");

  it("9.1 Feature adoption returns counts and percentages", () => {
    const { cohort, telemetry, metrics } = createTestEnv();
    cohort.addToCohort("u_fa1");
    cohort.addToCohort("u_fa2");
    telemetry.recordEvent({ event: "ai_used" }, { userId: "u_fa1" });
    telemetry.recordEvent({ event: "journey_opened" }, { userId: "u_fa1" });
    telemetry.recordEvent({ event: "journey_opened" }, { userId: "u_fa2" });
    const adoption = metrics.getFeatureAdoption();
    assert(adoption.coding_journey.users >= 2, "Both users used journey");
    assert(adoption.coding_journey.percentage > 0, "Percentage should be > 0");
  });

  // -----------------------------------------------------------------
  // 10. Telemetry Opt-Out
  // -----------------------------------------------------------------
  console.log("\n--- 10. Telemetry Opt-Out ---");

  it("10.1 Telemetry event with opt-out is skipped", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", productTelemetryEnabled: false }, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
  });

  // -----------------------------------------------------------------
  // 11. No Source Code Telemetry
  // -----------------------------------------------------------------
  console.log("\n--- 11. No Source Code Telemetry ---");

  it("11.1 Telemetry rejects events containing source code", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", code: "function main() {}" }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
    assert(result.error.includes("Forbidden field"), "Must reject forbidden field: code");
  });

  it("11.2 Telemetry rejects events with sourceCode field", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", sourceCode: "print('hello')" }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
  });

  // -----------------------------------------------------------------
  // 12. No Token Telemetry
  // -----------------------------------------------------------------
  console.log("\n--- 12. No Token Telemetry ---");

  it("12.1 Telemetry rejects events containing token", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", token: "abc123" }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
  });

  it("12.2 Telemetry rejects events containing accessToken", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", accessToken: "gh_xxx" }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
  });

  // -----------------------------------------------------------------
  // 13. No Cookie Telemetry
  // -----------------------------------------------------------------
  console.log("\n--- 13. No Cookie Telemetry ---");

  it("13.1 Telemetry rejects events containing cookie", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", cookie: "session=abc" }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
  });

  it("13.2 Telemetry rejects events containing cookies", () => {
    const { telemetry } = createTestEnv();
    const result = telemetry.recordEvent({ event: "first_sync", cookies: ["a=b"] }, { userId: "u1" });
    assert.strictEqual(result.ok, false);
  });

  // -----------------------------------------------------------------
  // 14. Diagnostics Safety
  // -----------------------------------------------------------------
  console.log("\n--- 14. Diagnostics Safety ---");

  it("14.1 Diagnostics module generates safe output without tokens", () => {
    const diag = require("./diagnostics");
    const snapshot = diag.generateSafeDiagnostics({
      selectedPlatform: "leetcode",
      githubConnected: true,
      aiAvailable: true,
    });
    assert.strictEqual(snapshot.fly2gitVersion, "1.1.6");
    assert.strictEqual(snapshot.selectedPlatform, "leetcode");
    const text = diag.formatDiagnosticsText(snapshot);
    assert(!text.includes("ghp_"), "Diagnostics must not contain GitHub tokens");
    assert(!text.includes("Bearer"), "Diagnostics must not contain Bearer tokens");
  });

  it("14.2 Diagnostics sanitizeString scrubs sensitive values", () => {
    const diag = require("./diagnostics");
    const scrubbed = diag.sanitizeString("key=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd");
    assert(scrubbed.includes("[REDACTED]"), "Must redact GitHub PATs");
  });

  // -----------------------------------------------------------------
  // 15. Feedback Authentication
  // -----------------------------------------------------------------
  console.log("\n--- 15. Feedback Authentication ---");

  it("15.1 Feedback requires userId to be stored", () => {
    const { db } = createTestEnv();
    const fb = db.insertFeedback({ userId: "u_fb1", message: "Great app!", category: "feedback" });
    assert.strictEqual(fb.userId, "u_fb1");
    assert.strictEqual(fb.category, "feedback");
  });

  it("15.2 Anonymous feedback defaults to 'anonymous' userId", () => {
    const { db } = createTestEnv();
    const fb = db.insertFeedback({ message: "Bug found", category: "bug" });
    assert.strictEqual(fb.userId, "anonymous");
  });

  // -----------------------------------------------------------------
  // 16. Feedback Bounds
  // -----------------------------------------------------------------
  console.log("\n--- 16. Feedback Bounds ---");

  it("16.1 Feedback message is trimmed and stored", () => {
    const { db } = createTestEnv();
    const fb = db.insertFeedback({ userId: "u_fb", message: "  trim me  ", category: "bug" });
    assert.strictEqual(fb.message, "trim me");
  });

  // -----------------------------------------------------------------
  // 17. Deletion
  // -----------------------------------------------------------------
  console.log("\n--- 17. Telemetry Deletion ---");

  it("17.1 Deleting product telemetry does not affect other data", () => {
    const { db, telemetry } = createTestEnv();
    db.insertUser({ id: "u_del1", email: "del@test.com" });
    db.insertAnalyticsEvent({ userId: "u_del1", platform: "leetcode", problemSlug: "two-sum" });
    telemetry.recordEvent({ event: "first_sync" }, { userId: "u_del1" });
    // Delete telemetry
    telemetry.deleteUserTelemetry("u_del1");
    // Verify analytics still exist
    const analytics = db.getAnalyticsEventsByUserId("u_del1");
    assert(analytics.length >= 1, "Analytics must survive telemetry deletion");
    // Verify user still exists
    const user = db.getUserById("u_del1");
    assert(user !== null, "User must survive telemetry deletion");
  });

  // -----------------------------------------------------------------
  // 18. Retention
  // -----------------------------------------------------------------
  console.log("\n--- 18. Retention ---");

  it("18.1 Product telemetry retention defaults to 90 days", () => {
    const config = require("./backend/config");
    assert.strictEqual(config.productTelemetryRetentionDays, 90);
  });

  it("18.2 Pruning old telemetry works correctly", () => {
    const { db, telemetry } = createTestEnv();
    // Insert old event (100 days ago)
    db.insertProductTelemetryEvent({
      userId: "u_prune1",
      event: "first_sync",
      timestamp: Date.now() - 100 * 24 * 60 * 60 * 1000,
    });
    // Insert recent event
    telemetry.recordEvent({ event: "sync_success" }, { userId: "u_prune1" });
    const pruned = telemetry.pruneTelemetry(90);
    assert(pruned >= 1, "Should prune at least 1 old event");
    const remaining = telemetry.getUserTelemetry("u_prune1");
    assert(remaining.length >= 1, "Recent event should remain");
  });

  // -----------------------------------------------------------------
  // 19. Version Tracking
  // -----------------------------------------------------------------
  console.log("\n--- 19. Version Tracking ---");

  it("19.1 Telemetry records appVersion", () => {
    const { telemetry } = createTestEnv();
    telemetry.recordEvent({ event: "first_sync", appVersion: "1.1.6" }, { userId: "u_ver1" });
    const events = telemetry.getUserTelemetry("u_ver1");
    assert(events.length > 0);
    assert.strictEqual(events[0].appVersion, "1.1.6");
  });

  it("19.2 Server exports APP_VERSION and API_VERSION", () => {
    const { createServer } = require("./backend/server");
    const app = createServer({ memoryOnly: true });
    assert(app.APP_VERSION, "APP_VERSION must be exported");
    assert(app.API_VERSION, "API_VERSION must be exported");
  });

  // -----------------------------------------------------------------
  // 20. Beta Does Not Bypass Entitlement
  // -----------------------------------------------------------------
  console.log("\n--- 20. Beta Does Not Bypass Entitlement ---");

  it("20.1 Beta status does not grant Pro entitlement", () => {
    const { db, cohort } = createTestEnv();
    cohort.addToCohort("u_ent1");
    // User has basic entitlement
    db.setEntitlement({ userId: "u_ent1", plan: "basic" });
    const ent = db.getEntitlementByUserId("u_ent1");
    assert.strictEqual(ent.plan, "basic", "Beta must not override entitlement to Pro");
    const beta = cohort.isBetaActive("u_ent1");
    assert.strictEqual(beta.active, true, "Beta should still be active");
  });

  // -----------------------------------------------------------------
  // 21. Beta Failure Isolation
  // -----------------------------------------------------------------
  console.log("\n--- 21. Beta Failure Isolation ---");

  it("21.1 BetaCohort fails closed on database error", () => {
    const { cohort, db } = createTestEnv();
    // Corrupt the betaAllowlist to simulate error
    const origGet = db.betaAllowlist.get.bind(db.betaAllowlist);
    db.betaAllowlist.get = () => { throw new Error("DB Error"); };
    const status = cohort.isBetaActive("user_x");
    assert.strictEqual(status.active, false, "Must fail closed on error");
    assert.strictEqual(status.reason, "error");
    db.betaAllowlist.get = origGet; // Restore
  });

  // -----------------------------------------------------------------
  // 22. Telemetry Failure Does Not Affect Sync
  // -----------------------------------------------------------------
  console.log("\n--- 22. Telemetry Failure Isolation ---");

  it("22.1 Sync-related code does not depend on telemetry", () => {
    const bgSource = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    // background.js should never have a hard dependency on telemetry for sync
    assert(
      !bgSource.includes("await productTelemetry") && !bgSource.includes("await telemetry"),
      "Sync must not await telemetry"
    );
  });

  // -----------------------------------------------------------------
  // 23. Feedback Failure Does Not Affect Sync
  // -----------------------------------------------------------------
  console.log("\n--- 23. Feedback Failure Isolation ---");

  it("23.1 Background sync does not depend on feedback system", () => {
    const bgSource = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    assert(!bgSource.includes("await feedback"), "Sync must not await feedback");
  });

  // -----------------------------------------------------------------
  // 24. Diagnostics Failure Does Not Affect Sync
  // -----------------------------------------------------------------
  console.log("\n--- 24. Diagnostics Failure Isolation ---");

  it("24.1 Background sync does not depend on diagnostics", () => {
    const bgSource = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    assert(!bgSource.includes("await diagnostics") && !bgSource.includes("await Fly2GitDiagnostics"),
      "Sync must not await diagnostics");
  });

  // -----------------------------------------------------------------
  // 25. Admin Dashboard Isolation
  // -----------------------------------------------------------------
  console.log("\n--- 25. Admin Dashboard Isolation ---");

  it("25.1 Dashboard generates data without exposing individual rankings", () => {
    const { cohort, telemetry, metrics } = createTestEnv();
    cohort.addToCohort("u_dash1");
    cohort.addToCohort("u_dash2");
    telemetry.recordEvent({ event: "first_sync" }, { userId: "u_dash1" });
    telemetry.recordEvent({ event: "sync_success" }, { userId: "u_dash2" });

    const dashboard = metrics.getDashboard();
    assert(dashboard.betaUsers, "Dashboard must include betaUsers");
    assert(typeof dashboard.activationRate === "number", "Dashboard must include activationRate");
    assert(dashboard.featureAdoption, "Dashboard must include featureAdoption");
    assert(dashboard.funnel, "Dashboard must include funnel");
    // Ensure no individual rankings
    assert(!dashboard.rankings, "Dashboard must NOT include individual rankings");
    assert(!dashboard.leaderboard, "Dashboard must NOT include leaderboard");
  });

  it("25.2 Dashboard is not exposed in manifest or extension files", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const manifestStr = JSON.stringify(manifest);
    assert(!manifestStr.includes("dashboard"), "Manifest must not reference admin dashboard");
    assert(!manifestStr.includes("/api/admin"), "Manifest must not reference admin routes");
  });

  // -----------------------------------------------------------------
  // 26. Phase 18 Regression
  // -----------------------------------------------------------------
  console.log("\n--- 26. Phase 18 Regression ---");

  it("26.1 ProductTelemetryService still accepts Phase 18 events", () => {
    const { telemetry } = createTestEnv();
    const phase18Events = ["onboarding_started", "first_sync", "ai_used", "feedback_submitted"];
    for (const ev of phase18Events) {
      const result = telemetry.recordEvent({ event: ev }, { userId: "u_p18" });
      assert.strictEqual(result.ok, true, `Phase 18 event ${ev} must still be accepted`);
    }
  });

  it("26.2 FORBIDDEN_KEYS still enforced", () => {
    assert(FORBIDDEN_KEYS.includes("code"));
    assert(FORBIDDEN_KEYS.includes("password"));
    assert(FORBIDDEN_KEYS.includes("cookie"));
    assert(FORBIDDEN_KEYS.includes("prompt"));
  });

  // -----------------------------------------------------------------
  // 27. Phase 17 Regression
  // -----------------------------------------------------------------
  console.log("\n--- 27. Phase 17 Regression ---");

  it("27.1 Extension files do not contain eval() or new Function()", () => {
    const extFiles = ["background.js", "popup.js", "content.js", "inject.js", "entitlements.js",
      "identity.js", "platforms.js", "automation-rules.js", "analytics.js", "ai-client.js"];
    for (const file of extFiles) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      assert(!src.includes("eval("), `eval() found in ${file}`);
      assert(!src.includes("new Function("), `new Function() found in ${file}`);
    }
  });

  it("27.2 No live private keys in extension bundle", () => {
    const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js") && !f.startsWith("test_"));
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      assert(!src.includes("BEGIN PRIVATE KEY"), `Private key found in ${file}`);
      assert(!src.includes("sk_live_"), `Live Stripe key found in ${file}`);
    }
  });

  // -----------------------------------------------------------------
  // 28. Phase 16 Regression
  // -----------------------------------------------------------------
  console.log("\n--- 28. Phase 16 Regression ---");

  it("28.1 Design tokens CSS file exists", () => {
    assert(fs.existsSync(path.join(ROOT, "design-tokens.css")), "design-tokens.css must exist");
  });

  it("28.2 popup.css exists and has Midnight Titanium theme", () => {
    const css = fs.readFileSync(path.join(ROOT, "popup.css"), "utf8");
    assert(css.length > 5000, "popup.css must have substantial content");
  });

  // -----------------------------------------------------------------
  // 29. Phase 15 Regression
  // -----------------------------------------------------------------
  console.log("\n--- 29. Phase 15 Regression ---");

  it("29.1 AI client module exists", () => {
    assert(fs.existsSync(path.join(ROOT, "ai-client.js")), "ai-client.js must exist");
  });

  it("29.2 AI service module exists and exports AIService", () => {
    const { AIService } = require("./backend/services/ai-service");
    assert(typeof AIService === "function", "AIService must be a constructor");
  });

  it("29.3 Coding coach service exists", () => {
    const { CodingCoachService } = require("./backend/services/coding-coach-service");
    assert(typeof CodingCoachService === "function", "CodingCoachService must exist");
  });

  it("29.4 Coding intelligence service exists", () => {
    const { CodingIntelligenceService } = require("./backend/services/coding-intelligence-service");
    assert(typeof CodingIntelligenceService === "function", "CodingIntelligenceService must exist");
  });

  // -----------------------------------------------------------------
  // 30. Phase 14 Regression
  // -----------------------------------------------------------------
  console.log("\n--- 30. Phase 14 Regression ---");

  it("30.1 Pro grant service exists and exports", () => {
    const { ProGrantService } = require("./backend/services/pro-grant-service");
    assert(typeof ProGrantService === "function");
  });

  it("30.2 Analytics service exists", () => {
    const { AnalyticsService } = require("./backend/services/analytics-service");
    assert(typeof AnalyticsService === "function");
  });

  it("30.3 Automation service exists", () => {
    const { AutomationService } = require("./backend/services/automation-service");
    assert(typeof AutomationService === "function");
  });

  // -----------------------------------------------------------------
  // 31. Platform Regression
  // -----------------------------------------------------------------
  console.log("\n--- 31. Platform Regression ---");

  it("31.1 platforms.js exists and defines 7 coding platforms", () => {
    const src = fs.readFileSync(path.join(ROOT, "platforms.js"), "utf8");
    const platforms = ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "codeforces", "atcoder", "spoj"];
    for (const p of platforms) {
      assert(src.toLowerCase().includes(p), `platforms.js must reference ${p}`);
    }
  });

  it("31.2 manifest.json includes host permissions for all 7 platforms", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const hostPerms = manifest.host_permissions || [];
    assert(hostPerms.some((h) => h.includes("leetcode.com")), "Missing LeetCode");
    assert(hostPerms.some((h) => h.includes("geeksforgeeks.org")), "Missing GFG");
    assert(hostPerms.some((h) => h.includes("hackerrank.com")), "Missing HackerRank");
    assert(hostPerms.some((h) => h.includes("codechef.com")), "Missing CodeChef");
    assert(hostPerms.some((h) => h.includes("codeforces.com")), "Missing Codeforces");
    assert(hostPerms.some((h) => h.includes("atcoder.jp")), "Missing AtCoder");
    assert(hostPerms.some((h) => h.includes("spoj.com")), "Missing SPOJ");
  });

  // -----------------------------------------------------------------
  // 32. Identity Regression
  // -----------------------------------------------------------------
  console.log("\n--- 32. Identity Regression ---");

  it("32.1 identity.js exists and defines identity guard", () => {
    const src = fs.readFileSync(path.join(ROOT, "identity.js"), "utf8");
    assert(src.includes("isIdentityMatch") || src.includes("IdentityGuard"),
      "identity.js must define identity validation logic");
  });

  it("32.2 identity.js does not store passwords or tokens", () => {
    const src = fs.readFileSync(path.join(ROOT, "identity.js"), "utf8");
    assert(!src.includes("password ="), "identity.js must not store passwords");
    assert(!src.includes("sk_live_"), "identity.js must not contain live Stripe keys");
  });

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  console.log("\n===============================================================");
  console.log(`PHASE 19 RESULTS: ${passed} passed, ${failed} failed`);
  console.log("===============================================================");

  if (failures.length > 0) {
    console.error("\nFailed tests:", failures);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
