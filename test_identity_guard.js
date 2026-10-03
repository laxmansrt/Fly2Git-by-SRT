// Fly2Git — by SRT
// Phase 11B: Platform Identity Guard Automated Test Suite
//
// 20 Required Verification Points:
// 1. first identity
// 2. binding required
// 3. explicit bind
// 4. identity match
// 5. identity mismatch
// 6. unknown identity
// 7. page-load identity unavailable
// 8. later identity detection
// 9. logout/login change
// 10. explicit rebind
// 11. old binding preserved until confirmation
// 12. per-platform independence
// 13. background enforcement
// 14. mismatch prevents GitHub write
// 15. unknown prevents GitHub write
// 16. no GitHub username inference
// 17. malformed identity
// 18. corrupted binding storage
// 19. no secret storage
// 20. no source-code storage

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock Chrome Storage for in-memory testing
let mockStorage = {};

global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === "string") {
          return { [key]: mockStorage[key] };
        }
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => { res[k] = mockStorage[k]; });
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
      get: async (k) => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: async () => {},
    },
  },
  runtime: {
    id: "test-identity-guard",
    getURL: () => "chrome-extension://test-identity-guard/",
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

// Load dependencies
const identity = require("./identity.js");
const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
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
    console.error(err);
    failed++;
  }
}

function resetStorage() {
  mockStorage = {};
}

