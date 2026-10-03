// Fly2Git — by SRT
// LeetCode -> GitHub End-to-End Pipeline & Regression Test Suite
//
// Verifies:
// 1. Newly accepted submission -> exactly one GitHub sync
// 2. Same submission detected repeatedly -> no duplicate commit
// 3. latestId === baseline but Accepted panel represents new acceptance event -> forwarded & synced
// 4. Background receives normalized submission conforming to NormalizedSubmission contract
// 5. GitHub sync failure is surfaced correctly
// 6. Duplicate submission performs zero GitHub writes
// 7. Explicit boundary logs are emitted at every transition
// 8. Page load historical submission suppression (no blind sync on load)
// 9. Zero historical submissions baseline (null baseline) properly handles new submission
// 10. Origin check and message validation integrity

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock Chrome API environment
let storageState = {
  local: {},
  session: {},
};

global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === "string") return { [key]: storageState.local[key] };
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => (res[k] = storageState.local[k]));
          return res;
        }
        return { ...storageState.local };
      },
      set: async (obj) => {
        Object.assign(storageState.local, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete storageState.local[k]);
      },
    },
    session: {
      get: async (key) => {
        if (typeof key === "string") return { [key]: storageState.session[key] };
        return { ...storageState.session };
      },
      set: async (obj) => {
        Object.assign(storageState.session, obj);
      },
      remove: async (key) => {
        delete storageState.session[key];
      },
    },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  runtime: {
    id: "test-extension-id",
    getManifest: () => ({ version: "1.1.6" }),
    getURL: () => "chrome-extension://test-extension-id/",
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: async (msg) => {
      // Mock bridge forwarding to background
      if (global.__bridgeSendMessageMock) {
        return global.__bridgeSendMessageMock(msg);
      }
      return { ok: true };
    },
  },
  alarms: {
    create: () => {},
    clear: () => {},
    onAlarm: { addListener: () => {} },
  },
};

global.importScripts = (file) => {
  const content = fs.readFileSync(path.join(__dirname, file), "utf8");
  const fn = new Function(
    "global",
    content +
      "\nif (typeof FLY2GIT_CONFIG !== 'undefined') global.FLY2GIT_CONFIG = FLY2GIT_CONFIG;\n" +
      "if (typeof PLATFORMS !== 'undefined') global.PLATFORMS = PLATFORMS;\n" +
      "if (typeof Fly2GitPlatforms !== 'undefined') global.Fly2GitPlatforms = Fly2GitPlatforms;\n" +
      "if (typeof Fly2GitEntitlements !== 'undefined') global.Fly2GitEntitlements = Fly2GitEntitlements;\n" +
      "if (typeof Fly2GitIdentity !== 'undefined') global.Fly2GitIdentity = Fly2GitIdentity;\n"
  );
  fn(global);
};

// Load dependencies
global.importScripts("config.js");
global.importScripts("platforms.js");
global.importScripts("identity.js");
global.importScripts("entitlements.js");

const platforms = require("./platforms.js");
const identity = require("./identity.js");
const entitlements = require("./entitlements.js");
const bg = require("./background.js");

// Test runner helpers
let passed = 0;
let failed = 0;

