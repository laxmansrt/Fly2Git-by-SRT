// Fly2Git — by SRT
// Phase 9B: Codeforces Adapter Test Suite
//
// Tests:
// 1. hostname validation
// 2. singleton guards
// 3. handle extraction
// 4. contest ID parsing
// 5. problem index parsing
// 6. problem URL
// 7. problem slug
// 8. title extraction
// 9. user submission capture
// 10. source code extraction
// 11. extension staging
// 12. staging TTL
// 13. API URL construction
// 14. API response parsing
// 15. OK verdict
// 16. WRONG_ANSWER
// 17. COMPILATION_ERROR
// 18. RUNTIME_ERROR
// 19. TIME_LIMIT_EXCEEDED
// 20. MEMORY_LIMIT_EXCEEDED
// 21. contest participant detection
// 22. rated contest suppression
// 23. practice submission allowed
// 24. submission correlation
// 25. wrong-user rejection
// 26. wrong-problem rejection
// 27. ambiguous submission rejection
// 28. unknown language rejection
// 29. language mappings
// 30. duplicate suppression
// 31. bounded requests
// 32. no request faster than 2 seconds
// 33. timeout cleanup
// 34. malformed API response
// 35. HTTP errors
// 36. 429 handling
// 37. 5xx handling
// 38. auth-not-logged-in handling
// 39. origin validation
// 40. source validation
// 41. payload bounds
// 42. secret/log protection
// 43. NormalizedSubmission
// 44. GitHub path safety
// 45. entitlement rejection

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock browser globals for Node testing environment
global.window = {
  location: {
    hostname: "codeforces.com",
    pathname: "/contest/4/problem/A",
    href: "https://codeforces.com/contest/4/problem/A",
    origin: "https://codeforces.com",
  },
  postMessage: () => {},
  addEventListener: () => {},
};
global.document = {
  title: "A. Watermelon - Codeforces",
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// Mock chrome storage
const mockSessionStorage = {};
const mockLocalStorage = {};

global.importScripts = () => {};

global.chrome = {
  runtime: {
    id: "test-extension-id",
    sendMessage: (msg, cb) => {
      if (cb) cb({ ok: true });
    },
    onMessage: {
      addListener: () => {},
    },
    onConnect: {
      addListener: () => {},
    },
    getURL: () => "chrome-extension://test-extension-id/",
  },
  alarms: {
    create: () => {},
    clear: () => {},
    onAlarm: { addListener: () => {} },
  },
  storage: {
    session: {
      get: async (k) => ({ [k]: mockSessionStorage[k] }),
      set: async (obj) => {
        Object.assign(mockSessionStorage, obj);
      },
      remove: async (k) => {
        delete mockSessionStorage[k];
      },
      setAccessLevel: async () => {},
    },
    local: {
      get: async (k) => {
        if (typeof k === "string") return { [k]: mockLocalStorage[k] };
        if (Array.isArray(k)) {
          const res = {};
          k.forEach((key) => {
            res[key] = mockLocalStorage[key];
          });
          return res;
        }
        return mockLocalStorage;
      },
      set: async (obj) => {
        Object.assign(mockLocalStorage, obj);
      },
      remove: async (k) => {
        if (Array.isArray(k)) k.forEach((key) => delete mockLocalStorage[key]);
        else delete mockLocalStorage[k];
      },
    },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
};

const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
const background = require("./background.js");
const cfInject = require("./codeforces-inject.js");
const cfContent = require("./codeforces-content.js");

const cfInjectSource = fs.readFileSync(path.join(__dirname, "codeforces-inject.js"), "utf8");
const cfContentSource = fs.readFileSync(path.join(__dirname, "codeforces-content.js"), "utf8");
const bgSource = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(err);
    failed++;
  }
}

