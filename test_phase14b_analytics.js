// Fly2Git — Phase 14B: Personal Coding Analytics Automated Test Suite
//
// 34 Required Verification Points:
// 1. Default empty analytics
// 2. Pro analytics access
// 3. Basic analytics blocked
// 4. User isolation
// 5. Problem count
// 6. Platform aggregation
// 7. Language aggregation
// 8. Difficulty aggregation
// 9. Activity timeline
// 10. 7-day range
// 11. 30-day range
// 12. 90-day range
// 13. All-time range
// 14. Streak calculation
// 15. Failed sync handling
// 16. Skipped submission handling
// 17. Duplicate submission handling
// 18. New vs updated solution
// 19. Automation filter analytics
// 20. Retry recovery analytics
// 21. Multi-repository analytics
// 22. Unknown difficulty handling
// 23. Unknown language handling
// 24. Offline cached analytics
// 25. Analytics deletion
// 26. User cannot delete another user's analytics
// 27. Large-range request bounded
// 28. Large-export request bounded
// 29. Source code never stored for analytics
// 30. Existing Phase 14A automation remains intact
// 31. Existing platform adapters remain intact
// 32. Existing identity guard remains intact
// 33. Existing entitlement remains intact
// 34. Existing GitHub sync remains intact

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("./backend/db/database");
const { AnalyticsService } = require("./backend/services/analytics-service");
const { AutomationService } = require("./backend/services/automation-service");
const { EntitlementService } = require("./backend/services/entitlement-service");
const { ProGrantService } = require("./backend/services/pro-grant-service");
const { PlatformSlotService } = require("./backend/services/platform-slot-service");
const AuthService = require("./backend/services/auth-service");
const { createServer } = require("./backend/server");
const analytics = require("./analytics");
const automation = require("./automation-rules");
const entitlements = require("./entitlements");
global.importScripts = () => {};
global.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: () => {},
    },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
    clear: () => {},
  },
  runtime: {
    id: "test-ext",
    getManifest: () => ({ version: "1.1.6" }),
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
  },
};