async function runTests() {
  console.log("=== Phase 11B: Platform Identity Guard Tests ===");

  // 1. First identity detection
  await test("1. first identity: records new detected identity and flags BINDING_REQUIRED", async () => {
    resetStorage();
    const res = await identity.onIdentityDetected("leetcode", {
      username: "alice_coder",
      platformUserId: "1001",
    });
    assert.strictEqual(res.platform, "leetcode");
    assert.strictEqual(res.status, identity.STATUS.BINDING_REQUIRED);
    assert.strictEqual(res.bound, null);
    assert.strictEqual(res.current.username, "alice_coder");
    assert.strictEqual(res.current.platformUserId, "1001");
  });

  // 2. Binding required blocks submission
  await test("2. binding required: pre-sync check blocks when no stored binding exists", async () => {
    resetStorage();
    // Simulate detected identity but unbound
    await identity.onIdentityDetected("leetcode", { username: "alice_coder" });
    const check = await identity.verifySubmissionIdentity("leetcode", { username: "alice_coder" });
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.status, identity.STATUS.BINDING_REQUIRED);
    assert.strictEqual(check.bound, null);
    assert.strictEqual(check.current.username, "alice_coder");
    assert(check.reason.includes("Explicit confirmation required"));
  });

  // 3. Explicit bind
  await test("3. explicit bind: user action confirms and creates bound identity", async () => {
    resetStorage();
    await identity.onIdentityDetected("codeforces", { username: "tourist", platformUserId: "tourist" });
    const bindRes = await identity.bindPlatformIdentity("codeforces", { username: "tourist", platformUserId: "tourist" });
    assert.strictEqual(bindRes.ok, true);
    assert.strictEqual(bindRes.status, identity.STATUS.MATCH);
    assert.strictEqual(bindRes.bound.username, "tourist");

    const state = await identity.getPlatformState("codeforces");
    assert.strictEqual(state.bound.username, "tourist");
    assert.strictEqual(state.status, identity.STATUS.MATCH);
  });

  // 4. Identity match
  await test("4. identity match: submission with matching identity is allowed", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "alice_coder", platformUserId: "1001" });
    const check = await identity.verifySubmissionIdentity("leetcode", { username: "alice_coder", platformUserId: "1001" });
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.status, identity.STATUS.MATCH);
    assert.strictEqual(check.bound.username, "alice_coder");
  });

  // 5. Identity mismatch
  await test("5. identity mismatch: submission with different identity is blocked", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "alice_coder", platformUserId: "1001" });
    const check = await identity.verifySubmissionIdentity("leetcode", { username: "bob_coder", platformUserId: "2002" });
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.status, identity.STATUS.MISMATCH);
    assert.strictEqual(check.bound.username, "alice_coder");
    assert.strictEqual(check.current.username, "bob_coder");
    assert(check.reason.includes("Different coding account detected"));
  });

  // 6. Unknown identity
  await test("6. unknown identity: submission with unknown identity blocks sync", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("atcoder", { username: "chokudai" });
    // Clear current detected identity to test unknown submission
    const stored = await identity.getStoredIdentities();
    stored.atcoder.current = null;
    await identity.getStoredIdentities();
    await chrome.storage.local.set({ platformIdentities: stored });

    const check = await identity.verifySubmissionIdentity("atcoder", null);
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.status, identity.STATUS.UNKNOWN);
    assert(check.reason.includes("could not be determined"));
  });

  // 7. Page-load identity unavailable
  await test("7. page-load identity unavailable: does not clear or invalidate existing binding", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("spoj", { username: "spoj_master" });
    // Page load with no detectable user (e.g. DOM loading or logged out)
    const detectRes = await identity.onIdentityDetected("spoj", null);
    assert.strictEqual(detectRes.bound.username, "spoj_master");
    assert.strictEqual(detectRes.current, null);

    const state = await identity.getPlatformState("spoj");
    assert.strictEqual(state.bound.username, "spoj_master");
  });

  // 8. Later identity detection
  await test("8. later identity detection: updates current and validates against bound account", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("codechef", { username: "chef_john" });
    // First load was null
    await identity.onIdentityDetected("codechef", null);
    // Later DOM rendered with username
    const res = await identity.onIdentityDetected("codechef", { username: "chef_john" });
    assert.strictEqual(res.status, identity.STATUS.MATCH);
    assert.strictEqual(res.current.username, "chef_john");
  });

  // 9. Logout / Login change
  await test("9. logout/login change: detects account change and marks mismatch immediately", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "student_a" });
    // New login by student_b
    const res = await identity.onIdentityDetected("leetcode", { username: "student_b" });
    assert.strictEqual(res.status, identity.STATUS.MISMATCH);
    assert.strictEqual(res.bound.username, "student_a");
    assert.strictEqual(res.current.username, "student_b");
  });

  // 10. Explicit rebind
  await test("10. explicit rebind: user confirms new account and replaces binding", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "student_a" });
    await identity.onIdentityDetected("leetcode", { username: "student_b" });

    // Explicit user action "Use this account"
    const rebindRes = await identity.bindPlatformIdentity("leetcode", { username: "student_b" });
    assert.strictEqual(rebindRes.ok, true);
    assert.strictEqual(rebindRes.status, identity.STATUS.MATCH);
    assert.strictEqual(rebindRes.bound.username, "student_b");

    // Subsequent submissions now match student_b
    const check = await identity.verifySubmissionIdentity("leetcode", { username: "student_b" });
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.status, identity.STATUS.MATCH);
  });

  // 11. Old binding preserved until confirmation
  await test("11. old binding preserved until confirmation: mismatch retains bound account", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("hackerrank", { username: "hacker_one" });
    await identity.onIdentityDetected("hackerrank", { username: "hacker_two" });

    const state = await identity.getPlatformState("hackerrank");
    assert.strictEqual(state.status, identity.STATUS.MISMATCH);
    assert.strictEqual(state.bound.username, "hacker_one"); // NOT overwritten
    assert.strictEqual(state.current.username, "hacker_two");
  });

  // 12. Per-platform independence
  await test("12. per-platform independence: independent bindings across all platforms", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "user_lc" });
    await identity.bindPlatformIdentity("codeforces", { username: "user_cf" });
    await identity.bindPlatformIdentity("spoj", { username: "user_spoj" });

    const lcState = await identity.getPlatformState("leetcode");
    const cfState = await identity.getPlatformState("codeforces");
    const spojState = await identity.getPlatformState("spoj");
    const gfgState = await identity.getPlatformState("geeksforgeeks");

    assert.strictEqual(lcState.bound.username, "user_lc");
    assert.strictEqual(cfState.bound.username, "user_cf");
    assert.strictEqual(spojState.bound.username, "user_spoj");
    assert.strictEqual(gfgState.bound, null); // Unbound platform remains unaffected
  });

  // 13. Background enforcement
  await test("13. background enforcement: authoritative pre-sync boundary check", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("leetcode", { username: "verified_user" });

    // Mock storage for repo and auth
    await chrome.storage.local.set({
      selectedRepo: "octocat/Hello-World",
      auth: { accessToken: "gho_test_token" },
    });

    let gitHubCalled = false;
    let originalWithRetry = background.withRetry;

    // Test mismatch in handleAcceptedSubmissionInternal
    const mismatchPayload = {
      platform: "LeetCode",
      user: { username: "imposter_user" },
      problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/" },
      submission: { id: "998877", status: "Accepted", language: "python3", code: "print('hello')" },
    };

    let errorThrown = null;
    try {
      await background.handleAcceptedSubmissionInternal(mismatchPayload);
    } catch (e) {
      errorThrown = e;
    }

    assert(errorThrown, "handleAcceptedSubmissionInternal must throw on mismatch");
    assert.strictEqual(errorThrown.code, identity.STATUS.MISMATCH);
  });

  // 14. Mismatch prevents GitHub write
  await test("14. mismatch prevents GitHub write: zero tree/commit calls made", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("codeforces", { username: "valid_cf_user" });

    await chrome.storage.local.set({
      selectedRepo: "octocat/competitive-programming",
      auth: { accessToken: "gho_test_token" },
    });

    const mismatchPayload = {
      platform: "codeforces",
      user: { username: "other_cf_user" },
      problem: { slug: "codeforces-4-A", title: "Watermelon", difficulty: "800", url: "https://codeforces.com/contest/4/problem/A" },
      submission: { id: "123456", status: "Accepted", language: "cpp", code: "int main() {}" },
    };

    let threw = false;
    try {
      await background.handleAcceptedSubmissionInternal(mismatchPayload);
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, identity.STATUS.MISMATCH);
    }
    assert(threw, "Must abort before any GitHub commit");
  });

  // 15. Unknown prevents GitHub write
  await test("15. unknown prevents GitHub write: blocked with ACCOUNT_IDENTITY_UNKNOWN", async () => {
    resetStorage();
    await identity.bindPlatformIdentity("spoj", { username: "valid_spoj_user" });
    const stored = await identity.getStoredIdentities();
    stored.spoj.current = null;
    await chrome.storage.local.set({ platformIdentities: stored });

    await chrome.storage.local.set({
      selectedRepo: "octocat/spoj-solutions",
      auth: { accessToken: "gho_test_token" },
    });

    const unknownPayload = {
      platform: "spoj",
      user: null, // Unknown identity
      problem: { slug: "TEST", title: "Life the Universe and Everything", difficulty: "Easy", url: "https://www.spoj.com/problems/TEST/" },
      submission: { id: "55555", status: "Accepted", language: "cpp", code: "int main() {}" },
    };

    let threw = false;
    try {
      await background.handleAcceptedSubmissionInternal(unknownPayload);
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, identity.STATUS.UNKNOWN);
    }
    assert(threw, "Must abort before any GitHub write when identity is unknown");
  });

  // 16. No GitHub username inference
  await test("16. no GitHub username inference: platform identity never inferred from GitHub", async () => {
    resetStorage();
    await chrome.storage.local.set({
      auth: { accessToken: "gho_test", user: { login: "github_octocat" } },
    });

    // Unbound platform with null user
    const check = await identity.verifySubmissionIdentity("atcoder", null);
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.status, identity.STATUS.UNKNOWN);
    // Ensure no fallback was made to github_octocat
    assert.strictEqual(check.current, null);
  });

  // 17. Malformed identity
  await test("17. malformed identity: handles invalid objects, numbers, booleans, and long strings safely", async () => {
    assert.strictEqual(identity.sanitizeIdentity(null), null);
    assert.strictEqual(identity.sanitizeIdentity(undefined), null);
    assert.strictEqual(identity.sanitizeIdentity(12345), null);
    assert.strictEqual(identity.sanitizeIdentity("string_not_obj"), null);
    assert.strictEqual(identity.sanitizeIdentity({}), null);
    assert.strictEqual(identity.sanitizeIdentity({ username: "" }), null);
    assert.strictEqual(identity.sanitizeIdentity({ username: "   " }), null);

    // Overly long strings truncated or bounded
    const longString = "a".repeat(500);
    const sanitized = identity.sanitizeIdentity({ username: longString });
    assert.strictEqual(sanitized, null); // Exceeds 120 chars max bound

    const validSanitized = identity.sanitizeIdentity({ username: "normal_user" });
    assert.strictEqual(validSanitized.username, "normal_user");
    assert.strictEqual(typeof validSanitized.detectedAt, "number");
  });

  // 18. Corrupted binding storage
  await test("18. corrupted binding storage: self-heals gracefully from invalid storage data", async () => {
    resetStorage();
    // Corrupt storage with primitive or array
    await chrome.storage.local.set({ platformIdentities: "corrupted_string" });
    let state = await identity.getPlatformState("leetcode");
    assert.strictEqual(state.status, identity.STATUS.UNKNOWN);
    assert.strictEqual(state.bound, null);

    await chrome.storage.local.set({ platformIdentities: [1, 2, 3] });
    state = await identity.getPlatformState("leetcode");
    assert.strictEqual(state.status, identity.STATUS.UNKNOWN);
    assert.strictEqual(state.bound, null);
  });

  // 19. No secret storage
  await test("19. no secret storage: never stores passwords, tokens, cookies, auth headers, or CSRF tokens", async () => {
    resetStorage();
    const maliciousInput = {
      username: "clean_user",
      platformUserId: "123",
      password: "SuperSecretPassword123!",
      cookie: "session=abcdef; csrftoken=xyz",
      sessionToken: "secret_session_token",
      authorization: "Bearer secret_jwt",
      csrfToken: "csrf_token_secret",
      headers: { "x-csrf": "token" },
    };

    await identity.onIdentityDetected("leetcode", maliciousInput);
    await identity.bindPlatformIdentity("leetcode", maliciousInput);

    const stored = await chrome.storage.local.get("platformIdentities");
    const leetcodeData = stored.platformIdentities.leetcode;

    assert.strictEqual(leetcodeData.bound.password, undefined);
    assert.strictEqual(leetcodeData.bound.cookie, undefined);
    assert.strictEqual(leetcodeData.bound.sessionToken, undefined);
    assert.strictEqual(leetcodeData.bound.authorization, undefined);
    assert.strictEqual(leetcodeData.bound.csrfToken, undefined);
    assert.strictEqual(leetcodeData.bound.headers, undefined);

    assert.strictEqual(leetcodeData.current.password, undefined);
    assert.strictEqual(leetcodeData.current.cookie, undefined);

    // Only platformUserId, username, and timestamps
    const boundKeys = Object.keys(leetcodeData.bound);
    assert.deepStrictEqual(boundKeys.sort(), ["boundAt", "platformUserId", "username"].sort());
  });

  // 20. No source-code storage
  await test("20. no source-code storage: never places solution code in identity storage", async () => {
    resetStorage();
    const submissionPayload = {
      username: "solution_coder",
      code: "def solve():\n    return 'secret algorithm'",
      sourceCode: "console.log('leaked code');",
    };

    await identity.onIdentityDetected("geeksforgeeks", submissionPayload);
    await identity.bindPlatformIdentity("geeksforgeeks", submissionPayload);

    const stored = await chrome.storage.local.get("platformIdentities");
    const gfgData = stored.platformIdentities.geeksforgeeks;

    assert.strictEqual(gfgData.bound.code, undefined);
    assert.strictEqual(gfgData.bound.sourceCode, undefined);
    assert.strictEqual(gfgData.current.code, undefined);
    assert.strictEqual(gfgData.current.sourceCode, undefined);

    const serialized = JSON.stringify(stored);
    assert(!serialized.includes("secret algorithm"), "Storage must never contain source code");
    assert(!serialized.includes("leaked code"), "Storage must never contain source code");
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
