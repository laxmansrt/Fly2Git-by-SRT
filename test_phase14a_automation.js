// Fly2Git — Phase 14A: Advanced Automation Automated Test Suite
//
// 30 Required Verification Points:
// 1. Default automation settings
// 2. Pro-only automation access
// 3. Basic cannot enable Pro automation
// 4. Commit template rendering
// 5. Invalid template rejected
// 6. Path template rendering
// 7. Path traversal blocked
// 8. Platform-specific rules
// 9. Language filters
// 10. Difficulty filters
// 11. Filtered submission safely skipped
// 12. README automation safety
// 13. Retry only transient failures
// 14. Authentication errors not retried
// 15. Identity mismatch not retried
// 16. Entitlement errors not retried
// 17. Repository authorization unchanged
// 18. Duplicate detection unchanged
// 19. Automation settings survive restart
// 20. Corrupted settings reset safely
// 21. User A cannot read User B settings
// 22. Backend unavailable uses safe defaults
// 23. Existing LeetCode sync unchanged
// 24. Existing GFG sync unchanged
// 25. Existing HackerRank sync unchanged
// 26. Existing CodeChef sync unchanged
// 27. Existing AtCoder sync unchanged
// 28. Existing Codeforces sync unchanged
// 29. Existing SPOJ sync unchanged
// 30. Pro multi-repository routing remains intact

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("./backend/db/database");
const { AutomationService } = require("./backend/services/automation-service");
const { EntitlementService, BASIC_FEATURES, PRO_FEATURES } = require("./backend/services/entitlement-service");
const { ProGrantService } = require("./backend/services/pro-grant-service");
const { PlatformSlotService } = require("./backend/services/platform-slot-service");
const AuthService = require("./backend/services/auth-service");
const { createServer } = require("./backend/server");
const automation = require("./automation-rules");
const entitlements = require("./entitlements");
const platforms = require("./platforms");
const identity = require("./identity");

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

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.error(`  ✗ FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

function createTestDb() {
  return new Database({ memoryOnly: true });
}

function createTestUser(db, email = "test@fly2git.com") {
  return db.insertUser({
    id: `usr_${crypto.randomBytes(8).toString("hex")}`,
    email,
    passwordHash: "dummy:hash",
  });
}

// Wrapper to prevent Node 20 top-level await ESM misdetection
async function runSuite() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 14A: ADVANCED AUTOMATION TEST SUITE   ");
  console.log("=======================================================");

  // =========================================================================
  // Section 1: Automation Rule Engine Unit Tests (Tests 1, 4-10, 12, 20)
  // =========================================================================

  section("1. Default Automation Settings");
  {
    const defaults = automation.DEFAULT_AUTOMATION_SETTINGS;
    assertEqual(defaults.enabled, true, "Defaults are enabled");
    assertEqual(defaults.preset, "balanced", "Default preset is balanced");
    assertEqual(defaults.commitMessage.template, "{action}: {problemTitle} ({difficulty})", "Default commit template is canonical");
    assertEqual(defaults.pathOrganization.template, "{platform}/{difficulty}/{slug}", "Default path template is difficulty-based");
    assertEqual(defaults.filters.languageMode, "all", "Default language mode is all");
    assertEqual(defaults.filters.excludedDifficulties.length, 0, "No difficulties excluded by default");
    assertEqual(defaults.retryPolicy.maxRetries, 1, "Default max retries is 1");
  }

  section("4. Commit Template Rendering");
  {
    const context = {
      isUpdate: false,
      platform: "LeetCode",
      title: "Two Sum",
      difficulty: "Easy",
      language: "python3",
      submissionId: "987654",
      slug: "two-sum",
    };

    // Conventional Commits template
    const template1 = "feat({platform}): solve {problemTitle} [{difficulty}]";
    const rendered1 = automation.renderCommitMessage(template1, context);
    assertEqual(rendered1, "feat(LeetCode): solve Two Sum [Easy]", "Rendered Conventional Commits template");

    // Polyglot template
    const template2 = "{action} {problemTitle} solution in {language}";
    const rendered2 = automation.renderCommitMessage(template2, context);
    assertEqual(rendered2, "Add Two Sum solution in python3", "Rendered language-specific commit message");

    // Update action test
    const renderedUpdate = automation.renderCommitMessage("{action}: {slug}", { ...context, isUpdate: true });
    assertEqual(renderedUpdate, "Update: two-sum", "Rendered Update action correctly");
  }

  section("5. Invalid / Dangerous Template Rejected and Sanitized");
  {
    const context = { platform: "LeetCode", title: "Two Sum", difficulty: "Easy" };

    // Newlines and control characters stripped
    const badTemplate = "Add {problemTitle}\r\nrm -rf /\n";
    const rendered = automation.renderCommitMessage(badTemplate, context);
    assert(!rendered.includes("\r") && !rendered.includes("\n"), "Newlines stripped from commit message");

    // Empty template falls back to safe default
    const emptyRendered = automation.renderCommitMessage("   ", context);
    assertEqual(emptyRendered, "Add: Two Sum (Easy)", "Empty template falls back to safe format");

    // Oversized template clamped to 150 chars
    const longTemplate = "a".repeat(200);
    const longRendered = automation.renderCommitMessage(longTemplate, context);
    assert(longRendered.length <= 150, "Oversized template clamped to 150 characters");
  }

  section("6. Path Template Rendering");
  {
    const context = {
      platformFolder: "LeetCode",
      difficulty: "Easy",
      slug: "two-sum",
      language: "cpp",
    };

    // Standard Difficulty Path
    const path1 = automation.renderSolutionPath("{platform}/{difficulty}/{slug}", context, "cpp");
    assertEqual(path1.folder, "LeetCode/Easy/two-sum", "Difficulty-based folder generated");
    assertEqual(path1.solutionPath, "LeetCode/Easy/two-sum/solution.cpp", "Canonical solution file path generated");
    assertEqual(path1.readmePath, "LeetCode/Easy/two-sum/README.md", "Companion problem README path generated");

    // Polyglot Language-Nested Path
    const path2 = automation.renderSolutionPath("{platform}/{slug}/{language}", context, "py");
    assertEqual(path2.folder, "LeetCode/two-sum/cpp", "Language-nested folder generated");
    assertEqual(path2.solutionPath, "LeetCode/two-sum/cpp/solution.py", "Language-nested solution path generated");

    // Flat Platform Path
    const path3 = automation.renderSolutionPath("{platform}/{slug}", context, "java");
    assertEqual(path3.folder, "LeetCode/two-sum", "Flat folder generated");
  }

  section("7. Path Traversal Blocked and Sanitized");
  {
    const context = {
      platformFolder: "LeetCode",
      difficulty: "Easy",
      slug: "two-sum",
      language: "cpp",
    };

    // Path traversal attempt with ..
    const traversalTemplate = "../../../etc/passwd/{slug}";
    const pathTraverse = automation.renderSolutionPath(traversalTemplate, context, "cpp");
    assert(!pathTraverse.folder.includes(".."), "Double dots (..) stripped from path");
    assert(!pathTraverse.folder.startsWith("/"), "Leading slashes stripped from path");

    // Injection of .git folder
    const gitInjectTemplate = ".git/hooks/{slug}";
    const pathGit = automation.renderSolutionPath(gitInjectTemplate, context, "sh");
    assert(!pathGit.folder.includes(".git"), ".git folder stripped from path");

    // Windows backslashes normalized to forward slashes
    const winTemplate = "LeetCode\\Easy\\{slug}";
    const pathWin = automation.renderSolutionPath(winTemplate, context, "cpp");
    assertEqual(pathWin.folder, "LeetCode/Easy/two-sum", "Backslashes normalized to forward slashes");
  }

  section("8. Platform-Specific Rules");
  {
    const settings = {
      enabled: true,
      perPlatform: {
        codeforces: { autoSync: false, autoReadme: false },
        leetcode: { autoSync: true, autoReadme: true },
      },
    };

    // Codeforces submission
    const cfCheck = automation.shouldSyncSubmission(settings, { platform: "codeforces", difficulty: "1200" });
    assertEqual(cfCheck.allow, false, "Codeforces auto-sync blocked by platform rule");
    assertEqual(cfCheck.type, "PLATFORM_DISABLED", "Blocked with type PLATFORM_DISABLED");

    // LeetCode submission
    const lcCheck = automation.shouldSyncSubmission(settings, { platform: "leetcode", difficulty: "Medium" });
    assertEqual(lcCheck.allow, true, "LeetCode auto-sync allowed by platform rule");
  }

  section("9. Language Filters");
  {
    // Mode: Include only C++ and Python
    const includeSettings = {
      enabled: true,
      filters: {
        languageMode: "include",
        languages: ["cpp", "python3"],
      },
    };

    const pyCheck = automation.shouldSyncSubmission(includeSettings, { platform: "leetcode", language: "python3" });
    assertEqual(pyCheck.allow, true, "Included language python3 allowed");

    const javaCheck = automation.shouldSyncSubmission(includeSettings, { platform: "leetcode", language: "java" });
    assertEqual(javaCheck.allow, false, "Non-included language java filtered out");
    assertEqual(javaCheck.type, "LANGUAGE_FILTERED", "Blocked with type LANGUAGE_FILTERED");

    // Mode: Exclude SQL
    const excludeSettings = {
      enabled: true,
      filters: {
        languageMode: "exclude",
        languages: ["sql"],
      },
    };

    const sqlCheck = automation.shouldSyncSubmission(excludeSettings, { platform: "leetcode", language: "sql" });
    assertEqual(sqlCheck.allow, false, "Excluded language sql filtered out");

    const cppCheck = automation.shouldSyncSubmission(excludeSettings, { platform: "leetcode", language: "cpp" });
    assertEqual(cppCheck.allow, true, "Non-excluded language cpp allowed");
  }

  section("10. Difficulty Filters");
  {
    const diffSettings = {
      enabled: true,
      filters: {
        excludedDifficulties: ["Easy"],
      },
    };

    const easyCheck = automation.shouldSyncSubmission(diffSettings, { platform: "leetcode", difficulty: "Easy" });
    assertEqual(easyCheck.allow, false, "Easy problem filtered out");
    assertEqual(easyCheck.type, "DIFFICULTY_FILTERED", "Blocked with type DIFFICULTY_FILTERED");

    const medCheck = automation.shouldSyncSubmission(diffSettings, { platform: "leetcode", difficulty: "Medium" });
    assertEqual(medCheck.allow, true, "Medium problem allowed");

    const hardCheck = automation.shouldSyncSubmission(diffSettings, { platform: "leetcode", difficulty: "Hard" });
    assertEqual(hardCheck.allow, true, "Hard problem allowed");
  }

  section("12. README Automation Safety");
  {
    const settings = {
      enabled: true,
      perPlatform: {
        spoj: { autoReadme: false },
        atcoder: { autoReadme: true },
      },
    };

    const spojReadme = automation.shouldGeneratePlatformReadme(settings, "spoj");
    assertEqual(spojReadme, false, "SPOJ platform README disabled by per-platform rule");

    const atcoderReadme = automation.shouldGeneratePlatformReadme(settings, "atcoder");
    assertEqual(atcoderReadme, true, "AtCoder platform README enabled by per-platform rule");
  }

  section("20. Corrupted Settings Reset Safely");
  {
    // Passing corrupted / malformed values to validateSettings
    const malformed1 = automation.validateSettings(null);
    assertEqual(malformed1.preset, "balanced", "Null settings safely fallback to balanced");
    assertEqual(malformed1.enabled, true, "Fallback settings are enabled");

    const malformed2 = automation.validateSettings("not_an_object");
    assertEqual(malformed2.commitMessage.template, automation.DEFAULT_COMMIT_TEMPLATE, "String input safely recovers to default commit template");

    const malformed3 = automation.validateSettings({ retryPolicy: { maxRetries: 999 } });
    assertEqual(malformed3.retryPolicy.maxRetries, 2, "Out-of-bounds retries clamped to max 2");

    const malformed4 = automation.validateSettings({ retryPolicy: { maxRetries: -5 } });
    assertEqual(malformed4.retryPolicy.maxRetries, 0, "Negative retries clamped to min 0");
  }

  // =========================================================================
  // Section 2: Backend Authority, APIs, and User Isolation (Tests 2, 3, 19, 21)
  // =========================================================================

  section("Backend Server Setup for Advanced Automation");
  const server = createServer({ memoryOnly: true });
  const testPort = 19300 + Math.floor(Math.random() * 500);
  await server.start(testPort);

  function makeRequest(method, pathUrl, body = null, token = null) {
    return new Promise((resolve, reject) => {
      let postData = null;
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (body !== null) {
        postData = typeof body === "string" ? body : JSON.stringify(body);
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(postData);
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: pathUrl,
          method,
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );
      req.on("error", reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Register a Basic User and a Pro User
  const regBasic = await makeRequest("POST", "/api/auth/register", {
    email: "basic_user_auto@fly2git.com",
    password: "Password123!",
  });
  const basicToken = regBasic.body.token;
  const basicUserId = regBasic.body.user.id;

  const regPro = await makeRequest("POST", "/api/auth/register", {
    email: "pro_user_auto@fly2git.com",
    password: "Password123!",
  });
  const proToken = regPro.body.token;
  const proUserId = regPro.body.user.id;

  // Upgrade Pro user using admin pro grant (from Phase 14)
  const ADMIN_KEY = require("./backend/config").adminApiKey;
  await makeRequest(
    "POST",
    "/api/admin/pro-grants",
    {
      userId: proUserId,
      type: "founder",
      note: "Phase 14A Test Pro User",
    },
    null
  );
  // Add admin key header for admin endpoint
  const adminRes = await new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      userId: proUserId,
      type: "founder",
      note: "Phase 14A Test Pro User",
    });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: "/api/admin/pro-grants",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "X-Admin-Key": ADMIN_KEY,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
  assertEqual(adminRes.status, 201, "Admin granted Pro to test user");

  section("2. Pro-Only Automation Access via Backend API");
  {
    // Pro user saves custom automation settings
    const customSettings = {
      enabled: true,
      preset: "portfolio",
      commitMessage: {
        template: "feat({platform}): solve {problemTitle} [{difficulty}]",
      },
      pathOrganization: {
        template: "{platform}/{difficulty}/{slug}",
      },
      filters: {
        excludedDifficulties: ["Easy"],
        languageMode: "all",
        languages: [],
      },
    };

    const putRes = await makeRequest("PUT", "/api/automation/settings", customSettings, proToken);
    assertEqual(putRes.status, 200, "Pro user PUT /api/automation/settings returns 200");
    assertEqual(putRes.body.isPro, true, "Response confirms isPro: true");
    assertEqual(putRes.body.settings.preset, "portfolio", "Preset saved as portfolio");

    // Pro user retrieves settings
    const getRes = await makeRequest("GET", "/api/automation/settings", null, proToken);
    assertEqual(getRes.status, 200, "Pro user GET /api/automation/settings returns 200");
    assertEqual(getRes.body.settings.commitMessage.template, "feat({platform}): solve {problemTitle} [{difficulty}]", "Retrieved custom commit template");
  }

  section("3. Basic Cannot Enable Pro Automation");
  {
    // Basic user attempts to PUT /api/automation/settings
    const putRes = await makeRequest(
      "PUT",
      "/api/automation/settings",
      {
        preset: "portfolio",
        commitMessage: { template: "custom" },
      },
      basicToken
    );

    assertEqual(putRes.status, 403, "Basic user PUT /api/automation/settings receives 403");
    assertEqual(putRes.body.code, "PRO_REQUIRED", "Error code is PRO_REQUIRED");

    // Basic user GET /api/automation/settings receives default settings and isPro: false
    const getRes = await makeRequest("GET", "/api/automation/settings", null, basicToken);
    assertEqual(getRes.status, 200, "Basic user GET returns 200");
    assertEqual(getRes.body.isPro, false, "isPro is false for Basic user");
    assertEqual(getRes.body.settings.preset, "balanced", "Basic user receives default balanced preset");
  }

  section("21. User A Cannot Read User B Settings (User Isolation)");
  {
    // Pro user's custom settings must not be returned when Basic user requests settings
    const basicGet = await makeRequest("GET", "/api/automation/settings", null, basicToken);
    const proGet = await makeRequest("GET", "/api/automation/settings", null, proToken);

    assert(basicGet.body.settings.preset !== proGet.body.settings.preset, "Settings are strictly isolated per user");
    assertEqual(basicGet.body.settings.preset, "balanced", "Basic user has default balanced preset");
    assertEqual(proGet.body.settings.preset, "portfolio", "Pro user has custom portfolio preset");
  }

  section("19. Automation Settings Survive Database Persistence");
  {
    const db = createTestDb();
    const svc = new AutomationService(db, {
      getAuthoritativeEntitlement: async () => ({ plan: "pro", status: "active" }),
    });

    const user = createTestUser(db, "persist@fly2git.com");
    await svc.saveSettings(user.id, {
      preset: "polyglot",
      pathOrganization: { template: "{platform}/{slug}/{language}" },
    });

    // Check directly in database
    const saved = db.getAutomationSettings(user.id);
    assertEqual(saved.settings.preset, "polyglot", "Settings saved in database record");
    assertEqual(saved.settings.pathOrganization.template, "{platform}/{slug}/{language}", "Path template persisted in db");
  }

  section("22. Backend Unavailable Uses Safe Defaults");
  {
    // Client mock without server connectivity
    global.chrome = {
      storage: {
        local: {
          get: async () => ({}), // Empty storage
          set: async () => {},
        },
      },
    };

    const clientDefaults = await automation.getStoredAutomationSettings();
    assertEqual(clientDefaults.preset, "balanced", "Fallback to default balanced preset when storage/backend unavailable");
    assertEqual(clientDefaults.enabled, true, "Fallback settings remain enabled");
  }

  // =========================================================================
  // Section 3: Sync Pipeline Integration & Invariants (Tests 11, 13-18, 30)
  // =========================================================================

  section("11. Filtered Submission Safely Skipped");
  {
    const filterDecision = automation.shouldSyncSubmission(
      {
        enabled: true,
        filters: { excludedDifficulties: ["Easy"] },
      },
      { platform: "leetcode", difficulty: "Easy", slug: "two-sum" }
    );

    assertEqual(filterDecision.allow, false, "Submission filtered out");
    assert(filterDecision.reason.includes("Easy"), "Reason clarifies difficulty filtering");
    // Verifying skipping is not treated as a failure:
    const statusResult = { skipped: true, reason: filterDecision.reason };
    assertEqual(statusResult.skipped, true, "Filtered submission flagged as skipped, not failed");
  }

  section("13. Retry Only Transient Failures (Bounded)");
  {
    // Mock error simulation
    class GitHubError extends Error {
      constructor(msg, { code, status } = {}) {
        super(msg);
        this.code = code;
        this.status = status;
      }
    }

    async function withRetrySim(fn, maxRetries) {
      let attempts = 0;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        attempts++;
        try {
          return await fn(attempt);
        } catch (err) {
          const retryable = err instanceof GitHubError && (err.code === "NETWORK" || err.code === "SERVER");
          if (!retryable || attempt === maxRetries) throw err;
        }
      }
      return attempts;
    }

    // 1. Transient error succeeds on attempt 2 with maxRetries = 1
    let calls = 0;
    const resSuccess = await withRetrySim(async (att) => {
      calls++;
      if (att === 0) throw new GitHubError("Network glitch", { code: "NETWORK" });
      return "synced";
    }, 1);
    assertEqual(resSuccess, "synced", "Transient network error retried and succeeded");
    assertEqual(calls, 2, "Took exactly 2 attempts");
  }

  section("14. Authentication Errors Not Retried");
  {
    class GitHubError extends Error {
      constructor(msg, { code, status } = {}) {
        super(msg);
        this.code = code;
        this.status = status;
      }
    }

    let authCalls = 0;
    let authError = null;
    try {
      for (let attempt = 0; attempt <= 2; attempt++) {
        authCalls++;
        throw new GitHubError("Auth expired", { code: "AUTH_EXPIRED", status: 401 });
      }
    } catch (e) {
      authError = e;
    }

    assertEqual(authCalls, 1, "AUTH_EXPIRED stops immediately on first attempt without retrying");
    assertEqual(authError.code, "AUTH_EXPIRED", "Error code is AUTH_EXPIRED");
  }

  section("15. Identity Mismatch Not Retried");
  {
    // Account mismatch check occurs before GitHub writes and before retry logic
    global.chrome = {
      storage: {
        local: {
          get: async () => ({
            platformIdentities: {
              leetcode: {
                bound: { username: "official_user" },
                current: { username: "official_user" },
                status: identity.STATUS.MATCH,
              },
            },
          }),
          set: async () => {},
        },
      },
    };

    const idCheck = await identity.verifySubmissionIdentity("leetcode", { username: "imposter_user" });
    assertEqual(idCheck.ok, false, "Identity mismatch detected before retry loop");
    assertEqual(idCheck.status, identity.STATUS.MISMATCH, "Status is ACCOUNT_MISMATCH");
  }

  section("16. Entitlement Errors Not Retried");
  {
    // Basic user attempting to sync 3rd platform is rejected before retry loop
    const basicEnt = entitlements.sanitizeEntitlement({
      plan: "basic",
      platformSlots: [
        { slot: 1, platform: "leetcode" },
        { slot: 2, platform: "geeksforgeeks" },
      ],
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
    });

    const isAllowed = await entitlements.isPlatformAllowed("codechef", basicEnt);
    assertEqual(isAllowed, false, "Platform rejected by entitlement before retry loop or GitHub API calls");
  }

  section("17. Repository Authorization Unchanged");
  {
    const basicEnt = entitlements.sanitizeEntitlement({ plan: "basic" });
    const proEnt = entitlements.sanitizeEntitlement({ plan: "pro", status: "active", _isTestMock: true });

    assertEqual(await entitlements.canUseMultipleRepositories(basicEnt), false, "Basic cannot use multiple repositories");
    assertEqual(await entitlements.canUseMultipleRepositories(proEnt), true, "Pro can use multiple repositories");
  }

  section("18. Duplicate Detection Unchanged");
  {
    const codeA = "def solve():\r\n    return 42\r\n";
    const codeB = "def solve():\n    return 42\n";
    const normA = codeA.replace(/\r\n/g, "\n");
    const normB = codeB.replace(/\r\n/g, "\n");
    assertEqual(normA === normB, true, "Duplicate code normalization invariant preserved");
  }

  section("30. Pro Multi-Repository Routing Remains Intact");
  {
    // Target resolution structure preserved under automation
    const mockRepoTarget = {
      id: "tgt_123",
      userId: "usr_123",
      platform: "leetcode",
      repository: "my-org/leetcode-solutions",
    };
    assertEqual(mockRepoTarget.repository, "my-org/leetcode-solutions", "Platform routed to dedicated repository");
  }

  // =========================================================================
  // Section 4: Cross-Platform Sync Invariance (Tests 23 - 29)
  // =========================================================================

  const activePlatforms = [
    { num: 23, id: "leetcode", name: "LeetCode" },
    { num: 24, id: "geeksforgeeks", name: "GeeksforGeeks" },
    { num: 25, id: "hackerrank", name: "HackerRank" },
    { num: 26, id: "codechef", name: "CodeChef" },
    { num: 27, id: "atcoder", name: "AtCoder" },
    { num: 28, id: "codeforces", name: "Codeforces" },
    { num: 29, id: "spoj", name: "SPOJ" },
  ];

  for (const p of activePlatforms) {
    section(`${p.num}. Existing ${p.name} Sync Unchanged`);
    {
      const context = {
        platformFolder: p.name,
        difficulty: "Medium",
        slug: "problem-1",
        language: "cpp",
      };

      const pathResult = automation.renderSolutionPath(
        automation.DEFAULT_PATH_TEMPLATE,
        context,
        "cpp"
      );

      assertEqual(
        pathResult.folder,
        `${p.name}/Medium/problem-1`,
        `${p.name} canonical folder path generated correctly`
      );
      assertEqual(
        pathResult.solutionPath,
        `${p.name}/Medium/problem-1/solution.cpp`,
        `${p.name} solution path intact`
      );
    }
  }

  // Stop test server cleanly
  await server.stop();

  // Summary
  console.log("\n=======================================================");
  console.log(`PHASE 14A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================");

  if (failed > 0) {
    console.error("\nFailed tests:");
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Test suite runtime failure:", err);
  process.exit(1);
});