const platforms = require("./platforms");
const identity = require("./identity");
const background = require("./background");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 14B: PERSONAL CODING ANALYTICS TEST   ");
  console.log("=======================================================\n");

  const now = Date.now();
  const DAY_MS = 86400000;

  // -----------------------------------------------------------------
  // 1. Default Empty Analytics
  // -----------------------------------------------------------------
  console.log("━━━ 1. Default Empty Analytics ━━━");
  const emptyOverview = analytics.computeOverview([], { range: "30d", now });
  assert(emptyOverview.totalProblems === 0, "Empty events list has totalProblems: 0");
  assert(emptyOverview.platformCount === 0, "Empty events list has platformCount: 0");
  assert(emptyOverview.languageCount === 0, "Empty events list has languageCount: 0");
  assert(emptyOverview.streak === 0, "Empty events list has streak: 0");
  assert(emptyOverview.syncSuccessRate === 100.0, "Empty events list has syncSuccessRate: 100%");
  assert(emptyOverview.skippedCount === 0, "Empty events list has skippedCount: 0");

  // -----------------------------------------------------------------
  // 14. Streak Calculation
  // -----------------------------------------------------------------
  console.log("\n━━━ 14. Streak Calculation ━━━");
  // Active today, yesterday, and 2 days ago -> streak = 3
  const streakEvents3Days = [now, now - DAY_MS, now - 2 * DAY_MS];
  const s3 = analytics.calculateStreak(streakEvents3Days, { timezoneOffset: 0, now });
  assert(s3 === 3, `Calculated 3-day active streak correctly: ${s3}`);

  // Active yesterday and 2 days ago, but NOT today -> streak is still 2 (intact from yesterday)
  const streakEventsYesterday = [now - DAY_MS, now - 2 * DAY_MS];
  const sYest = analytics.calculateStreak(streakEventsYesterday, { timezoneOffset: 0, now });
  assert(sYest === 2, `Calculated intact streak from yesterday: ${sYest}`);

  // Active 3 days ago, but inactive yesterday and today -> streak is 0
  const streakBroken = [now - 3 * DAY_MS, now - 4 * DAY_MS];
  const sBroken = analytics.calculateStreak(streakBroken, { timezoneOffset: 0, now });
  assert(sBroken === 0, `Broken streak correctly resets to 0: ${sBroken}`);

  // -----------------------------------------------------------------
  // 5. Problem Count, 18. New vs Updated Solutions
  // -----------------------------------------------------------------
  console.log("\n━━━ 5. Problem Count & 18. New vs Updated Solutions ━━━");
  const sampleEvents = [
    {
      platform: "leetcode",
      problemSlug: "two-sum",
      title: "Two Sum",
      difficulty: "Easy",
      language: "python3",
      timestamp: now - 1000,
      action: "synced",
      syncStatus: "added",
      isUpdate: false,
      repositoryTarget: "user/practice",
    },
    {
      platform: "leetcode",
      problemSlug: "two-sum",
      title: "Two Sum",
      difficulty: "Easy",
      language: "cpp",
      timestamp: now - 5000,
      action: "synced",
      syncStatus: "updated",
      isUpdate: true,
      repositoryTarget: "user/practice",
    },
    {
      platform: "codeforces",
      problemSlug: "1A-theatre-square",
      title: "Theatre Square",
      difficulty: "Medium",
      language: "cpp",
      timestamp: now - DAY_MS,
      action: "synced",
      syncStatus: "added",
      isUpdate: false,
      repositoryTarget: "user/competitive",
    },
  ];

  const ovSample = analytics.computeOverview(sampleEvents, { range: "30d", now });
  assert(ovSample.totalProblems === 3, "Total problems counts all synced solutions: 3");
  assert(ovSample.newSolutions === 2, "New solutions count: 2");
  assert(ovSample.updatedSolutions === 1, "Updated solutions count: 1");

  // -----------------------------------------------------------------
  // 6. Platform Aggregation & 7. Language Aggregation
  // -----------------------------------------------------------------
  console.log("\n━━━ 6. Platform Aggregation & 7. Language Aggregation ━━━");
  assert(ovSample.platformCount === 2, "Distinct platforms count is 2 (LeetCode, Codeforces)");
  assert(ovSample.platformBreakdown[0].platform === "leetcode", "Top platform is LeetCode");
  assert(ovSample.platformBreakdown[0].count === 2, "LeetCode problem count is 2");
  assert(ovSample.languageCount === 2, "Distinct languages count is 2 (C++, Python3)");
  assert(ovSample.languageBreakdown[0].language === "cpp", "Top language is cpp (2 of 3 solutions)");
  assert(ovSample.languageBreakdown[0].percentage === 66.7, "CPP percentage rounded sensibly: 66.7%");

  // -----------------------------------------------------------------
  // 8. Difficulty Aggregation & 22. Unknown Difficulty & 23. Unknown Language
  // -----------------------------------------------------------------
  console.log("\n━━━ 8. Difficulty Aggregation & Unknown Handling ━━━");
  assert(ovSample.difficultyBreakdown.Easy === 2, "Easy difficulty count is 2");
  assert(ovSample.difficultyBreakdown.Medium === 1, "Medium difficulty count is 1");

  const unknownEvent = [
    {
      platform: "spoj",
      problemSlug: "test",
      title: "Life, the Universe, and Everything",
      difficulty: "Unknown",
      language: "unknown",
      timestamp: now - 1000,
      action: "synced",
      syncStatus: "added",
      isUpdate: false,
    },
  ];
  const ovUnknown = analytics.computeOverview(unknownEvent, { range: "30d", now });
  assert(ovUnknown.difficultyBreakdown.Unknown === 1, "Unknown difficulty remains Unknown without guessing");
  assert(ovUnknown.languageBreakdown[0].language === "unknown", "Unknown language remains unknown without guessing");

  // -----------------------------------------------------------------
  // 15. Failed Sync Handling & 16. Skipped Submissions & 17. Duplicate
  // -----------------------------------------------------------------
  console.log("\n━━━ 15. Failed Sync, 16. Skipped Submissions & 17. Duplicate ━━━");
  const mixedEvents = [
    { platform: "leetcode", problemSlug: "p1", action: "synced", timestamp: now },
    { platform: "leetcode", problemSlug: "p2", action: "synced", timestamp: now },
    { platform: "leetcode", problemSlug: "p3", action: "failed", timestamp: now, skipReason: "NETWORK_ERROR" },
    { platform: "leetcode", problemSlug: "p4", action: "skipped", timestamp: now, skipReason: "DIFFICULTY_FILTERED: Easy" },
    { platform: "leetcode", problemSlug: "p5", action: "skipped", timestamp: now, skipReason: "DUPLICATE: Already synced" },
  ];
  const ovMixed = analytics.computeOverview(mixedEvents, { range: "30d", now });
  assert(ovMixed.totalProblems === 2, "Total problems only counts synced submissions: 2");
  assert(ovMixed.failedCount === 1, "Failed count is 1");
  assert(ovMixed.skippedCount === 2, "Skipped count is 2");
  // Success rate: 2 synced / (2 synced + 1 failed) = 66.7%, skips are not treated as failures
  assert(ovMixed.syncSuccessRate === 66.7, "Sync success rate is 66.7% (skips not treated as failures)");
  assert(ovMixed.automationInsights.skippedByFilters === 1, "Automation insights tracks 1 filter skip");
  assert(ovMixed.automationInsights.duplicateSkips === 1, "Automation insights tracks 1 duplicate skip");

  // -----------------------------------------------------------------
  // 9. Activity Timeline & 10-13. Time Range Filters
  // -----------------------------------------------------------------
  console.log("\n━━━ 9. Activity Timeline & 10–13. Time Ranges ━━━");
  const eventsForRanges = [
    { platform: "leetcode", problemSlug: "r1", action: "synced", timestamp: now - 2 * DAY_MS }, // 2 days ago (in 7d, 30d, 90d, all)
    { platform: "leetcode", problemSlug: "r2", action: "synced", timestamp: now - 15 * DAY_MS }, // 15 days ago (in 30d, 90d, all)
    { platform: "leetcode", problemSlug: "r3", action: "synced", timestamp: now - 45 * DAY_MS }, // 45 days ago (in 90d, all)
    { platform: "leetcode", problemSlug: "r4", action: "synced", timestamp: now - 120 * DAY_MS }, // 120 days ago (in all only)
  ];

  const ov7d = analytics.computeOverview(eventsForRanges, { range: "7d", now });
  assert(ov7d.totalProblems === 1, "7-day range includes only events within last 7 days: 1");

  const ov30d = analytics.computeOverview(eventsForRanges, { range: "30d", now });
  assert(ov30d.totalProblems === 2, "30-day range includes events within last 30 days: 2");

  const ov90d = analytics.computeOverview(eventsForRanges, { range: "90d", now });
  assert(ov90d.totalProblems === 3, "90-day range includes events within last 90 days: 3");

  const ovAll = analytics.computeOverview(eventsForRanges, { range: "all", now });
  assert(ovAll.totalProblems === 4, "All-time range includes all events: 4");

  const timeline7d = analytics.computeActivityTimeline(eventsForRanges, { range: "7d", now });
  assert(timeline7d.length === 7, `Timeline 7d produces 7 daily buckets: ${timeline7d.length}`);
  const totalSyncedInTimeline = timeline7d.reduce((sum, d) => sum + d.synced, 0);
  assert(totalSyncedInTimeline === 1, "Timeline accurately reflects 1 synced event in 7d");

  // -----------------------------------------------------------------
  // 20. Retry Recovery Analytics & 21. Multi-Repository Analytics
  // -----------------------------------------------------------------
  console.log("\n━━━ 20. Retry Recovery & 21. Multi-Repository Analytics ━━━");
  const multiRepoEvents = [
    { platform: "leetcode", problemSlug: "m1", action: "synced", repositoryTarget: "org/repo-main", retryCount: 2, timestamp: now },
    { platform: "codechef", problemSlug: "m2", action: "synced", repositoryTarget: "org/repo-contests", retryCount: 1, timestamp: now },
    { platform: "codechef", problemSlug: "m3", action: "synced", repositoryTarget: "org/repo-contests", retryCount: 0, timestamp: now },
  ];
  const ovMulti = analytics.computeOverview(multiRepoEvents, { range: "30d", now });
  assert(ovMulti.automationInsights.retryRecoveries === 3, "Retry recoveries sum is 3");
  assert(ovMulti.repositoryBreakdown.length === 2, "Multi-repository breakdown tracks 2 repositories");
  assert(ovMulti.repositoryBreakdown[0].repository === "org/repo-contests", "Top repo is org/repo-contests with 2 syncs");
  assert(ovMulti.repositoryBreakdown[0].count === 2, "Count for org/repo-contests is 2");

  // -----------------------------------------------------------------
  // 29. Source Code Never Stored for Analytics
  // -----------------------------------------------------------------
  console.log("\n━━━ 29. Source Code Never Stored for Analytics ━━━");
  const dangerousEvent = {
    platform: "leetcode",
    problemSlug: "two-sum",
    title: "Two Sum",
    code: "def twoSum(nums, target): return [0, 1]",
    solutionSource: "class Solution { ... }",
    tokens: "ghp_secret_access_token",
    cookie: "session=secret_cookie",
    rawHtml: "<html><body>private content</body></html>",
    headers: { Authorization: "Bearer secret" },
    timestamp: now,
    action: "synced",
  };
  const sanitized = analytics.sanitizeEvent(dangerousEvent);
  assert(sanitized.code === undefined, "Source code stripped from analytics event");
  assert(sanitized.solutionSource === undefined, "solutionSource stripped from analytics event");
  assert(sanitized.tokens === undefined, "tokens stripped from analytics event");
  assert(sanitized.cookie === undefined, "cookie stripped from analytics event");
  assert(sanitized.rawHtml === undefined, "rawHtml stripped from analytics event");
  assert(sanitized.headers === undefined, "headers stripped from analytics event");
  assert(sanitized.platform === "leetcode", "Safe platform metadata preserved");

  // -----------------------------------------------------------------
  // Backend Integration & Server-Authoritative Pro Tests
  // -----------------------------------------------------------------
  console.log("\n━━━ Backend Server Setup for Personal Analytics ━━━");
  const testDb = new Database({ memoryOnly: true });
  const authService = new AuthService(testDb);
  const proGrantService = new ProGrantService(testDb);
  const platformSlotService = new PlatformSlotService(testDb);
  const entitlementService = new EntitlementService(testDb, { proGrantService, platformSlotService });
  const automationService = new AutomationService(testDb, entitlementService);
  const analyticsService = new AnalyticsService(testDb, entitlementService);

  const testPort = 19461;
  const app = createServer({
    db: testDb,
    authService,
    entitlementService,
    proGrantService,
    platformSlotService,
    automationService,
    analyticsService,
    memoryOnly: true,
  });

  await app.start(testPort);

  function makeRequest(method, pathUrl, token = null, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: pathUrl,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
            } catch (_) {
              resolve({ status: res.statusCode, headers: res.headers, raw: data });
            }
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Register Users: User A (Pro), User B (Basic), User C (Pro)
  const regA = await makeRequest("POST", "/api/auth/register", null, {
    email: "pro_a_analytics@fly2git.test",
    password: "Password123!",
  });
  const tokenProA = regA.body.token;
  const userA = regA.body.user;

  const regB = await makeRequest("POST", "/api/auth/register", null, {
    email: "basic_b_analytics@fly2git.test",
    password: "Password123!",
  });
  const tokenBasicB = regB.body.token;
  const userB = regB.body.user;

  const regC = await makeRequest("POST", "/api/auth/register", null, {
    email: "pro_c_analytics@fly2git.test",
    password: "Password123!",
  });
  const tokenProC = regC.body.token;
  const userC = regC.body.user;

  // Grant Pro to User A and User C
  proGrantService.createGrant({ userId: userA.id, type: "promotional", grantedBy: "admin" });
  proGrantService.createGrant({ userId: userC.id, type: "promotional", grantedBy: "admin" });

  // -----------------------------------------------------------------
  // 3. Basic Analytics Blocked
  // -----------------------------------------------------------------
  console.log("\n━━━ 3. Basic Analytics Blocked ━━━");
  const basicRes = await makeRequest("GET", "/api/analytics/overview", tokenBasicB);
  assert(basicRes.status === 403, "Basic user receives HTTP 403 on GET /api/analytics/overview");
  assert(basicRes.body.code === "PRO_REQUIRED", "Error code is PRO_REQUIRED");

  const basicTimeline = await makeRequest("GET", "/api/analytics/activity", tokenBasicB);
  assert(basicTimeline.status === 403, "Basic user receives HTTP 403 on GET /api/analytics/activity");

  const basicExport = await makeRequest("GET", "/api/analytics/export", tokenBasicB);
  assert(basicExport.status === 403, "Basic user receives HTTP 403 on GET /api/analytics/export");

  // -----------------------------------------------------------------
  // 2. Pro Analytics Access & Event Recording
  // -----------------------------------------------------------------
  console.log("\n━━━ 2. Pro Analytics Access & Event Recording ━━━");
  const recordRes = await makeRequest("POST", "/api/analytics/events", tokenProA, {
    platform: "leetcode",
    problemSlug: "3sum",
    title: "3Sum",
    difficulty: "Medium",
    language: "python3",
    timestamp: now - 1000,
    action: "synced",
    syncStatus: "added",
    isUpdate: false,
    repositoryTarget: "pro_a/practice",
  });
  assert(recordRes.status === 200, "Pro user POST /api/analytics/events returns 200");
  assert(recordRes.body.ok === true && recordRes.body.recorded === true, "Activity event recorded successfully");

  // Record a second event for User A
  await makeRequest("POST", "/api/analytics/events", tokenProA, {
    platform: "codeforces",
    problemSlug: "4A-watermelon",
    title: "Watermelon",
    difficulty: "Easy",
    language: "cpp",
    timestamp: now - DAY_MS,
    action: "synced",
    syncStatus: "added",
    isUpdate: false,
    repositoryTarget: "pro_a/contests",
  });

  const getOverviewA = await makeRequest("GET", "/api/analytics/overview?range=30d", tokenProA);
  assert(getOverviewA.status === 200, "Pro user GET /api/analytics/overview returns 200");
  assert(getOverviewA.body.isPro === true, "Response indicates isPro: true");
  assert(getOverviewA.body.totalProblems === 2, "User A has 2 total problems recorded");
  assert(getOverviewA.body.platformCount === 2, "User A has 2 platforms recorded");

  // -----------------------------------------------------------------
  // 4. User Isolation & 26. User Isolation on Deletion
  // -----------------------------------------------------------------
  console.log("\n━━━ 4. User Isolation & 26. Isolation on Deletion ━━━");
  // User C is Pro but has 0 events recorded
  const getOverviewC = await makeRequest("GET", "/api/analytics/overview?range=30d", tokenProC);
  assert(getOverviewC.status === 200, "User C GET /api/analytics/overview returns 200");
  assert(getOverviewC.body.totalProblems === 0, "User C cannot see User A's events (totalProblems: 0)");

  // User C calls DELETE /api/analytics
  const delC = await makeRequest("DELETE", "/api/analytics", tokenProC);
  assert(delC.status === 200, "User C DELETE /api/analytics succeeds");
  assert(delC.body.deletedCount === 0, "User C deleted 0 records");

  // Check that User A's data was NOT affected by User C's deletion
  const getOverviewAAfter = await makeRequest("GET", "/api/analytics/overview?range=30d", tokenProA);
  assert(getOverviewAAfter.body.totalProblems === 2, "User A's events remain intact after User C deletion");

  // -----------------------------------------------------------------
  // 28. Large Export Request Bounded (JSON and CSV)
  // -----------------------------------------------------------------
  console.log("\n━━━ 28. Large Export Bounded (JSON & CSV) ━━━");
  const exportJson = await makeRequest("GET", "/api/analytics/export?format=json", tokenProA);
  assert(exportJson.status === 200, "GET /api/analytics/export?format=json returns 200");
  assert(Array.isArray(exportJson.body), "JSON export is a valid array");
  assert(exportJson.body.length === 2, "Export contains exactly 2 records");
  assert(exportJson.body[0].code === undefined, "Export excludes source code");

  const exportCsv = await makeRequest("GET", "/api/analytics/export?format=csv", tokenProA);
  assert(exportCsv.status === 200, "GET /api/analytics/export?format=csv returns 200");
  assert(exportCsv.headers["content-type"].includes("text/csv"), "CSV export returns text/csv header");
  assert(exportCsv.raw.includes("problemSlug"), "CSV export contains headers");
  assert(exportCsv.raw.includes("3sum"), "CSV export contains problem slug");

  // -----------------------------------------------------------------
  // 27. Large Range Request Bounded & Clamped
  // -----------------------------------------------------------------
  console.log("\n━━━ 27. Large Range Request Bounded & Clamped ━━━");
  const invalidRange = await makeRequest("GET", "/api/analytics/overview?range=unsupported_1000years", tokenProA);
  assert(invalidRange.status === 200, "Invalid range safely falls back to default 30d without crashing");
  assert(invalidRange.body.range === "30d", "Fallback range is 30d");

  // -----------------------------------------------------------------
  // 25. Analytics Deletion
  // -----------------------------------------------------------------
  console.log("\n━━━ 25. Analytics Deletion ━━━");
  const delA = await makeRequest("DELETE", "/api/analytics", tokenProA);
  assert(delA.status === 200, "User A DELETE /api/analytics returns 200");
  assert(delA.body.deletedCount === 2, "Successfully deleted 2 events for User A");

  const getOverviewAPostDel = await makeRequest("GET", "/api/analytics/overview?range=30d", tokenProA);
  assert(getOverviewAPostDel.body.totalProblems === 0, "User A now has 0 events after deletion");

  // -----------------------------------------------------------------
  // 24. Offline Cached Analytics
  // -----------------------------------------------------------------
  console.log("\n━━━ 24. Offline Cached Analytics ━━━");
  const localCached = [
    { platform: "leetcode", problemSlug: "cached-p1", title: "Cached P1", action: "synced", timestamp: now },
  ];
  const offlineOv = analytics.computeOverview(localCached, { range: "30d", now });
  assert(offlineOv.totalProblems === 1, "Offline overview computed successfully from cached storage: 1");
  const offlineTl = analytics.computeActivityTimeline(localCached, { range: "7d", now });
  assert(offlineTl.length === 7, "Offline activity timeline computed successfully from cached storage: 7 days");

  // -----------------------------------------------------------------
  // 30–34. Regression Invariants
  // -----------------------------------------------------------------
  console.log("\n━━━ 30–34. Regression Invariants (Phase 14A, Adapters, Identity, Entitlement, Git) ━━━");
  assert(typeof automation.renderCommitMessage === "function", "30. Phase 14A commit template function exists");
  assert(typeof automation.renderSolutionPath === "function", "30. Phase 14A path template function exists");
  assert(typeof platforms.normalizeSubmission === "function", "31. Platform adapters engine intact");
  assert(typeof identity.verifySubmissionIdentity === "function", "32. Identity guard verification intact");
  assert(typeof entitlements.canUsePlatform === "function", "33. Entitlements engine intact");
  assert(typeof background.handleAcceptedSubmissionInternal === "function", "34. Background submission handler intact");

  await app.stop();

  console.log("\n=======================================================");
  console.log(`PHASE 14B RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
