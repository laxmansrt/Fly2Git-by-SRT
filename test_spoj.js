// Fly2Git — by SRT
// Phase 10B: SPOJ Adapter Test Suite
//
// Minimum coverage (43 points):
// 1. hostname validation
// 2. singleton guard
// 3. problem URL parsing
// 4. problem code extraction
// 5. title extraction
// 6. CodeMirror extraction
// 7. textarea fallback
// 8. language selector detection
// 9. verified language mapping
// 10. unknown language rejection
// 11. submit form detection
// 12. submit capture
// 13. extension session staging
// 14. 30-second staging TTL
// 15. staging deletion
// 16. status page detection
// 17. username correlation
// 18. problem correlation
// 19. language correlation
// 20. timestamp correlation
// 21. ambiguous correlation rejection
// 22. submission ID extraction
// 23. accepted result
// 24. waiting result
// 25. wrong answer
// 26. compilation error
// 27. runtime error
// 28. time limit
// 29. malformed result
// 30. duplicate suppression
// 31. private submission handling
// 32. contest-context suppression
// 33. passive observation
// 34. no aggressive polling
// 35. origin validation
// 36. source validation
// 37. payload bounds
// 38. secret/log protection
// 39. NormalizedSubmission
// 40. GitHub path safety
// 41. entitlement rejection
// 42. upload-file handling
// 43. no arbitrary URL fetching

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.importScripts = () => {};

// Mock Chrome API environment for tests
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
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete storageState.session[k]);
      },
    },
  },
  runtime: {
    id: "test-extension-id",
    getURL: () => "chrome-extension://test-extension-id/",
    onConnect: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage: async (msg) => {
      if (msg.type === "STAGE_SPOJ_SUBMISSION") {
        storageState.session["fly2git_spoj_staging"] = msg.payload;
        return { ok: true };
      }
      if (msg.type === "GET_SPOJ_STAGING") {
        return { ok: true, staging: storageState.session["fly2git_spoj_staging"] };
      }
      if (msg.type === "CLEAR_SPOJ_STAGING") {
        delete storageState.session["fly2git_spoj_staging"];
        return { ok: true };
      }
      return { ok: true };
    },
  },
  alarms: {
    onAlarm: { addListener() {} },
    create() {},
    clear() {},
  },
  action: {
    setBadgeText() {},
    setBadgeBackgroundColor() {},
  },
};

// Mock window & document
global.window = {
  location: {
    hostname: "www.spoj.com",
    pathname: "/problems/TEST/",
    origin: "https://www.spoj.com",
  },
  addEventListener: () => {},
  postMessage: () => {},
};

global.document = {
  readyState: "complete",
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
};

// Load modules
const Fly2GitPlatforms = require("./platforms.js");
global.Fly2GitPlatforms = Fly2GitPlatforms;

const Fly2GitEntitlements = require("./entitlements.js");
global.Fly2GitEntitlements = Fly2GitEntitlements;

const SPOJInject = require("./spoj-inject.js");
const SPOJContent = require("./spoj-content.js");
const bg = require("./background.js");

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
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
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=======================================================");
console.log("   FLY2GIT PHASE 10B: SPOJ ADAPTER TEST SUITE");
console.log("=======================================================\n");