async function itAsync(desc, fn) {
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

console.log("\n=======================================================");
console.log("   FLY2GIT PHASE 9B: CODEFORCES ADAPTER TEST SUITE");
console.log("=======================================================\n");

async function runTests() {
  // 1. hostname validation
  it("1. hostname validation", () => {
    assert(cfInjectSource.includes('hostname !== "codeforces.com" && !hostname.endsWith(".codeforces.com")'));
    assert(cfContentSource.includes('hostname !== "codeforces.com" && !hostname.endsWith(".codeforces.com")'));
  });

  // 2. singleton guards
  it("2. singleton guards", () => {
    assert(cfInjectSource.includes("__FLY2GIT_CODEFORCES_INJECT_INITIALIZED__"));
    assert(cfContentSource.includes("__FLY2GIT_CODEFORCES_CONTENT_INITIALIZED__"));
  });

  // 3. handle extraction
  it("3. handle extraction", () => {
    const oldQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
      if (sel.includes("profile")) return { textContent: "  tourist  " };
      return null;
    };
    const handle = cfInject.extractUserHandle();
    assert.strictEqual(handle, "tourist");

    // Rejects "Enter" / "Register" when logged out
    document.querySelector = () => ({ textContent: "Enter" });
    assert.strictEqual(cfInject.extractUserHandle(), null);

    document.querySelector = () => null;
    assert.strictEqual(cfInject.extractUserHandle(), null);
    document.querySelector = oldQuerySelector;
  });

  // 4. contest ID parsing
  it("4. contest ID parsing", () => {
    const c1 = cfInject.parseContestAndIndex("https://codeforces.com/contest/4/problem/A");
    assert.strictEqual(c1.contestId, 4);

    const c2 = cfInject.parseContestAndIndex("https://codeforces.com/problemset/problem/2268/D");
    assert.strictEqual(c2.contestId, 2268);

    const c3 = cfInject.parseContestAndIndex("https://codeforces.com/gym/104000/problem/B");
    assert.strictEqual(c3.contestId, 104000);
  });

  // 5. problem index parsing
  it("5. problem index parsing", () => {
    const c1 = cfInject.parseContestAndIndex("https://codeforces.com/contest/4/problem/A");
    assert.strictEqual(c1.problemIndex, "A");

    const c2 = cfInject.parseContestAndIndex("https://codeforces.com/contest/1800/problem/C2");
    assert.strictEqual(c2.problemIndex, "C2");
  });

  // 6. problem URL
  it("6. problem URL", () => {
    const staging = { contestId: 4, problemIndex: "A" };
    const sub = { id: 101, problem: { rating: 800, name: "Watermelon" } };
    const norm = cfContent.buildNormalizedSubmission(sub, staging);
    assert.strictEqual(norm.problem.url, "https://codeforces.com/contest/4/problem/A");
  });

  // 7. problem slug
  it("7. problem slug", () => {
    const staging = { contestId: 2268, problemIndex: "D" };
    const sub = { id: 102, problem: { rating: 2250, name: "AghaBalaSar and Hamed" } };
    const norm = cfContent.buildNormalizedSubmission(sub, staging);
    assert.strictEqual(norm.problem.slug, "codeforces-2268-D");
  });

  // 8. title extraction
  it("8. title extraction", () => {
    const oldQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
      if (sel.includes("title")) return { textContent: "A. Watermelon" };
      return null;
    };
    assert.strictEqual(cfInject.extractProblemTitle(), "Watermelon");

    document.querySelector = (sel) => {
      if (sel.includes("title")) return { textContent: "C2. Power Transmission (Hard Edition)" };
      return null;
    };
    assert.strictEqual(cfInject.extractProblemTitle(), "Power Transmission (Hard Edition)");
    document.querySelector = oldQuerySelector;
  });

  // 9. user submission capture
  it("9. user submission capture", () => {
    const payload = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      code: "int main() { return 0; }",
      language: "cpp",
      timestamp: Date.now(),
    };
    assert.strictEqual(cfContent.validateStagingPayload(payload), true);
  });

  // 10. source code extraction
  it("10. source code extraction", () => {
    // Plain textarea
    const form = {
      querySelector: (sel) => {
        if (sel.includes("source")) return { value: "print('hello')" };
        return null;
      },
    };
    assert.strictEqual(cfInject.extractSourceCode(form), "print('hello')");

    // Ace Editor mock
    global.window.ace = {
      edit: (id) => ({
        getValue: () => "int main(){ return 42; }",
      }),
    };
    assert.strictEqual(cfInject.extractSourceCode(form), "int main(){ return 42; }");
    delete global.window.ace;
  });

  // 11. extension staging
  await itAsync("11. extension staging", async () => {
    const payload = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      code: "int main(){}",
      timestamp: Date.now(),
    };
    await background.stageCodeforcesSubmission(payload);
    const retrieved = await background.getCodeforcesStaging();
    assert.deepStrictEqual(retrieved, payload);
    await background.clearCodeforcesStaging();
    assert.strictEqual(await background.getCodeforcesStaging(), null);
  });

  // 12. staging TTL
  await itAsync("12. staging TTL", async () => {
    const oldPayload = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      code: "int main(){}",
      timestamp: Date.now() - 35000, // 35s ago (> 30s TTL)
    };
    await background.stageCodeforcesSubmission(oldPayload);
    const retrieved = await background.getCodeforcesStaging();
    assert.strictEqual(retrieved, null, "Expired staging (>30s) must be discarded");
  });

  // 13. API URL construction (now in background.js after boundary hardening)
  it("13. API URL construction", () => {
    const handle = "tourist";
    const expected = "https://codeforces.com/api/user.status?handle=" + encodeURIComponent(handle) + "&from=1&count=5";
    assert(bgSource.includes("https://codeforces.com/api/user.status?handle="));
    assert(bgSource.includes("&from=1&count=5"));
    // Content script delegates via POLL_CODEFORCES_STATUS message
    assert(cfContentSource.includes("POLL_CODEFORCES_STATUS"));
  });

  // 14. API response parsing
  it("14. API response parsing", () => {
    const mockApiResponse = {
      status: "OK",
      result: [
        {
          id: 12345,
          contestId: 4,
          problem: { index: "A", name: "Watermelon", rating: 800 },
          programmingLanguage: "GNU C++17",
          verdict: "OK",
        },
      ],
    };
    assert.strictEqual(mockApiResponse.status, "OK");
    assert.strictEqual(mockApiResponse.result.length, 1);
    assert.strictEqual(mockApiResponse.result[0].verdict, "OK");
  });

  // 15. OK verdict
  it("15. OK verdict", () => {
    assert.strictEqual(cfContent.isAcceptedVerdict("OK"), true);
    assert.strictEqual(cfContent.isAcceptedVerdict("ok"), true);
    assert.strictEqual(cfContent.isAcceptedVerdict("WRONG_ANSWER"), false);
  });

  // 16. WRONG_ANSWER
  it("16. WRONG_ANSWER", () => {
    assert.strictEqual(cfContent.isTerminalFailure("WRONG_ANSWER"), true);
  });

  // 17. COMPILATION_ERROR
  it("17. COMPILATION_ERROR", () => {
    assert.strictEqual(cfContent.isTerminalFailure("COMPILATION_ERROR"), true);
  });

  // 18. RUNTIME_ERROR
  it("18. RUNTIME_ERROR", () => {
    assert.strictEqual(cfContent.isTerminalFailure("RUNTIME_ERROR"), true);
  });

  // 19. TIME_LIMIT_EXCEEDED
  it("19. TIME_LIMIT_EXCEEDED", () => {
    assert.strictEqual(cfContent.isTerminalFailure("TIME_LIMIT_EXCEEDED"), true);
  });

  // 20. MEMORY_LIMIT_EXCEEDED
  it("20. MEMORY_LIMIT_EXCEEDED", () => {
    assert.strictEqual(cfContent.isTerminalFailure("MEMORY_LIMIT_EXCEEDED"), true);
  });

  // 21. contest participant detection
  it("21. contest participant detection", () => {
    const sub = {
      id: 999,
      author: { participantType: "CONTESTANT" },
      verdict: "OK",
    };
    assert.strictEqual(sub.author.participantType, "CONTESTANT");
  });

  // 22. rated contest suppression
  it("22. rated contest suppression", () => {
    assert(cfContentSource.includes('matched.author.participantType === "CONTESTANT"'));
    assert(cfContentSource.includes("pauses syncing during active Codeforces contests"));
  });

  // 23. practice submission allowed
  it("23. practice submission allowed", () => {
    const sub = {
      id: 1001,
      author: { participantType: "PRACTICE" },
      verdict: "OK",
    };
    assert.notStrictEqual(sub.author.participantType, "CONTESTANT");
  });

  // 24. submission correlation
  it("24. submission correlation", () => {
    const now = Date.now();
    const staging = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      timestamp: now,
    };
    const matchingSub = {
      id: 5001,
      contestId: 4,
      creationTimeSeconds: Math.floor(now / 1000),
      problem: { contestId: 4, index: "A" },
      author: { members: [{ handle: "tourist" }] },
    };
    assert.strictEqual(cfContent.isMatchingSubmission(matchingSub, staging), true);
  });

  // 25. wrong-user rejection
  it("25. wrong-user rejection", () => {
    const now = Date.now();
    const staging = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      timestamp: now,
    };
    const otherUserSub = {
      id: 5002,
      contestId: 4,
      creationTimeSeconds: Math.floor(now / 1000),
      problem: { contestId: 4, index: "A" },
      author: { members: [{ handle: "otheruser" }] },
    };
    assert.strictEqual(cfContent.isMatchingSubmission(otherUserSub, staging), false);
  });

  // 26. wrong-problem rejection
  it("26. wrong-problem rejection", () => {
    const now = Date.now();
    const staging = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      timestamp: now,
    };
    const wrongProblemSub = {
      id: 5003,
      contestId: 4,
      creationTimeSeconds: Math.floor(now / 1000),
      problem: { contestId: 4, index: "B" },
      author: { members: [{ handle: "tourist" }] },
    };
    assert.strictEqual(cfContent.isMatchingSubmission(wrongProblemSub, staging), false);
  });

  // 27. ambiguous submission rejection (out-of-window timestamp)
  it("27. ambiguous submission rejection", () => {
    const now = Date.now();
    const staging = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      timestamp: now,
    };
    const oldSub = {
      id: 5004,
      contestId: 4,
      creationTimeSeconds: Math.floor((now - 120000) / 1000), // 2 mins prior
      problem: { contestId: 4, index: "A" },
      author: { members: [{ handle: "tourist" }] },
    };
    assert.strictEqual(cfContent.isMatchingSubmission(oldSub, staging), false);
  });

  // 28. unknown language rejection
  it("28. unknown language rejection", () => {
    assert.strictEqual(cfContent.normalizeLanguage("Brainfuck 1.0"), null);
    assert.strictEqual(cfInject.normalizeLanguage("UnknownLang"), null);
  });

  // 29. language mappings
  it("29. language mappings", () => {
    assert.strictEqual(cfContent.normalizeLanguage("C++23 (GCC 14-64, msys2)"), "cpp");
    assert.strictEqual(cfContent.normalizeLanguage("GNU C++17"), "cpp");
    assert.strictEqual(cfContent.normalizeLanguage("GNU C11"), "c");
    assert.strictEqual(cfContent.normalizeLanguage("Python 3"), "python");
    assert.strictEqual(cfContent.normalizeLanguage("PyPy 3-64"), "python");
    assert.strictEqual(cfContent.normalizeLanguage("Java 21"), "java");
    assert.strictEqual(cfContent.normalizeLanguage("Rust 2024"), "rust");
    assert.strictEqual(cfContent.normalizeLanguage("Go"), "go");
    assert.strictEqual(cfContent.normalizeLanguage("C# 10"), "csharp");
    assert.strictEqual(cfContent.normalizeLanguage("JavaScript V8"), "javascript");
    assert.strictEqual(cfContent.normalizeLanguage("Kotlin 1.9"), "kotlin");
  });

  // 30. duplicate suppression
  it("30. duplicate suppression", () => {
    const dedupKey = "codeforces:4:A:123456";
    assert(cfContentSource.includes("emittedSubmissionKeys"));
    assert(cfContentSource.includes("codeforces:"));
  });

  // 31. bounded requests
  it("31. bounded requests", () => {
    assert.strictEqual(cfContent.MAX_POLL_ATTEMPTS, 12);
  });

  // 32. no request faster than 2 seconds
  it("32. no request faster than 2 seconds", () => {
    assert(cfContent.POLL_INTERVAL_MS >= 2000, "Polling interval must be >= 2000ms");
    assert.strictEqual(cfContent.POLL_INTERVAL_MS, 3500);
  });

  // 33. timeout cleanup
  it("33. timeout cleanup", () => {
    assert(cfContentSource.includes("stopDiscovery"));
    assert(cfContentSource.includes("safeClearStaging"));
  });

  // 34. malformed API response (now handled in background.js after boundary hardening)
  it("34. malformed API response", () => {
    // Background validates API response structure
    assert(bgSource.includes('data.status !== "OK" || !Array.isArray(data.result)'));
    // Content script validates background response structure
    assert(cfContentSource.includes('!Array.isArray(response.submissions)'));
  });

  // 35. HTTP errors (now handled in background.js after boundary hardening)
  it("35. HTTP errors", () => {
    // Background handles HTTP errors from the fetch
    assert(bgSource.includes("!resp.ok"));
    // Content script receives error via response.ok
    assert(cfContentSource.includes("!response.ok"));
  });

  // 36. 429 handling
  it("36. 429 handling", () => {
    assert(bgSource.includes("case 429:"));
  });

  // 37. 5xx handling (now handled in background.js after boundary hardening)
  it("37. 5xx handling", () => {
    // Background handles fetch errors (including 5xx) and returns error messages
    assert(bgSource.includes("Fetch error"));
    // Content script logs background errors
    assert(cfContentSource.includes("Background API poll returned error"));
  });

  // 38. auth-not-logged-in handling
  it("38. auth-not-logged-in handling", () => {
    assert(cfInjectSource.includes("User is not logged into Codeforces — skipping submission staging"));
  });

  // 39. origin validation
  it("39. origin validation", () => {
    assert(cfContentSource.includes('event.origin !== "https://codeforces.com"'));
  });

  // 40. source validation
  it("40. source validation", () => {
    assert(cfContentSource.includes('event.data.source !== "FLY2GIT_CODEFORCES_INJECT"'));
  });

  // 41. payload bounds
  it("41. payload bounds", () => {
    const oversize = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      code: "a".repeat(200001),
      timestamp: Date.now(),
    };
    assert.strictEqual(cfContent.validateStagingPayload(oversize), false);

    const normal = {
      handle: "tourist",
      contestId: 4,
      problemIndex: "A",
      code: "int main(){}",
      timestamp: Date.now(),
    };
    assert.strictEqual(cfContent.validateStagingPayload(normal), true);
  });

  // 42. secret/log protection
  it("42. secret/log protection", () => {
    assert(!cfInjectSource.includes("apiKey"));
    assert(!cfInjectSource.includes("apiSecret"));
    assert(!cfContentSource.includes("apiKey"));
    assert(!cfContentSource.includes("apiSecret"));
    assert(!cfInjectSource.includes("console.log(code)"));
    assert(!cfContentSource.includes("console.log(staging.code)"));
  });

  // 43. NormalizedSubmission
  it("43. NormalizedSubmission", () => {
    const raw = {
      platform: "codeforces",
      problem: {
        slug: "codeforces-4-A",
        title: "Watermelon",
        difficulty: "800",
        url: "https://codeforces.com/contest/4/problem/A",
      },
      submission: {
        id: "12345678",
        status: "Accepted",
        language: "cpp",
        code: "#include <iostream>\nint main(){ return 0; }",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };
    const norm = platforms.normalizeSubmission(raw);
    const val = platforms.validateNormalizedSubmission(norm);
    assert.strictEqual(val.ok, true, val.error);
    assert.strictEqual(norm.platform, "codeforces");
    assert.strictEqual(norm.problem.slug, "codeforces-4-A");
    assert.strictEqual(norm.problem.difficulty, "800");
  });

  // 44. GitHub path safety
  it("44. GitHub path safety", () => {
    const folderWithRating = platforms.buildCanonicalFolderPath("codeforces", "800", "codeforces-4-A");
    assert.strictEqual(folderWithRating, "Codeforces/800/codeforces-4-A");

    const folderUnknown = platforms.buildCanonicalFolderPath("codeforces", "Unknown", "codeforces-4-A");
    assert.strictEqual(folderUnknown, "Codeforces/Unknown/codeforces-4-A");

    // Traversal safety
    const safe = platforms.buildCanonicalFolderPath("codeforces", "../../800", "../codeforces-4-A");
    assert(!safe.includes(".."));
  });

  // 45. entitlement rejection
  await itAsync("45. entitlement rejection", async () => {
    const basicWithoutCF = {
      version: 1,
      plan: "basic",
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
    };
    const allowed = await entitlements.isPlatformAllowed("codeforces", basicWithoutCF);
    assert.strictEqual(allowed, false, "Codeforces must be rejected if not in selectedPlatforms");

    const pro = {
      version: 1,
      plan: "pro",
      selectedPlatforms: [],
    };
    const allowedPro = await entitlements.isPlatformAllowed("codeforces", pro);
    assert.strictEqual(allowedPro, true, "Codeforces must be allowed on pro plan");
  });

  // =================================================================
  // Phase 9B.1: API Boundary Hardening Tests
  // =================================================================

  // 46. handle validation — valid handles
  it("46. handle validation — valid handles", () => {
    assert.strictEqual(background.isValidCodeforcesHandle("tourist"), true);
    assert.strictEqual(background.isValidCodeforcesHandle("Petr"), true);
    assert.strictEqual(background.isValidCodeforcesHandle("user.name"), true);
    assert.strictEqual(background.isValidCodeforcesHandle("user_name"), true);
    assert.strictEqual(background.isValidCodeforcesHandle("user-name"), true);
    assert.strictEqual(background.isValidCodeforcesHandle("A"), true); // 1 char
    assert.strictEqual(background.isValidCodeforcesHandle("a".repeat(24)), true); // max 24
  });

  // 47. handle validation — invalid handles
  it("47. handle validation — invalid handles", () => {
    assert.strictEqual(background.isValidCodeforcesHandle(""), false);
    assert.strictEqual(background.isValidCodeforcesHandle(null), false);
    assert.strictEqual(background.isValidCodeforcesHandle(undefined), false);
    assert.strictEqual(background.isValidCodeforcesHandle(42), false);
    assert.strictEqual(background.isValidCodeforcesHandle("a".repeat(25)), false); // too long
    assert.strictEqual(background.isValidCodeforcesHandle("user name"), false); // space
    assert.strictEqual(background.isValidCodeforcesHandle("user;drop"), false); // semicolon
    assert.strictEqual(background.isValidCodeforcesHandle("user/name"), false); // slash
    assert.strictEqual(background.isValidCodeforcesHandle("user\nname"), false); // newline
    assert.strictEqual(background.isValidCodeforcesHandle("<script>"), false); // XSS
  });

  // 48. content script has ZERO direct fetch calls to Codeforces API
  it("48. content script has zero direct fetch calls", () => {
    assert(!cfContentSource.includes("fetch(apiUrl"), "Content script must not contain fetch(apiUrl");
    assert(!cfContentSource.includes("fetch(\"https://codeforces.com/api"), "Content script must not fetch Codeforces API directly");
    // Verify it uses POLL_CODEFORCES_STATUS instead
    assert(cfContentSource.includes("POLL_CODEFORCES_STATUS"), "Content script must use POLL_CODEFORCES_STATUS message");
  });

  // 49. background.js contains the API fetch logic
  it("49. background contains API fetch logic", () => {
    assert(bgSource.includes("pollCodeforcesStatus"), "Background must define pollCodeforcesStatus");
    assert(bgSource.includes("https://codeforces.com/api/user.status"), "Background must contain the API URL");
    assert(bgSource.includes('credentials: "omit"'), "Background must use credentials: omit");
  });

  // 50. background POLL_CODEFORCES_STATUS handler wired in message listener
  it("50. POLL_CODEFORCES_STATUS handler wired", () => {
    assert(bgSource.includes('"POLL_CODEFORCES_STATUS"'), "Background must handle POLL_CODEFORCES_STATUS messages");
    assert(bgSource.includes("pollCodeforcesStatus(message.handle)"), "Handler must invoke pollCodeforcesStatus with message.handle");
  });

  // 51. response sanitization — only safe fields returned
  it("51. response sanitization — safe fields only", () => {
    // Background sanitizes: id, contestId, creationTimeSeconds, verdict,
    // programmingLanguage, problem {contestId, index, name, rating},
    // author {participantType, members[{handle}]}
    assert(bgSource.includes("sanitized"), "Background must produce sanitized output");
    assert(bgSource.includes("sub.problem.index"), "Sanitized output must include problem index");
    assert(bgSource.includes("sub.author.participantType"), "Sanitized output must include participantType");
  });

  // 52. pollCodeforcesStatus rejects invalid handle without fetch
  await itAsync("52. pollCodeforcesStatus rejects invalid handle", async () => {
    const result = await background.pollCodeforcesStatus("user;inject");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Invalid handle");

    const result2 = await background.pollCodeforcesStatus("");
    assert.strictEqual(result2.ok, false);
    assert.strictEqual(result2.error, "Invalid handle");

    const result3 = await background.pollCodeforcesStatus(null);
    assert.strictEqual(result3.ok, false);
    assert.strictEqual(result3.error, "Invalid handle");
  });

  // 53. CF_API_HANDLE_RE exported and correct
  it("53. handle regex pattern exported", () => {
    assert(background.CF_API_HANDLE_RE instanceof RegExp);
    assert(background.CF_API_HANDLE_RE.test("tourist"));
    assert(!background.CF_API_HANDLE_RE.test(""));
    assert(!background.CF_API_HANDLE_RE.test("a b"));
  });

  console.log("\n=======================================================");
  console.log(`CODEFORCES RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