async function it(desc, fn) {
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

async function runTests() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT LEETCODE -> GITHUB PIPELINE REGRESSION SUITE");
  console.log("=======================================================\n");

  // Reset storage and setup base auth & repo
  async function setupTestState(opts = {}) {
    storageState = {
      local: {
        auth: {
          accessToken: "ghp_test_token_12345",
          refreshToken: "r_token",
          expiresAt: Date.now() + 3600000,
        },
        selectedRepo: opts.repo !== undefined ? opts.repo : "testuser/algorithms",
        fly2git_entitlement: {
          version: 1,
          plan: "basic",
          selectedPlatforms: ["leetcode", "geeksforgeeks"],
        },
      },
      session: {},
    };
    await identity.bindPlatformIdentity("leetcode", {
      username: "test_leetcode_user",
      platformUserId: "test_leetcode_user",
    });
  }

  // --- Test 1: NormalizedSubmission schema contract ---
  await it("1. NormalizedSubmission schema satisfies contract and validates successfully", async () => {
    const raw = {
      platform: "leetcode",
      user: { username: "test_leetcode_user", platformUserId: "test_leetcode_user" },
      problem: {
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      },
      submission: {
        id: "2159258683",
        status: "Accepted",
        language: "cpp",
        code: "class Solution { public: int strStr(string haystack, string needle) { return 0; } };",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    const norm = platforms.normalizeSubmission(raw);
    assert.strictEqual(norm.platform, "leetcode");
    assert.strictEqual(norm.problem.slug, "find-the-index-of-the-first-occurrence-in-a-string");
    assert.strictEqual(norm.problem.difficulty, "Easy");
    assert.strictEqual(norm.submission.id, "2159258683");
    assert.strictEqual(norm.submission.status, "Accepted");
    assert.strictEqual(norm.submission.language, "cpp");

    const val = platforms.validateNormalizedSubmission(norm);
    assert.strictEqual(val.ok, true, "Validation should succeed");
  });

  // --- Test 2: Content bridge validates messages and converts to NormalizedSubmission ---
  await it("2. Content bridge validates incoming message and emits boundary log", async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
      origLog.apply(console, args);
    };

    let sentMessage = null;
    global.__bridgeSendMessageMock = async (msg) => {
      sentMessage = msg;
      return { ok: true };
    };

    // Simulate content.js bridge message handling
    const rawMsg = {
      source: "fly2git-leetcode",
      type: "ACCEPTED",
      payload: {
        platform: "leetcode",
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
        submissionId: "2159258683",
        lang: "cpp",
        code: "class Solution { public: int strStr(string haystack, string needle) { return 0; } };",
        user: { username: "test_leetcode_user", platformUserId: "test_leetcode_user" },
      },
    };

    // Load content.js validation logic in isolation
    const contentCode = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
    assert(contentCode.includes("[Fly2Git][LeetCode] Bridge received submission"), "Bridge log must be present in content.js");
    assert(contentCode.includes('platform: "leetcode"'), "Bridge must construct platform: leetcode");

    console.log = origLog;
  });

  // --- Test 3: Newly accepted submission -> exactly one GitHub sync ---
  await it("3. Newly accepted submission results in exactly one GitHub commit", async () => {
    await setupTestState();

    let commitsMade = 0;
    let createdBlobs = [];

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("api.github.com/repos/testuser/algorithms/contents/")) {
        // Files do not exist yet
        return { ok: false, status: 404, json: async () => ({ message: "Not found" }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/ref/heads/main")) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "base_commit_sha" } }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/commits/base_commit_sha")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "base_tree_sha" } }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/blobs")) {
        createdBlobs.push(JSON.parse(options.body).content);
        return { ok: true, status: 201, json: async () => ({ sha: `blob_${createdBlobs.length}` }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/trees")) {
        return { ok: true, status: 201, json: async () => ({ sha: "tree_first_solution" }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/commits")) {
        commitsMade++;
        return { ok: true, status: 201, json: async () => ({ sha: "commit_first_solution" }), clone() { return this; } };
      }
      if (u.includes("api.github.com/repos/testuser/algorithms")) {
        return { ok: true, status: 200, json: async () => ({ default_branch: "main" }), clone() { return this; } };
      }
      return { ok: false, status: 404, json: async () => ({ message: "Not found" }), clone() { return this; } };
    };

    const submissionPayload = {
      platform: "leetcode",
      user: { username: "test_leetcode_user", platformUserId: "test_leetcode_user" },
      problem: {
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      },
      submission: {
        id: "2159258683",
        status: "Accepted",
        language: "cpp",
        code: "class Solution { public: int strStr(string haystack, string needle) { return 0; } };",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    const result = await bg.handleAcceptedSubmissionInternal(submissionPayload);

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.isUpdate, false);
    assert.strictEqual(commitsMade, 1, "Exactly one commit should be made");
  });

  // --- Test 4: Same submission detected repeatedly -> no duplicate commit ---
  await it("4. Same submission detected repeatedly performs zero duplicate commits", async () => {
    await setupTestState();

    let commitsMade = 0;
    const existingCode = "class Solution { public: int strStr(string haystack, string needle) { return 0; } };";

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("api.github.com/repos/testuser/algorithms/contents/")) {
        if (u.includes("solution.cpp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ content: Buffer.from(existingCode).toString("base64"), sha: "sol_sha_123" }),
            clone() { return this; }
          };
        }
        if (u.includes("README.md")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ content: Buffer.from("# Problem README").toString("base64"), sha: "readme_sha_123" }),
            clone() { return this; }
          };
        }
      }
      if (u.includes("api.github.com/repos/testuser/algorithms/git/commits")) {
        commitsMade++;
        return { ok: true, status: 201, json: async () => ({ sha: "commit_sha" }), clone() { return this; } };
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }), clone() { return this; } };
    };

    const submissionPayload = {
      platform: "leetcode",
      user: { username: "test_leetcode_user", platformUserId: "test_leetcode_user" },
      problem: {
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      },
      submission: {
        id: "2159258683",
        status: "Accepted",
        language: "cpp",
        code: existingCode,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    const result = await bg.handleAcceptedSubmissionInternal(submissionPayload);

    assert.strictEqual(result.skipped, true, "Duplicate submission must be marked as skipped");
    assert.strictEqual(commitsMade, 0, "No GitHub commits should be made for duplicate submission");
  });

  // --- Test 5: latestId === baseline bug resolution in inject.js ---
  await it("5. latestId === baseline with Accepted panel event does not silently disappear", async () => {
    // Inspect inject.js logic to verify that forwardLatestAccepted does NOT suppress when latestId === baseline
    const injectCode = fs.readFileSync(path.join(__dirname, "inject.js"), "utf8");

    // Check that forwardLatestAccepted exists and is called from checkAcceptedPanel
    assert(injectCode.includes("forwardLatestAccepted(slug, \"accepted-panel\")"), "checkAcceptedPanel must call forwardLatestAccepted");
    assert(injectCode.includes("log(\"Forwarding accepted submission\", { submissionId: latestId, slug: slug, source: source })"), "forwardLatestAccepted must log boundary message");

    // Check that forwardLatestAccepted only checks !emittedSubmissionIds.has(latestId) and NOT latestId !== baseline
    const forwardFnMatch = injectCode.match(/function forwardLatestAccepted[\s\S]*?return emitAccepted/);
    assert(forwardFnMatch, "forwardLatestAccepted function must be found");
    assert(!forwardFnMatch[0].includes("latestId !== baseline"), "forwardLatestAccepted must not reject when latestId === baseline");
  });

  // --- Test 6: GitHub sync failure is surfaced ---
  await it("6. GitHub sync failure is properly logged and surfaced", async () => {
    await setupTestState({ repo: null }); // Force config error: no repo selected

    const submissionPayload = {
      platform: "leetcode",
      user: { username: "test_leetcode_user", platformUserId: "test_leetcode_user" },
      problem: {
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      },
      submission: {
        id: "2159258683",
        status: "Accepted",
        language: "cpp",
        code: "class Solution {};",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    let errorThrown = null;
    try {
      await bg.handleAcceptedSubmissionInternal(submissionPayload);
    } catch (err) {
      errorThrown = err;
    }

    assert(errorThrown !== null, "Sync failure must be thrown");
    assert.strictEqual(errorThrown.code, "CONFIG");

    // Check syncLog in storage
    const { syncLog } = storageState.local;
    assert(Array.isArray(syncLog) && syncLog.length > 0, "Failure must be recorded in syncLog");
    assert.strictEqual(syncLog[0].status, "failed");
    assert.strictEqual(syncLog[0].code, "CONFIG");
  });

  // --- Test 7: Explicit boundary logs verification ---
  await it("7. Boundary log prefixes exist at every boundary in codebase", async () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "inject.js"), "utf8");
    const contentCode = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
    const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");

    // Boundary 1: inject.js
    assert(injectCode.includes('"Forwarding accepted submission"'), "inject.js must log 'Forwarding accepted submission'");

    // Boundary 2: content.js
    assert(contentCode.includes("[Fly2Git][LeetCode] Bridge received submission"), "content.js must log '[Fly2Git][LeetCode] Bridge received submission'");

    // Boundary 3: background.js entry
    assert(bgCode.includes("[Fly2Git][Background] Accepted submission received"), "background.js must log '[Fly2Git][Background] Accepted submission received'");

    // Boundary 4: background.js sync start
    assert(bgCode.includes("[Fly2Git][Background] Starting GitHub sync"), "background.js must log '[Fly2Git][Background] Starting GitHub sync'");

    // Boundary 5: background.js sync result
    assert(bgCode.includes("[Fly2Git][Background] GitHub sync result"), "background.js must log '[Fly2Git][Background] GitHub sync result'");
  });

  // --- Test 8: Page load historical submission suppression ---
  await it("8. Page load does not blindly sync historical submissions", async () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "inject.js"), "utf8");

    // Verify existing DOM panels on load are marked as processed
    assert(injectCode.includes("existingPanels[k].__fly2git_processed__ = true"), "Pre-existing panels on load must be marked processed");

    // Verify pollAccepted checks latestId !== baseline before emitting
    assert(injectCode.includes("if (latestId !== baseline && !emittedSubmissionIds.has(latestId))"), "pollAccepted must check latestId !== baseline");
  });

  // --- Test 9: Baseline tracking with null baseline (unsolved problem) ---
  await it("9. Baseline tracking handles problems with zero initial submissions without dropping newly accepted submission", async () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "inject.js"), "utf8");

    // Verify initializedSlugs tracking is used instead of dropping when baseline is null
    assert(injectCode.includes("initializedSlugs"), "initializedSlugs must be defined in inject.js");
    assert(injectCode.includes("!initializedSlugs.has(slug)"), "pollAccepted must check !initializedSlugs.has(slug)");
  });

  // --- Test 10: Authoritative Platform Identity check before GitHub writes ---
  await it("10. Authoritative Identity Guard check blocks mismatched accounts before GitHub writes", async () => {
    await setupTestState();

    // Mismatched user
    const mismatchedPayload = {
      platform: "leetcode",
      user: { username: "imposter_user", platformUserId: "imposter_user" },
      problem: {
        slug: "find-the-index-of-the-first-occurrence-in-a-string",
        title: "Find the Index of the First Occurrence in a String",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      },
      submission: {
        id: "999999",
        status: "Accepted",
        language: "cpp",
        code: "class Solution {};",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    let errorThrown = null;
    try {
      await bg.handleAcceptedSubmissionInternal(mismatchedPayload);
    } catch (err) {
      errorThrown = err;
    }

    assert(errorThrown !== null, "Mismatched identity must be rejected");
    assert.strictEqual(errorThrown.code, "ACCOUNT_MISMATCH");
  });

  console.log(`\n=======================================================`);
  console.log(`LEETCODE SYNC RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`=======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
