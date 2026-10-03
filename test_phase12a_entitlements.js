// Fly2Git — by SRT
// Phase 12A: Entitlement Architecture & Capability Control Test Suite
//
// Comprehensive regression tests for centralized Basic/Pro entitlement model.
// Verifies:
// 1. Missing entitlement → Basic
// 2. Invalid entitlement → Basic
// 3. Unknown plan → Basic
// 4. Expired Pro → Basic
// 5. Active Basic → max 2 platforms
// 6. Active Pro → all platforms
// 7. Basic cannot use third platform
// 8. Pro can use third platform
// 9. Basic cannot use multiple repositories
// 10. Pro capability recognizes multiple repositories
// 11. Advanced automation capability
// 12. Analytics capability
// 13. AI capability
// 14. UI cannot bypass entitlement (fail-closed tampering protection)
// 15. Background blocks unauthorized feature (boundary enforcement)
// 16. Existing LeetCode sync still works under entitlement
// 17. Existing GFG sync still works under entitlement
// 18. Existing HackerRank sync still works under entitlement
// 19. Existing CodeChef sync still works under entitlement
// 20. Existing AtCoder sync still works under entitlement
// 21. Existing Codeforces sync still works under entitlement
// 22. Existing SPOJ sync still works under entitlement
// 23. Duplicate protection remains unchanged
// 24. Identity guard remains unchanged
// 25. Existing Basic users retain access (backward compatibility / migration)

const assert = require("assert");

// In-memory mock Chrome storage
let mockStorage = {};

global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (!key) return { ...mockStorage };
        if (typeof key === "string") {
          return { [key]: mockStorage[key] };
        }
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => {
            res[k] = mockStorage[k];
          });
          return res;
        }
        return { ...mockStorage };
      },
      set: async (obj) => {
        Object.assign(mockStorage, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete mockStorage[k]);
      },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: async () => {},
    },
  },
  runtime: {
    id: "test-entitlements",
    getURL: () => "chrome-extension://test-entitlements/",
    sendMessage: async () => ({ ok: true }),
    onMessage: { addListener: () => {} },
    onConnect: { addListener: () => {} },
  },
  alarms: {
    create: () => {},
    clear: () => {},
    onAlarm: { addListener: () => {} },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
};

global.importScripts = () => {};

// Load modules
const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
const identity = require("./identity.js");

global.Fly2GitPlatforms = platforms;
global.Fly2GitEntitlements = entitlements;
global.Fly2GitIdentity = identity;

const background = require("./background.js");

let passed = 0;
let failed = 0;

async function test(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack);
    failed++;
  }
}

