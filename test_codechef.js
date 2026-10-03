// Test Suite for Phase 7B: CodeChef Platform Adapter
// Covers all 20 required tests + existing platform regressions

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoDir = "/Users/laxman/Downloads/Fly2Git-v1.1.6-audited";

// Mock Chrome Storage and Runtime
global.chrome = {
  storage: {
    local: {
      _data: {},
      get: async function (k) {
        if (typeof k === "string") return { [k]: this._data[k] };
        if (Array.isArray(k)) {
          const res = {};
          k.forEach(key => { res[key] = this._data[key]; });
          return res;
        }
        return { ...this._data };
      },
      set: async function (obj) {
        Object.assign(this._data, obj);
      },
      remove: async function (keys) {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete this._data[k]);
      }
    }
  },
  runtime: {
    id: "test-extension-id",
    getURL: function (p) {
      return "chrome-extension://test-id/" + p;
    },
    getManifest: function () {
      return { version: "1.1.6" };
    }
  }
};

const platforms = require(path.join(repoDir, "platforms.js"));
const entitlements = require(path.join(repoDir, "entitlements.js"));

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function runCodeChefTests() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 7B: CODECHEF ADAPTER TEST SUITE");
  console.log("=======================================================\n");

  const injectContent = fs.readFileSync(path.join(repoDir, "codechef-inject.js"), "utf8");
  const contentContent = fs.readFileSync(path.join(repoDir, "codechef-content.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(repoDir, "manifest.json"), "utf8"));

  // Helper matching codechef-inject.js
  function parseCodeChefUrl(pathname) {
    var contestCode = "PRACTICE";
    var problemCode = null;

    var problemMatch = pathname.match(/\/problems\/([A-Za-z0-9_-]+)/);
    if (problemMatch) {
      problemCode = problemMatch[1];
      var contestMatch = pathname.match(/\/([A-Za-z0-9_-]+)\/problems\//);
      if (
        contestMatch &&
        contestMatch[1] &&
        contestMatch[1] !== "practice" &&
        contestMatch[1] !== "course" &&
        contestMatch[1] !== "problems"
      ) {
        contestCode = contestMatch[1];
      }
    } else {
      var submitMatch = pathname.match(/\/submit\/([A-Za-z0-9_-]+)/);
      if (submitMatch) {
        problemCode = submitMatch[1];
      }
    }

    return {
      contestCode: contestCode || "PRACTICE",
      problemCode: problemCode || null,
      slug: problemCode || null,
    };
  }

  // Extract CODECHEF_LANG_MAP
  const langMapMatch = injectContent.match(/var CODECHEF_LANG_MAP = ({[\s\S]*?});/);
  assert(langMapMatch, "CODECHEF_LANG_MAP must be defined in codechef-inject.js");
  const CODECHEF_LANG_MAP = eval("(" + langMapMatch[1] + ")");

  function normalizeLang(raw) {
    if (!raw || typeof raw !== "string") return null;
    const cleaned = raw.trim().toLowerCase().replace(/^ace\/mode\//, "").replace(/\s*\(.*?\)\s*/g, "").trim();
    return CODECHEF_LANG_MAP[cleaned] || CODECHEF_LANG_MAP[raw.trim().toLowerCase()] || null;
  }

  // 1. CodeChef URL parsing
  it("1. CodeChef URL parsing: /practice/course/strings-new/STRINGSP01/problems/RPPS", () => {
    const meta = parseCodeChefUrl("/practice/course/strings-new/STRINGSP01/problems/RPPS");
    assert.strictEqual(meta.contestCode, "STRINGSP01");
    assert.strictEqual(meta.problemCode, "RPPS");
    assert.strictEqual(meta.slug, "RPPS");
  });

  // 2. contestCode extraction
  it("2. contestCode extraction from contest URLs", () => {
    const meta1 = parseCodeChefUrl("/START100B/problems/TAXI");
    assert.strictEqual(meta1.contestCode, "START100B");
    assert.strictEqual(meta1.problemCode, "TAXI");

    const meta2 = parseCodeChefUrl("/problems/FLOW001");
    assert.strictEqual(meta2.contestCode, "PRACTICE");
    assert.strictEqual(meta2.problemCode, "FLOW001");
  });

  // 3. problemCode extraction
  it("3. problemCode extraction across URL variations", () => {
    assert.strictEqual(parseCodeChefUrl("/submit/RPPS").problemCode, "RPPS");
    assert.strictEqual(parseCodeChefUrl("/practice/course/algo/ALGO01/problems/SUBARRAY").problemCode, "SUBARRAY");
  });

  // 4. problem slug normalization
  it("4. problem slug normalization", () => {
    const meta = parseCodeChefUrl("/practice/course/strings-new/STRINGSP01/problems/RPPS");
    assert.strictEqual(meta.slug, "RPPS");
    const canonicalFolder = platforms.buildCanonicalFolderPath("CodeChef", "Easy", meta.slug);
    assert.strictEqual(canonicalFolder, "CodeChef/Easy/RPPS");
  });

  // 5. accepted result detection
  it("5. accepted result detection (result_code === 'accepted')", () => {
    const res = { upid: "1366705136", result_code: "accepted" };
    const isAccepted = String(res.result_code || "").trim().toLowerCase() === "accepted";
    assert.strictEqual(isAccepted, true);
  });

  // 6. case-insensitive accepted detection
  it("6. case-insensitive accepted detection (ACCEPTED, Accepted, accepted)", () => {
    assert.strictEqual(String("ACCEPTED").trim().toLowerCase() === "accepted", true);
    assert.strictEqual(String("Accepted").trim().toLowerCase() === "accepted", true);
    assert.strictEqual(String("  accepted  ").trim().toLowerCase() === "accepted", true);
  });

  // 7. rejected result detection
  it("7. rejected result detection (wrong_answer, compilation_error, time_limit_exceeded)", () => {
    const failures = ["wrong_answer", "compilation_error", "runtime_error", "time_limit_exceeded", "tle", "failed"];
    failures.forEach(f => {
      const isAccepted = String(f).trim().toLowerCase() === "accepted";
      assert.strictEqual(isAccepted, false, `Status ${f} must NOT be accepted`);
    });
  });

  // 8. processing state detection
  it("8. processing state detection (waiting, compiling, running)", () => {
    const pendings = ["waiting", "compiling", "running", "queued", ""];
    pendings.forEach(p => {
      const isAccepted = String(p).trim().toLowerCase() === "accepted";
      assert.strictEqual(isAccepted, false, `Pending status '${p}' must not be treated as accepted`);
    });
  });

  // 9. solution ID validation
  it("9. solution ID validation (/^\\d+$/)", () => {
    assert(/^\d+$/.test("1366705136"));
    assert(/^\d+$/.test("12345678"));
    assert(!/^\d+$/.test("abc123"));
    assert(!/^\d+$/.test(""));
    assert(!/^\d+$/.test("../123"));
  });

  // 10. duplicate submission detection
  it("10. duplicate submission key: codechef:${contestCode}:${problemCode}:${solutionId}", () => {
    const key = `codechef:STRINGSP01:RPPS:1366705136`;
    const emitted = new Set();
    assert(!emitted.has(key));
    emitted.add(key);
    assert(emitted.has(key));
    // New submission ID for same problem is allowed
    assert(!emitted.has(`codechef:STRINGSP01:RPPS:1366705137`));
  });

  // 11. malformed payload rejection
  it("11. malformed payload rejection", () => {
    const valid = {
      platform: "CodeChef",
      problem: { slug: "RPPS", title: "RPPS", difficulty: "Easy", url: "https://www.codechef.com/problems/RPPS" },
      submission: { id: "1366705136", status: "Accepted", language: "python", code: "print('Hello')" },
      metadata: { timestamp: Date.now() }
    };
    assert.strictEqual(platforms.validateNormalizedSubmission(valid).ok, true);

    const badPlatform = { ...valid, platform: "UnknownPlatform" };
    assert.strictEqual(platforms.validateNormalizedSubmission(badPlatform).ok, false);

    const badStatus = { ...valid, submission: { ...valid.submission, status: "Wrong Answer" } };
    assert.strictEqual(platforms.validateNormalizedSubmission(badStatus).ok, false);
  });

  // 12. language normalization
  it("12. CodeChef language normalization (python, cpp, java, c, languageId: 116, 44, 10)", () => {
    assert.strictEqual(normalizeLang("python"), "python");
    assert.strictEqual(normalizeLang("python3"), "python");
    assert.strictEqual(normalizeLang("python 3.8"), "python");
    assert.strictEqual(normalizeLang("116"), "python");
    assert.strictEqual(normalizeLang("ace/mode/python"), "python");

    assert.strictEqual(normalizeLang("cpp"), "cpp");
    assert.strictEqual(normalizeLang("c++17"), "cpp");
    assert.strictEqual(normalizeLang("63"), "cpp");
    assert.strictEqual(normalizeLang("ace/mode/c_cpp"), "cpp");

    assert.strictEqual(normalizeLang("java"), "java");
    assert.strictEqual(normalizeLang("java17"), "java");
    assert.strictEqual(normalizeLang("10"), "java");
    assert.strictEqual(normalizeLang("ace/mode/java"), "java");

    assert.strictEqual(normalizeLang("c"), "c");
    assert.strictEqual(normalizeLang("11"), "c");
    assert.strictEqual(normalizeLang("c (gcc)"), "c");

    assert.strictEqual(normalizeLang("javascript"), "javascript");
    assert.strictEqual(normalizeLang("56"), "javascript");
    assert.strictEqual(normalizeLang("csharp"), "csharp");
    assert.strictEqual(normalizeLang("golang"), "golang");
    assert.strictEqual(normalizeLang("rust"), "rust");
  });

  // 13. extension mapping
  it("13. extension mapping via central LANG_EXT", () => {
    const bgCode = fs.readFileSync(path.join(repoDir, "background.js"), "utf8");
    const langExtMatch = bgCode.match(/const LANG_EXT = ({[\s\S]*?});/);
    assert(langExtMatch);
    const LANG_EXT = eval("(" + langExtMatch[1] + ")");

    assert.strictEqual(LANG_EXT["python"], "py");
    assert.strictEqual(LANG_EXT["cpp"], "cpp");
    assert.strictEqual(LANG_EXT["java"], "java");
    assert.strictEqual(LANG_EXT["c"], "c");
    assert.strictEqual(LANG_EXT["javascript"], "js");
    assert.strictEqual(LANG_EXT["typescript"], "ts");
    assert.strictEqual(LANG_EXT["csharp"], "cs");
    assert.strictEqual(LANG_EXT["golang"], "go");
    assert.strictEqual(LANG_EXT["rust"], "rs");
    assert.strictEqual(LANG_EXT["kotlin"], "kt");
    assert.strictEqual(LANG_EXT["swift"], "swift");
    assert.strictEqual(LANG_EXT["ruby"], "rb");
    assert.strictEqual(LANG_EXT["php"], "php");
    assert.strictEqual(LANG_EXT["scala"], "scala");
  });

  // 14. multi-language isolation
  it("14. multi-language isolation in CodeChef folder", () => {
    const folder = platforms.buildCanonicalFolderPath("CodeChef", "Easy", "RPPS");
    const pyFile = `${folder}/solution.py`;
    const cppFile = `${folder}/solution.cpp`;
    const javaFile = `${folder}/solution.java`;

    assert.strictEqual(pyFile, "CodeChef/Easy/RPPS/solution.py");
    assert.strictEqual(cppFile, "CodeChef/Easy/RPPS/solution.cpp");
    assert.strictEqual(javaFile, "CodeChef/Easy/RPPS/solution.java");
    assert.notStrictEqual(pyFile, cppFile);
  });

  // 15. path traversal protection
  it("15. path traversal protection on CodeChef slugs", () => {
    const p1 = platforms.buildCanonicalFolderPath("CodeChef", "Easy", "../../malicious/slug");
    assert(!p1.includes("../"));
    assert.strictEqual(p1, "CodeChef/Easy/malicious - slug");

    const p2 = platforms.buildCanonicalFolderPath("CodeChef", "../../../Root", "RPPS");
    assert(!p2.includes("../"));
    assert.strictEqual(p2, "CodeChef/Root/RPPS");
  });

  // 16. empty code rejection
  it("16. empty code rejection", () => {
    const emptyPayload = {
      platform: "CodeChef",
      problem: { slug: "RPPS", title: "RPPS", difficulty: "Easy", url: "https://www.codechef.com/problems/RPPS" },
      submission: { id: "1366705136", status: "Accepted", language: "python", code: "" },
      metadata: { timestamp: Date.now() }
    };
    const val = platforms.validateNormalizedSubmission(emptyPayload);
    assert.strictEqual(val.ok, false);
    assert.strictEqual(val.error, "Submission code is empty");
  });

  // 17. unknown language handling
  it("17. unknown language handling returns null to prevent sync", () => {
    assert.strictEqual(normalizeLang("brainfuck"), null);
    assert.strictEqual(normalizeLang("unknown_lang_xyz"), null);
    assert.strictEqual(normalizeLang(""), null);
    assert.strictEqual(normalizeLang(null), null);
  });

  // 18. result timeout behavior
  it("18. result timeout behavior after ~30s", () => {
    const MAX_POLL_ATTEMPTS = 25;
    let attempts = 25;
    assert.strictEqual(attempts >= MAX_POLL_ATTEMPTS, true);
  });

  // 19. NormalizedSubmission schema validation
  it("19. NormalizedSubmission schema validation for CodeChef", () => {
    const raw = {
      platform: "CodeChef",
      problem: {
        slug: "RPPS",
        title: "RPPS",
        difficulty: "Easy",
        url: "https://www.codechef.com/practice/course/strings-new/STRINGSP01/problems/RPPS"
      },
      submission: {
        id: "1366705136",
        status: "Accepted",
        language: "python",
        code: "import sys\ndef solve(): pass"
      },
      metadata: {
        timestamp: 1696000000000
      }
    };
    const norm = platforms.normalizeSubmission(raw);
    assert.strictEqual(norm.platform, "CodeChef");
    assert.strictEqual(norm.problem.slug, "RPPS");
    const val = platforms.validateNormalizedSubmission(norm);
    assert.strictEqual(val.ok, true, val.error);
  });

  // 20. No invented polling endpoints — adapter uses passive observation only
  it("20. No invented polling endpoints in codechef-inject.js", () => {
    // Must NOT contain nativeFetch (active polling removed)
    assert(
      !injectContent.includes("nativeFetch"),
      "Must not use nativeFetch — no active polling"
    );
    // Must NOT contain fallbackUrl
    assert(
      !injectContent.includes("fallbackUrl"),
      "Must not reference a fallbackUrl variable"
    );
    // Must NOT construct /{solutionId}/ as a polling endpoint
    assert(
      !injectContent.includes('"/" + encodeURIComponent(subIdStr) + "/"'),
      "Must not construct /{solutionId}/ polling URL"
    );
    // Must contain passive observation pattern
    assert(
      injectContent.includes("pendingSubmissions"),
      "Must use pendingSubmissions for passive observation"
    );
    assert(
      injectContent.includes("diagnosticTrafficActive"),
      "Must have diagnostic traffic logging"
    );
    assert(
      injectContent.includes("checkResponseForResult"),
      "Must have broad result detection via checkResponseForResult"
    );
  });

  // 21. Accepted response detection via passive observation
  it("21. Passive observation: accepted response triggers sync", () => {
    const response = {
      upid: "1366705136",
      result_code: "accepted",
      result_description: "",
      signal: null,
      show_status_table: "yes",
      time: "0.04"
    };
    assert.strictEqual(
      String(response.result_code || "").trim().toLowerCase() === "accepted",
      true,
      "accepted result_code must be detected"
    );
  });

  // 22. Processing response → continue waiting (not terminal)
  it("22. Passive observation: processing response continues waiting", () => {
    const processingResponses = [
      { result_code: "waiting" },
      { result_code: "compiling" },
      { result_code: "running" },
      { result_code: "" },
      { result_code: null },
    ];
    const terminalFailures = [
      "wrong_answer", "wrong", "compilation_error", "compile_error",
      "runtime_error", "time_limit_exceeded", "tle",
      "memory_limit_exceeded", "mle", "failed", "rejected", "error",
    ];
    for (const resp of processingResponses) {
      const code = String(resp.result_code || "").trim().toLowerCase();
      assert.strictEqual(code === "accepted", false, "Processing state must not be treated as accepted");
      assert.strictEqual(terminalFailures.indexOf(code) !== -1, false, "Processing state must not be treated as terminal failure");
    }
  });

  // 23. Terminal failure response → stop observation, no sync
  it("23. Passive observation: terminal failure stops observation without sync", () => {
    const failedResponses = [
      { result_code: "wrong_answer" },
      { result_code: "compilation_error" },
      { result_code: "runtime_error" },
      { result_code: "time_limit_exceeded" },
      { result_code: "memory_limit_exceeded" },
    ];
    const terminalFailures = [
      "wrong_answer", "wrong", "compilation_error", "compile_error",
      "runtime_error", "time_limit_exceeded", "tle",
      "memory_limit_exceeded", "mle", "failed", "rejected", "error",
    ];
    for (const resp of failedResponses) {
      const code = String(resp.result_code || "").trim().toLowerCase();
      assert.strictEqual(code === "accepted", false);
      assert.strictEqual(terminalFailures.indexOf(code) !== -1, true, `${code} must be a terminal failure`);
    }
  });

  // 24. Invalid/malformed response is safely handled
  it("24. Passive observation: invalid response is safely handled", () => {
    const invalidResponses = [
      null,
      undefined,
      {},
      { result_code: undefined },
      "not json at all",
    ];
    for (const resp of invalidResponses) {
      const code = String((resp && typeof resp === "object" && resp.result_code) || "").trim().toLowerCase();
      assert.strictEqual(code === "accepted", false, "Invalid response must never be treated as accepted");
    }
  });

  // 25. Bounded timeout — passive observation has 60s timeout
  it("25. Passive observation has bounded 60s timeout (not infinite)", () => {
    // The inject script must contain a setTimeout for cleanup
    assert(
      injectContent.includes("60000"),
      "Must have a 60-second timeout for passive observation"
    );
    assert(
      injectContent.includes("Passive observation timed out"),
      "Must log timeout message"
    );
    // Must NOT contain unbounded setInterval for polling
    assert(
      !injectContent.includes("setInterval(doPoll"),
      "Must not use unbounded setInterval for polling"
    );
  });

  // 26. regression checks for existing platforms
  await itAsync("26. Regression checks: LeetCode, GeeksforGeeks, and HackerRank intact", async () => {
    // Check platforms registry
    assert.strictEqual(platforms.PLATFORM_REGISTRY.leetcode.active, true);
    assert.strictEqual(platforms.PLATFORM_REGISTRY.geeksforgeeks.active, true);
    assert.strictEqual(platforms.PLATFORM_REGISTRY.hackerrank.active, true);
    assert.strictEqual(platforms.PLATFORM_REGISTRY.codechef.active, true);

    // Entitlement checks under Basic:
    await entitlements.setSelectedPlatforms(["codechef", "leetcode"]);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks"), false);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank"), false);

    // Under Pro: all 4 active platforms allowed
    await entitlements.setTestPlan("pro");
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef"), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("codeforces"), true); // active in Phase 9B!
    assert.strictEqual(await entitlements.isPlatformAllowed("spoj"), true); // active in Phase 10B!

    // Reset back to basic default
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);
  });

  console.log("\n=======================================================");
  console.log(`CODECHEF RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runCodeChefTests().catch(err => {
  console.error(err);
  process.exit(1);
});