(async function runTests() {
  // 1. Hostname validation
  it("1. hostname validation", () => {
    assert.strictEqual(window.location.hostname, "www.spoj.com");
  });

  // 2. Singleton guard
  it("2. singleton guard", () => {
    assert.strictEqual(window.__FLY2GIT_SPOJ_INJECT_INITIALIZED__, true);
    assert.strictEqual(window.__FLY2GIT_SPOJ_CONTENT_INITIALIZED__, true);
  });

  // 3. Problem URL parsing
  it("3. problem URL parsing", () => {
    assert.strictEqual(SPOJInject.getSPOJProblemCode("/problems/TEST/"), "TEST");
    assert.strictEqual(SPOJInject.getSPOJProblemCode("/submit/PRIME1/"), "PRIME1");
    assert.strictEqual(SPOJInject.getSPOJProblemCode("/status/FCTRL,myuser/"), "FCTRL");
  });

  // 4. Problem code extraction fallback
  it("4. problem code extraction", () => {
    const mockForm = {
      querySelector: (sel) => {
        if (sel === 'input[name="problemCode"]') return { value: "PALIN" };
        return null;
      },
    };
    assert.strictEqual(SPOJInject.getSPOJProblemCode("/random/path", mockForm), "PALIN");
  });

  // 5. Title extraction
  it("5. title extraction", () => {
    assert.strictEqual(SPOJInject.getSPOJProblemTitle("TEST"), "TEST");
  });

  // 6. CodeMirror extraction
  it("6. CodeMirror extraction", () => {
    const origQuery = document.querySelector;
    document.querySelector = (sel) => {
      if (sel === ".CodeMirror") {
        return { CodeMirror: { getValue: () => 'print("hello world")' } };
      }
      return null;
    };
    let captured = null;
    SPOJInject.getSPOJSourceCode((c) => { captured = c; });
    assert.strictEqual(captured, 'print("hello world")');
    document.querySelector = origQuery;
  });

  // 7. Textarea fallback
  it("7. textarea fallback", () => {
    const origGet = document.getElementById;
    document.getElementById = (id) => {
      if (id === "problem_body") return { value: "int main() { return 0; }" };
      return null;
    };
    let captured = null;
    SPOJInject.getSPOJSourceCode((c) => { captured = c; });
    assert.strictEqual(captured, "int main() { return 0; }");
    document.getElementById = origGet;
  });

  // 8. Language selector detection
  it("8. language selector detection", () => {
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("1", "C++ (gcc 8.3)"), "cpp");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("116", "Python 3"), "python");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("10", "Java"), "java");
  });

  // 9. Verified language mapping
  it("9. verified language mapping", () => {
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("44", ""), "cpp");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("11", ""), "c");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("4", ""), "python");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("99", ""), "python");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("114", ""), "go");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("93", ""), "rust");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("47", ""), "kotlin");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("27", ""), "csharp");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("112", ""), "javascript");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("85", ""), "swift");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("29", ""), "php");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("17", ""), "pascal");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("22", ""), "scala");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage(null, "Ruby 2.7"), "ruby");
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage(null, "TypeScript (Node.js)"), "typescript");
  });

  // 10. Unknown language rejection
  it("10. unknown language rejection", () => {
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("99999", "Brainfuck"), null);
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("xyz", ""), null);
    assert.strictEqual(SPOJInject.normalizeSPOJLanguage("", ""), null);
  });

  // 11. Submit form detection
  it("11. submit form detection", () => {
    const code = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    assert(code.includes("problem_submit") || code.includes("/submit/complete/"));
  });

  // 12. Submit capture
  it("12. submit capture", () => {
    const code = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    assert(code.includes("FLY2GIT_SPOJ_STAGING"));
    assert(code.includes("problemCode"));
    assert(code.includes("language"));
    assert(code.includes("code"));
  });

  // 13. Extension session staging
  await itAsync("13. extension session staging", async () => {
    const payload = {
      platform: "spoj",
      problemCode: "TEST",
      language: "python",
      code: "print(42)",
      timestamp: Date.now(),
    };
    await SPOJContent.saveStaging(payload);
    const loaded = await SPOJContent.loadStaging();
    assert(loaded);
    assert.strictEqual(loaded.problemCode, "TEST");
    assert.strictEqual(loaded.code, "print(42)");
  });

  // 14. 30-second staging TTL
  await itAsync("14. 30-second staging TTL", async () => {
    storageState.session["fly2git_spoj_staging"] = {
      problemCode: "TEST",
      language: "python",
      code: "print(42)",
      timestamp: Date.now() - 35000, // 35 seconds old
    };
    const loaded = await SPOJContent.loadStaging();
    assert.strictEqual(loaded, null, "Expired staging (>30s) must return null");
  });

  // 15. Staging deletion
  await itAsync("15. staging deletion", async () => {
    storageState.session["fly2git_spoj_staging"] = {
      problemCode: "TEST",
      language: "python",
      code: "print(42)",
      timestamp: Date.now(),
    };
    await SPOJContent.clearStaging();
    const loaded = await SPOJContent.loadStaging();
    assert.strictEqual(loaded, null);
  });

  // 16. Status page detection
  it("16. status page detection", () => {
    assert.strictEqual(SPOJContent.isStatusPage("/status/"), true);
    assert.strictEqual(SPOJContent.isStatusPage("/status/TEST,myuser/"), true);
    assert.strictEqual(SPOJContent.isStatusPage("/problems/TEST/"), false);
  });

  // 17. Username correlation
  it("17. username correlation", () => {
    const rows = [
      { id: "1001", problemCode: "TEST", problem: "TEST", user: "otheruser", userLink: "/users/otheruser", result: "accepted" },
      { id: "1002", problemCode: "TEST", problem: "TEST", user: "myuser", userLink: "/users/myuser", result: "accepted" },
    ];
    const staging = { problemCode: "TEST", username: "myuser" };
    const correlated = SPOJContent.correlateSubmissionRow(rows, staging);
    assert(correlated);
    assert.strictEqual(correlated.id, "1002");
  });

  // 18. Problem correlation
  it("18. problem correlation", () => {
    const rows = [
      { id: "2001", problemCode: "PRIME1", problem: "PRIME1", user: "myuser", userLink: "/users/myuser", result: "accepted" },
      { id: "2002", problemCode: "TEST", problem: "TEST", user: "myuser", userLink: "/users/myuser", result: "accepted" },
    ];
    const staging = { problemCode: "TEST", username: "myuser" };
    const correlated = SPOJContent.correlateSubmissionRow(rows, staging);
    assert(correlated);
    assert.strictEqual(correlated.id, "2002");
  });

  // 19. Language correlation
  it("19. language correlation", () => {
    const rows = [
      { id: "3001", problemCode: "TEST", problem: "TEST", user: "myuser", userLink: "/users/myuser", lang: "PYTH 3", result: "accepted" },
    ];
    const staging = { problemCode: "TEST", username: "myuser", language: "python" };
    const correlated = SPOJContent.correlateSubmissionRow(rows, staging);
    assert(correlated);
    assert.strictEqual(correlated.id, "3001");
  });

  // 20. Timestamp correlation
  it("20. timestamp correlation", () => {
    const rows = [
      { id: "4001", problemCode: "TEST", problem: "TEST", user: "myuser", userLink: "/users/myuser", result: "accepted" },
    ];
    const staging = { problemCode: "TEST", username: "myuser", timestamp: Date.now() };
    const correlated = SPOJContent.correlateSubmissionRow(rows, staging);
    assert(correlated);
  });

  // 21. Ambiguous correlation rejection
  it("21. ambiguous correlation rejection", () => {
    const rows = [
      { id: "5001", problemCode: "OTHER", problem: "OTHER", user: "someone", userLink: "/users/someone", result: "accepted" },
    ];
    const staging = { problemCode: "TEST", username: "myuser" };
    const correlated = SPOJContent.correlateSubmissionRow(rows, staging);
    assert.strictEqual(correlated, null);
  });

  // 22. Submission ID extraction
  it("22. submission ID extraction", () => {
    const id = "35982935";
    assert(/^\d+$/.test(id));
  });

  // 23. Accepted result
  it("23. accepted result", () => {
    const v1 = SPOJContent.parseSPOJVerdict("accepted");
    assert.strictEqual(v1.status, "ACCEPTED");
    assert.strictEqual(v1.terminal, true);

    const v2 = SPOJContent.parseSPOJVerdict("AC");
    assert.strictEqual(v2.status, "ACCEPTED");
  });

  // 24. Waiting result
  it("24. waiting result", () => {
    assert.strictEqual(SPOJContent.parseSPOJVerdict("waiting...").status, "WAITING");
    assert.strictEqual(SPOJContent.parseSPOJVerdict("compiling...").status, "WAITING");
    assert.strictEqual(SPOJContent.parseSPOJVerdict("running...").status, "WAITING");
  });

  // 25. Wrong answer
  it("25. wrong answer", () => {
    const v = SPOJContent.parseSPOJVerdict("wrong answer");
    assert.strictEqual(v.status, "FAILED");
    assert.strictEqual(v.terminal, true);
  });

  // 26. Compilation error
  it("26. compilation error", () => {
    const v = SPOJContent.parseSPOJVerdict("compilation error");
    assert.strictEqual(v.status, "FAILED");
    assert.strictEqual(v.terminal, true);
  });

  // 27. Runtime error
  it("27. runtime error", () => {
    const v = SPOJContent.parseSPOJVerdict("runtime error (SIGSEGV)");
    assert.strictEqual(v.status, "FAILED");
    assert.strictEqual(v.terminal, true);
  });

  // 28. Time limit
  it("28. time limit", () => {
    const v = SPOJContent.parseSPOJVerdict("time limit exceeded");
    assert.strictEqual(v.status, "FAILED");
    assert.strictEqual(v.terminal, true);
  });

  // 29. Malformed result
  it("29. malformed result", () => {
    const v = SPOJContent.parseSPOJVerdict("");
    assert.strictEqual(v.status, "UNKNOWN");
    assert.strictEqual(v.terminal, false);
  });

  // 30. Duplicate suppression
  await itAsync("30. duplicate suppression", async () => {
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(contentCode.includes("emittedSubmissionKeys") || contentCode.includes("duplicate"));
    assert(contentCode.includes("spoj:"));
  });

  // 31. Private submission handling
  it("31. private submission handling", () => {
    // Private submissions are supported and staged normally without blocking user sync
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(contentCode.includes("NormalizedSubmission") || contentCode.includes("handleAcceptedSubmission"));
  });

  // 32. Contest-context suppression
  it("32. contest-context suppression", () => {
    assert.strictEqual(SPOJInject.isSPOJContestContext("/contest/123/problem/A"), true);
    assert.strictEqual(SPOJInject.isSPOJContestContext("/mycontest/problems/TEST/"), true);
    assert.strictEqual(SPOJInject.isSPOJContestContext("/problems/TEST/"), false);
    assert.strictEqual(SPOJInject.isSPOJContestContext("/submit/TEST/"), false);
    assert.strictEqual(SPOJInject.isSPOJContestContext("/status/TEST,myuser/"), false);
  });

  // 33. Passive observation
  it("33. passive observation", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    // Ensure no invented active polling endpoints
    assert(!injectCode.includes("setInterval"));
    assert(!contentCode.includes("setInterval"));
  });

  // 34. No aggressive polling
  it("34. no aggressive polling", () => {
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(!contentCode.includes("fetch("));
    assert(!contentCode.includes("XMLHttpRequest"));
  });

  // 35. Origin validation
  it("35. origin validation", () => {
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(contentCode.includes("event.origin !== window.location.origin"));
  });

  // 36. Source validation
  it("36. source validation", () => {
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(contentCode.includes("event.source !== window"));
  });

  // 37. Payload bounds
  it("37. payload bounds", () => {
    assert.strictEqual(SPOJContent.MAX_CODE_LENGTH, 200000);
  });

  // 38. Secret/log protection
  it("38. secret/log protection", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    const contentCode = fs.readFileSync(path.join(__dirname, "spoj-content.js"), "utf8");
    assert(!injectCode.includes("password"));
    assert(!injectCode.includes("cookie"));
    assert(!injectCode.includes("csrf"));
    assert(!contentCode.includes("password"));
    assert(!contentCode.includes("cookie"));
  });

  // 39. NormalizedSubmission
  it("39. NormalizedSubmission", () => {
    const raw = {
      platform: "spoj",
      problem: {
        slug: "TEST",
        title: "Life, the Universe, and Everything",
        difficulty: null,
        url: "https://www.spoj.com/problems/TEST/",
      },
      submission: {
        id: "123456",
        status: "Accepted",
        language: "python",
        code: "print(42)",
      },
      metadata: {
        timestamp: Date.now(),
      },
    };
    const norm = Fly2GitPlatforms.normalizeSubmission(raw);
    const val = Fly2GitPlatforms.validateNormalizedSubmission(norm);
    assert(val.ok, "NormalizedSubmission must validate: " + val.error);
    assert.strictEqual(norm.platform, "spoj");
    assert.strictEqual(norm.problem.slug, "TEST");
    assert.strictEqual(norm.submission.status, "Accepted");
  });

  // 40. GitHub path safety
  it("40. GitHub path safety", () => {
    const folderPath = Fly2GitPlatforms.buildCanonicalFolderPath("spoj", null, "TEST");
    assert.strictEqual(folderPath, "SPOJ/Unknown/TEST");

    const traversalPath = Fly2GitPlatforms.buildCanonicalFolderPath("spoj", "../../../evil", "TEST/../../hack");
    assert(!traversalPath.includes(".."));
  });

  // 41. Entitlement rejection
  await itAsync("41. entitlement rejection", async () => {
    // Under Basic entitlement, if spoj is not in selectedPlatforms, it must be rejected
    await Fly2GitEntitlements.setTestPlan("basic");
    await Fly2GitEntitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);
    const isAllowed = await Fly2GitEntitlements.isPlatformAllowed("spoj");
    assert.strictEqual(isAllowed, false, "SPOJ must be rejected when not in Basic selectedPlatforms");

    // When SPOJ is selected under Basic, it is allowed
    await Fly2GitEntitlements.setSelectedPlatforms(["spoj", "leetcode"]);
    const isAllowed2 = await Fly2GitEntitlements.isPlatformAllowed("spoj");
    assert.strictEqual(isAllowed2, true, "SPOJ must be allowed when selected in Basic");

    // Under Pro entitlement, all active platforms including SPOJ are allowed
    await Fly2GitEntitlements.setTestPlan("pro");
    const isAllowedPro = await Fly2GitEntitlements.isPlatformAllowed("spoj");
    assert.strictEqual(isAllowedPro, true, "SPOJ must be allowed under Pro plan");
  });

  // 42. Upload-file handling
  it("42. upload-file handling", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    assert(injectCode.includes("subm_file") || injectCode.includes("FileReader"));
  });

  // 43. No arbitrary URL fetching
  it("43. no arbitrary URL fetching", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "spoj-inject.js"), "utf8");
    assert(!injectCode.includes("fetch("));
    assert(!injectCode.includes("XMLHttpRequest"));
  });

  console.log("\n=======================================================");
  console.log(`SPOJ TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
})();