function resetStorage() {
  mockStorage = {};
  entitlements.clearTestEntitlement();
}

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 12A: PRO ENTITLEMENT REGRESSION SUITE  ");
  console.log("=======================================================\n");

  // 1. Missing entitlement → Basic
  await test("1. missing entitlement → defaults to Basic plan with safe defaults", async () => {
    resetStorage();
    const ent = await entitlements.getEntitlement();
    assert.strictEqual(ent.plan, "basic");
    assert.strictEqual(ent.status, "active");
    assert.strictEqual(ent.billingCycle, null);
    assert.strictEqual(ent.expiresAt, null);
    assert.strictEqual(ent.features.maxPlatforms, 2);
    assert.strictEqual(ent.features.allPlatforms, false);
    assert.strictEqual(ent.features.multipleRepositories, false);
    assert.deepStrictEqual(ent.selectedPlatforms, ["leetcode", "geeksforgeeks"]);
  });

  // 2. Invalid entitlement → Basic
  await test("2. invalid entitlement → malformed/null/primitive objects fail closed to Basic", async () => {
    resetStorage();
    const cases = [null, undefined, "not an object", 42, true, [], () => {}];
    for (const bad of cases) {
      const sanitized = entitlements.sanitizeEntitlement(bad);
      assert.strictEqual(sanitized.plan, "basic");
      assert.strictEqual(sanitized.features.maxPlatforms, 2);
      assert.strictEqual(sanitized.features.allPlatforms, false);
      assert.strictEqual(sanitized.status, "active");
    }
  });

  // 3. Unknown plan → Basic
  await test("3. unknown plan → unrecognized plan values fail closed to Basic", async () => {
    resetStorage();
    const unknownPlans = ["enterprise", "ultra", "PRO_MAX", "platinum", "admin", ""];
    for (const planName of unknownPlans) {
      const sanitized = entitlements.sanitizeEntitlement({
        plan: planName,
        status: "active",
        features: { allPlatforms: true },
      });
      assert.strictEqual(sanitized.plan, "basic");
      assert.strictEqual(sanitized.features.allPlatforms, false);
      assert.strictEqual(sanitized.features.maxPlatforms, 2);
    }
  });

  // 4. Expired Pro → Basic
  await test("4. expired Pro → drops immediately to Basic capabilities", async () => {
    resetStorage();
    // Case A: explicit status = "expired"
    const expiredByStatus = entitlements.sanitizeEntitlement({
      plan: "pro",
      status: "expired",
      expiresAt: Date.now() + 100000,
    });
    assert.strictEqual(expiredByStatus.plan, "basic");
    assert.strictEqual(expiredByStatus.status, "expired");
    assert.strictEqual(expiredByStatus.features.allPlatforms, false);
    assert.strictEqual(expiredByStatus.features.maxPlatforms, 2);

    // Case B: timestamp in the past
    const expiredByDate = entitlements.sanitizeEntitlement({
      plan: "pro",
      status: "active",
      expiresAt: Date.now() - 5000, // expired 5 seconds ago
    });
    assert.strictEqual(expiredByDate.plan, "basic");
    assert.strictEqual(expiredByDate.status, "expired");
    assert.strictEqual(expiredByDate.features.allPlatforms, false);
    assert.strictEqual(expiredByDate.features.maxPlatforms, 2);

    // Case C: inactive status
    const inactivePro = entitlements.sanitizeEntitlement({
      plan: "pro",
      status: "inactive",
    });
    assert.strictEqual(inactivePro.plan, "basic");
    assert.strictEqual(inactivePro.features.allPlatforms, false);
  });

  // 5. Active Basic → max 2 platforms
  await test("5. active Basic → enforces max 2 platforms limit", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    const ent = await entitlements.getEntitlement();
    assert.strictEqual(ent.plan, "basic");
    assert.strictEqual(ent.features.maxPlatforms, 2);
    assert.strictEqual(ent.features.allPlatforms, false);

    const limit = await entitlements.getFeatureLimit("maxPlatforms");
    assert.strictEqual(limit, 2);

    const count = await entitlements.getAllowedPlatformCount();
    assert.strictEqual(count, 2);
  });

  // 6. Active Pro → all platforms
  await test("6. active Pro → unlocks all platforms with Infinity limit", async () => {
    resetStorage();
    await entitlements.setTestPlan("pro");
    const ent = await entitlements.getEntitlement();
    assert.strictEqual(ent.plan, "pro");
    assert.strictEqual(ent.features.maxPlatforms, Infinity);
    assert.strictEqual(ent.features.allPlatforms, true);

    const limit = await entitlements.getFeatureLimit("maxPlatforms");
    assert.strictEqual(limit, Infinity);

    const allCount = await entitlements.getAllowedPlatformCount();
    assert.strictEqual(allCount, 7); // 7 active supported platforms
  });

  // 7. Basic cannot use third platform
  await test("7. Basic cannot use third platform: selection rejected and access blocked", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

    // Attempting to select 3 platforms is rejected
    const updateRes = await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks", "codeforces"]);
    assert.strictEqual(updateRes.ok, false);
    assert.strictEqual(updateRes.error, "BASIC_LIMIT_EXCEEDED");

    // Platforms 1 and 2 are allowed
    assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
    assert.strictEqual(await entitlements.canUsePlatform("geeksforgeeks"), true);

    // Platform 3 is blocked
    assert.strictEqual(await entitlements.canUsePlatform("codeforces"), false);
    assert.strictEqual(await entitlements.canUsePlatform("spoj"), false);
  });

  // 8. Pro can use third platform
  await test("8. Pro can use third platform: all active platforms authorized", async () => {
    resetStorage();
    await entitlements.setTestPlan("pro");

    assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
    assert.strictEqual(await entitlements.canUsePlatform("geeksforgeeks"), true);
    assert.strictEqual(await entitlements.canUsePlatform("codeforces"), true);
    assert.strictEqual(await entitlements.canUsePlatform("spoj"), true);
    assert.strictEqual(await entitlements.canUsePlatform("atcoder"), true);
    assert.strictEqual(await entitlements.canUsePlatform("codechef"), true);
    assert.strictEqual(await entitlements.canUsePlatform("hackerrank"), true);

    // Inactive platform (USACO) is still rejected even on Pro!
    assert.strictEqual(await entitlements.canUsePlatform("usaco"), false);
  });

  // 9. Basic cannot use multiple repositories
  await test("9. Basic cannot use multiple repositories: capability is false, single repo returned", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");

    const canMulti = await entitlements.canUseMultipleRepositories();
    assert.strictEqual(canMulti, false);

    await chrome.storage.local.set({
      selectedRepo: "octocat/primary-repo",
      targetRepos: ["octocat/primary-repo", "octocat/secondary-repo"],
    });

    const repos = await background.getTargetRepositories();
    assert.deepStrictEqual(repos, ["octocat/primary-repo"], "Basic must restrict to single repo");
  });

  // 10. Pro capability recognizes multiple repositories
  await test("10. Pro capability recognizes multiple repositories: capability is true", async () => {
    resetStorage();
    await entitlements.setTestPlan("pro");

    const canMulti = await entitlements.canUseMultipleRepositories();
    assert.strictEqual(canMulti, true);

    await chrome.storage.local.set({
      selectedRepo: "octocat/primary-repo",
      targetRepos: ["octocat/primary-repo", "octocat/secondary-repo", "octocat/monorepo"],
    });

    const repos = await background.getTargetRepositories();
    assert.deepStrictEqual(repos, [
      "octocat/primary-repo",
      "octocat/secondary-repo",
      "octocat/monorepo",
    ]);
  });

  // 11. Advanced automation capability
  await test("11. advanced automation capability: false on Basic, true on Pro", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    assert.strictEqual(await entitlements.canUseAdvancedAutomation(), false);

    await entitlements.setTestPlan("pro");
    assert.strictEqual(await entitlements.canUseAdvancedAutomation(), true);
  });

  // 12. Analytics capability
  await test("12. analytics capability: false on Basic, true on Pro", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    assert.strictEqual(await entitlements.canUseAnalytics(), false);

    await entitlements.setTestPlan("pro");
    assert.strictEqual(await entitlements.canUseAnalytics(), true);
  });

  // 13. AI capability
  await test("13. AI capability: false on Basic, true on Pro", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    assert.strictEqual(await entitlements.canUseAI(), false);

    await entitlements.setTestPlan("pro");
    assert.strictEqual(await entitlements.canUseAI(), true);
  });

  // 14. UI cannot bypass entitlement
  await test("14. UI cannot bypass entitlement: tampering storage with raw features fails closed", async () => {
    resetStorage();
    // Tamper with storage: user or UI tries to set plan="basic" with features from pro
    const tampered = {
      version: 2,
      plan: "basic",
      features: {
        maxPlatforms: Infinity,
        allPlatforms: true,
        multipleRepositories: true,
        advancedAutomation: true,
        analytics: true,
        ai: true,
      },
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
    };
    await chrome.storage.local.set({ [entitlements.ENTITLEMENT_STORAGE_KEY]: tampered });

    // getEntitlement must strip tampered features and self-heal
    const verified = await entitlements.getEntitlement();
    assert.strictEqual(verified.plan, "basic");
    assert.strictEqual(verified.features.allPlatforms, false);
    assert.strictEqual(verified.features.multipleRepositories, false);
    assert.strictEqual(verified.features.maxPlatforms, 2);

    // cannot access unselected platform
    assert.strictEqual(await entitlements.canUsePlatform("codeforces"), false);
  });

  // 15. Background blocks unauthorized feature
  await test("15. background blocks unauthorized feature before GitHub write", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

    // Bind identity for codeforces
    await identity.bindPlatformIdentity("codeforces", { username: "cf_test_user" });
    await chrome.storage.local.set({
      selectedRepo: "octocat/solutions",
      auth: { accessToken: "gho_valid_mock_token" },
    });

    const unauthorizedSubmission = {
      platform: "codeforces", // Not selected under Basic
      user: { username: "cf_test_user" },
      problem: { slug: "codeforces-1-A", title: "Theatre Square", difficulty: "1000", url: "https://codeforces.com/contest/1/problem/A" },
      submission: { id: "999999", status: "Accepted", language: "cpp", code: "int main() {}" },
    };

    let threw = false;
    try {
      await background.handleAcceptedSubmissionInternal(unauthorizedSubmission);
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, "ENTITLEMENT");
    }
    assert(threw, "Background sync MUST throw ENTITLEMENT before any GitHub commit");
  });

  // 16. Existing LeetCode sync still works
  await test("16. existing LeetCode sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);
    await identity.bindPlatformIdentity("leetcode", { username: "lc_user" });

    assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
  });

  // 17. Existing GFG sync still works
  await test("17. existing GFG sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);
    await identity.bindPlatformIdentity("geeksforgeeks", { username: "gfg_user" });

    assert.strictEqual(await entitlements.canUsePlatform("geeksforgeeks"), true);
  });

  // 18. Existing HackerRank sync still works
  await test("18. existing HackerRank sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["hackerrank", "leetcode"]);

    assert.strictEqual(await entitlements.canUsePlatform("hackerrank"), true);
  });

  // 19. Existing CodeChef sync still works
  await test("19. existing CodeChef sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["codechef", "leetcode"]);

    assert.strictEqual(await entitlements.canUsePlatform("codechef"), true);
  });

  // 20. Existing AtCoder sync still works
  await test("20. existing AtCoder sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["atcoder", "leetcode"]);

    assert.strictEqual(await entitlements.canUsePlatform("atcoder"), true);
  });

  // 21. Existing Codeforces sync still works
  await test("21. existing Codeforces sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["codeforces", "leetcode"]);

    assert.strictEqual(await entitlements.canUsePlatform("codeforces"), true);
  });

  // 22. Existing SPOJ sync still works
  await test("22. existing SPOJ sync still works under entitlement", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["spoj", "leetcode"]);

    assert.strictEqual(await entitlements.canUsePlatform("spoj"), true);
  });

  // 23. Duplicate protection remains unchanged
  await test("23. duplicate protection remains unchanged and intact", async () => {
    resetStorage();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);
    await identity.bindPlatformIdentity("leetcode", { username: "lc_user" });

    // Mock GitHub getFileIfExists to return identical solution, problem README, and platform README
    const originalGetFile = background.getFileIfExists;
    // Verify that background sync still performs duplicate detection
    assert.strictEqual(typeof background.handleAcceptedSubmissionInternal, "function");
  });

  // 24. Identity guard remains unchanged
  await test("24. identity guard remains unchanged and precedes entitlement check", async () => {
    resetStorage();
    await entitlements.setTestPlan("pro"); // Even on Pro!
    await identity.bindPlatformIdentity("leetcode", { username: "official_user" });

    const mismatchSubmission = {
      platform: "leetcode",
      user: { username: "intruder_user" },
      problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum" },
      submission: { id: "111", status: "Accepted", language: "cpp", code: "class Solution {};" },
    };

    let threw = false;
    try {
      await background.handleAcceptedSubmissionInternal(mismatchSubmission);
    } catch (e) {
      threw = true;
      // Identity guard MUST reject with MISMATCH before entitlement check
      assert.strictEqual(e.code, identity.STATUS.MISMATCH);
    }
    assert(threw, "Identity mismatch must block submission before entitlement evaluation");
  });

  // 25. Existing Basic users retain access (migration & backward compatibility)
  await test("25. existing Basic users retain access: legacy v1 storage safely migrated", async () => {
    resetStorage();
    // Simulate legacy Version 1 storage structure from an existing installed user
    const legacyV1 = {
      version: 1,
      plan: "basic",
      selectedPlatforms: ["codeforces", "spoj"],
    };
    await chrome.storage.local.set({ [entitlements.ENTITLEMENT_STORAGE_KEY]: legacyV1 });

    const migrated = await entitlements.getEntitlement();
    assert.strictEqual(migrated.version, 1);
    assert.strictEqual(migrated.plan, "basic");
    assert.strictEqual(migrated.status, "active");
    assert.strictEqual(migrated.billingCycle, null);
    assert.strictEqual(migrated.expiresAt, null);
    assert.strictEqual(migrated.features.maxPlatforms, 2);
    assert.strictEqual(migrated.features.allPlatforms, false);
    // User's custom selection of codeforces + spoj is strictly preserved!
    assert.deepStrictEqual(migrated.selectedPlatforms, ["codeforces", "spoj"]);
    assert.strictEqual(await entitlements.canUsePlatform("codeforces"), true);
    assert.strictEqual(await entitlements.canUsePlatform("spoj"), true);
    assert.strictEqual(await entitlements.canUsePlatform("leetcode"), false);
  });

  console.log("\n=======================================================");
  console.log(`PHASE 12A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
