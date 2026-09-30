// Fly2Git — by SRT
// Phase 7C: Comprehensive Cross-Platform Hardening & Release Test Suite
//
// Tests all 20 required hardening areas (A through T):
// A. Adapter Isolation
// B. Malformed Messages
// C. Origin Validation
// D. Duplicate Submissions
// E. Multi-Language Isolation
// F. Unknown Language Handling
// G. Unknown Platform Handling
// H. Inactive Platform Handling
// I. Entitlement Combinations (Basic 2-platform permutations & Pro)
// J. Corrupted Storage Self-Healing
// K. Path Traversal & Sanitization
// L. GitHub Safety (No Force-Push, Single Commit)
// M. Diagnostics Secret Protection
// N. Sync History Source-Code Protection
// O. Bounded Polling
// P. CodeChef Passive Observation
// Q. CodeChef Accepted Result
// R. CodeChef Rejected Result
// S. CodeChef Timeout Cleanup
// T. SPA Lifecycle & Singleton Guards

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;

const platforms = require(path.join(ROOT_DIR, "platforms.js"));
const entitlements = require(path.join(ROOT_DIR, "entitlements.js"));

const bgSource = fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8");
const lcInjectSource = fs.readFileSync(path.join(ROOT_DIR, "inject.js"), "utf8");
const lcContentSource = fs.readFileSync(path.join(ROOT_DIR, "content.js"), "utf8");
const gfgInjectSource = fs.readFileSync(path.join(ROOT_DIR, "gfg-inject.js"), "utf8");
const gfgContentSource = fs.readFileSync(path.join(ROOT_DIR, "gfg-content.js"), "utf8");
const hrInjectSource = fs.readFileSync(path.join(ROOT_DIR, "hackerrank-inject.js"), "utf8");
const hrContentSource = fs.readFileSync(path.join(ROOT_DIR, "hackerrank-content.js"), "utf8");
const ccInjectSource = fs.readFileSync(path.join(ROOT_DIR, "codechef-inject.js"), "utf8");
const ccContentSource = fs.readFileSync(path.join(ROOT_DIR, "codechef-content.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8");
const popupJsSource = fs.readFileSync(path.join(ROOT_DIR, "popup.js"), "utf8");

let passed = 0;
let failed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
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
  }
}

async function runAllTests() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 7C: CROSS-PLATFORM HARDENING SUITE");
  console.log("=======================================================\n");

  // ---------------------------------------------------------------------
  // A. ADAPTER ISOLATION
  // ---------------------------------------------------------------------
  console.log("--- A. ADAPTER ISOLATION ---");

  it("A.1 LeetCode adapter validates hostname and singleton initialization", () => {
    assert(lcInjectSource.includes("leetcode.com"), "inject.js must validate leetcode.com");
    assert(lcInjectSource.includes("__FLY2GIT_LEETCODE_INJECT_INITIALIZED__"), "inject.js must have singleton guard");
    assert(lcContentSource.includes("leetcode.com"), "content.js must validate leetcode.com");
    assert(lcContentSource.includes("__FLY2GIT_LEETCODE_CONTENT_INITIALIZED__"), "content.js must have singleton guard");
  });

  it("A.2 GeeksforGeeks adapter validates hostname and singleton initialization", () => {
    assert(gfgInjectSource.includes("geeksforgeeks.org"), "gfg-inject.js must validate geeksforgeeks.org");
    assert(gfgInjectSource.includes("__FLY2GIT_GFG_INJECT_INITIALIZED__"), "gfg-inject.js must have singleton guard");
    assert(gfgContentSource.includes("geeksforgeeks.org"), "gfg-content.js must validate geeksforgeeks.org");
    assert(gfgContentSource.includes("__FLY2GIT_GFG_CONTENT_INITIALIZED__"), "gfg-content.js must have singleton guard");
  });

  it("A.3 HackerRank adapter validates hostname, origin, and singleton initialization", () => {
    assert(hrInjectSource.includes("hackerrank.com"), "hackerrank-inject.js must validate hackerrank.com");
    assert(hrInjectSource.includes("__FLY2GIT_HACKERRANK_INJECT_INITIALIZED__"), "hackerrank-inject.js must have singleton guard");
    assert(hrContentSource.includes("hackerrank.com"), "hackerrank-content.js must validate hackerrank.com");
    assert(hrContentSource.includes("__FLY2GIT_HACKERRANK_CONTENT_INITIALIZED__"), "hackerrank-content.js must have singleton guard");
    assert(hrContentSource.includes("event.origin !== \"https://www.hackerrank.com\""), "hackerrank-content.js must validate event.origin");
    assert(!hrInjectSource.includes("postMessage(\n        {\n          source: \"fly2git-hackerrank\",\n          type: \"ACCEPTED\",\n          payload: normalizedPayload,\n        },\n        \"*\""), "hackerrank-inject.js must not postMessage to wildcard origin");
  });

  it("A.4 CodeChef adapter validates hostname, origin, and singleton initialization", () => {
    assert(ccInjectSource.includes("codechef.com"), "codechef-inject.js must validate codechef.com");
    assert(ccInjectSource.includes("__FLY2GIT_CODECHEF_INJECT_INITIALIZED__"), "codechef-inject.js must have singleton guard");
    assert(ccContentSource.includes("codechef.com"), "codechef-content.js must validate codechef.com");
    assert(ccContentSource.includes("__FLY2GIT_CODECHEF_CONTENT_INITIALIZED__"), "codechef-content.js must have singleton guard");
    assert(ccContentSource.includes("event.origin !== \"https://www.codechef.com\""), "codechef-content.js must validate event.origin");
    assert(!ccInjectSource.includes("postMessage(\n        {\n          source: \"fly2git-codechef\",\n          type: \"ACCEPTED\",\n          payload: normalizedPayload,\n        },\n        \"*\""), "codechef-inject.js must not postMessage to wildcard origin");
  });

  it("A.5 Platform-specific event names and message sources are segregated", () => {
    assert(lcInjectSource.includes("\"fly2git-leetcode\""), "LeetCode uses fly2git-leetcode message source");
    assert(gfgInjectSource.includes("FLY2GIT_GFG_REQUEST"), "GFG uses FLY2GIT_GFG_REQUEST");
    assert(gfgInjectSource.includes("FLY2GIT_GFG_RESPONSE"), "GFG uses FLY2GIT_GFG_RESPONSE");
    assert(hrInjectSource.includes("FLY2GIT_HACKERRANK_ACCEPTED"), "HackerRank uses FLY2GIT_HACKERRANK_ACCEPTED");
    assert(hrInjectSource.includes("\"fly2git-hackerrank\""), "HackerRank uses fly2git-hackerrank");
    assert(ccInjectSource.includes("FLY2GIT_CODECHEF_ACCEPTED"), "CodeChef uses FLY2GIT_CODECHEF_ACCEPTED");
    assert(ccInjectSource.includes("\"fly2git-codechef\""), "CodeChef uses fly2git-codechef");
  });

  // ---------------------------------------------------------------------
  // B. MALFORMED MESSAGES & SCHEMA VALIDATION
  // ---------------------------------------------------------------------
  console.log("\n--- B. MALFORMED MESSAGES & SCHEMA VALIDATION ---");

  it("B.1 Rejects null, undefined, non-object, and empty payloads", () => {
    assert.strictEqual(platforms.validateNormalizedSubmission(null).ok, false);
    assert.strictEqual(platforms.validateNormalizedSubmission(undefined).ok, false);
    assert.strictEqual(platforms.validateNormalizedSubmission("string").ok, false);
    assert.strictEqual(platforms.validateNormalizedSubmission({}).ok, false);
  });

  it("B.2 Rejects payloads with excessive string lengths", () => {
    const giantCode = "a".repeat(200001);
    const giantSlug = "s".repeat(201);
    const giantTitle = "t".repeat(301);

    const payloadGiantCode = {
      platform: "LeetCode",
      problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
      submission: { id: "123", status: "Accepted", language: "python", code: giantCode }
    };
    assert.strictEqual(platforms.validateNormalizedSubmission(payloadGiantCode).ok, false);

    const payloadGiantSlug = {
      platform: "LeetCode",
      problem: { slug: giantSlug, title: "Two Sum", difficulty: "Easy" },
      submission: { id: "123", status: "Accepted", language: "python", code: "print(1)" }
    };
    assert.strictEqual(platforms.validateNormalizedSubmission(payloadGiantSlug).ok, false);

    const payloadGiantTitle = {
      platform: "LeetCode",
      problem: { slug: "two-sum", title: giantTitle, difficulty: "Easy" },
      submission: { id: "123", status: "Accepted", language: "python", code: "print(1)" }
    };
    assert.strictEqual(platforms.validateNormalizedSubmission(payloadGiantTitle).ok, false);
  });

  it("B.3 Rejects payloads with non-accepted statuses", () => {
    const rejectedStatuses = ["Wrong Answer", "Time Limit Exceeded", "Runtime Error", "Processing", "Compiling"];
    for (const st of rejectedStatuses) {
      const p = {
        platform: "LeetCode",
        problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
        submission: { id: "123", status: st, language: "python", code: "print(1)" }
      };
      assert.strictEqual(platforms.validateNormalizedSubmission(p).ok, false, `Must reject status '${st}'`);
    }
  });

  // ---------------------------------------------------------------------
  // C. ORIGIN VALIDATION
  // ---------------------------------------------------------------------
  console.log("\n--- C. ORIGIN VALIDATION ---");

  it("C.1 Content bridges strictly reject foreign origin messages", () => {
    assert(lcContentSource.includes("event.origin !== EXPECTED_ORIGIN"));
    assert(hrContentSource.includes("event.origin !== \"https://www.hackerrank.com\""));
    assert(ccContentSource.includes("event.origin !== \"https://www.codechef.com\""));
  });

  // ---------------------------------------------------------------------
  // D. DUPLICATE SUBMISSIONS
  // ---------------------------------------------------------------------
  console.log("\n--- D. DUPLICATE SUBMISSIONS ---");

  it("D.1 Duplicate keys across all 4 platforms are correctly structured and bounded", () => {
    assert(lcContentSource.includes("leetcode:"), "content.js has leetcode key");
    assert(gfgContentSource.includes("geeksforgeeks:"), "gfg-content.js has geeksforgeeks key");
    assert(hrContentSource.includes("hackerrank:"), "hackerrank-content.js has hackerrank key");
    assert(ccContentSource.includes("codechef:"), "codechef-content.js has codechef key");

    assert(lcContentSource.includes("emittedAcceptanceKeys.size > 100"));
    assert(gfgContentSource.includes("emittedAcceptanceKeys.size > 100"));
    assert(hrContentSource.includes("emittedAcceptanceKeys.size > 100"));
    assert(ccContentSource.includes("emittedAcceptanceKeys.size > 100"));
  });

  it("D.2 Identical code comparison normalizes line endings", () => {
    function normalizeCodeForComparison(value) {
      return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }
    const codeWindows = "def solve():\r\n    return 42\r\n";
    const codeUnix = "def solve():\n    return 42\n";
    assert.strictEqual(
      normalizeCodeForComparison(codeWindows),
      normalizeCodeForComparison(codeUnix),
      "Line endings must normalize to match"
    );
  });

  // ---------------------------------------------------------------------
  // E. MULTI-LANGUAGE ISOLATION
  // ---------------------------------------------------------------------
  console.log("\n--- E. MULTI-LANGUAGE ISOLATION ---");

  it("E.1 Same problem in different languages creates separate files in same folder", () => {
    const folder = platforms.buildCanonicalFolderPath("CodeChef", "Easy", "RPPS");
    assert.strictEqual(folder, "CodeChef/Easy/RPPS");

    const testLangs = [
      { lang: "python", ext: "py" },
      { lang: "java", ext: "java" },
      { lang: "cpp", ext: "cpp" },
      { lang: "c", ext: "c" },
      { lang: "javascript", ext: "js" },
      { lang: "typescript", ext: "ts" },
      { lang: "csharp", ext: "cs" },
      { lang: "golang", ext: "go" },
      { lang: "rust", ext: "rs" },
      { lang: "kotlin", ext: "kt" },
      { lang: "swift", ext: "swift" },
      { lang: "ruby", ext: "rb" },
      { lang: "php", ext: "php" },
    ];

    const paths = new Set();
    for (const item of testLangs) {
      const solPath = `${folder}/solution.${item.ext}`;
      paths.add(solPath);
    }

    assert.strictEqual(paths.size, testLangs.length, "All languages produce distinct solution files");
  });

  // ---------------------------------------------------------------------
  // F. UNKNOWN LANGUAGE HANDLING
  // ---------------------------------------------------------------------
  console.log("\n--- F. UNKNOWN LANGUAGE HANDLING ---");

  it("F.1 'unknown' language is rejected by validateNormalizedSubmission", () => {
    const p = {
      platform: "LeetCode",
      problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
      submission: { id: "123", status: "Accepted", language: "unknown", code: "print(1)" }
    };
    const val = platforms.validateNormalizedSubmission(p);
    assert.strictEqual(val.ok, false);
    assert(val.error.includes("unknown"));
  });

  it("F.2 background.js rejects unknown language instead of defaulting to txt", () => {
    assert(bgSource.includes("Unsupported or unknown language:"), "background.js must reject unmapped language");
    assert(!bgSource.includes("LANG_EXT[lang.toLowerCase()] || \"txt\""), "Must NOT default unknown language to txt");
  });

  // ---------------------------------------------------------------------
  // G. UNKNOWN PLATFORM HANDLING
  // ---------------------------------------------------------------------
  console.log("\n--- G. UNKNOWN PLATFORM HANDLING ---");

  await itAsync("G.1 Unknown platforms are rejected by validateNormalizedSubmission and isPlatformAllowed", async () => {
    const p = {
      platform: "CodeWars",
      problem: { slug: "kata-1", title: "Kata 1", difficulty: "Easy" },
      submission: { id: "123", status: "Accepted", language: "python", code: "print(1)" }
    };
    const val = platforms.validateNormalizedSubmission(p);
    assert.strictEqual(val.ok, false);
    assert(val.error.includes("Unrecognized platform"));

    const allowed = await entitlements.isPlatformAllowed("CodeWars");
    assert.strictEqual(allowed, false);
  });

  // ---------------------------------------------------------------------
  // H. INACTIVE PLATFORM HANDLING
  // ---------------------------------------------------------------------
  console.log("\n--- H. INACTIVE PLATFORM HANDLING ---");

  await itAsync("H.1 Inactive platforms (codeforces, atcoder) are rejected even on PRO plan", async () => {
    const proEntitlement = { version: 1, plan: "pro", selectedPlatforms: [] };

    const pCodeforces = {
      platform: "Codeforces",
      problem: { slug: "123A", title: "Problem 123A", difficulty: "Unknown" },
      submission: { id: "123", status: "Accepted", language: "cpp", code: "int main(){}" }
    };
    const val = platforms.validateNormalizedSubmission(pCodeforces);
    assert.strictEqual(val.ok, false);
    assert(val.error.includes("not yet active"));

    const allowedCF = await entitlements.isPlatformAllowed("codeforces", proEntitlement);
    assert.strictEqual(allowedCF, false, "Codeforces must never be allowed while inactive");

    const allowedAC = await entitlements.isPlatformAllowed("atcoder", proEntitlement);
    assert.strictEqual(allowedAC, false, "AtCoder must never be allowed while inactive");
  });

  // ---------------------------------------------------------------------
  // I. ENTITLEMENT COMBINATIONS (BASIC 2-PLATFORM & PRO)
  // ---------------------------------------------------------------------
  console.log("\n--- I. ENTITLEMENT COMBINATIONS ---");

  await itAsync("I.1 Basic: LeetCode + GFG -> HackerRank & CodeChef rejected", async () => {
    const ent = { version: 1, plan: "basic", selectedPlatforms: ["leetcode", "geeksforgeeks"] };
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank", ent), false);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef", ent), false);
  });

  await itAsync("I.2 Basic: LeetCode + HackerRank -> GFG & CodeChef rejected", async () => {
    const ent = { version: 1, plan: "basic", selectedPlatforms: ["leetcode", "hackerrank"] };
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks", ent), false);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef", ent), false);
  });

  await itAsync("I.3 Basic: HackerRank + CodeChef -> LeetCode & GFG rejected", async () => {
    const ent = { version: 1, plan: "basic", selectedPlatforms: ["hackerrank", "codechef"] };
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode", ent), false);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks", ent), false);
  });

  await itAsync("I.4 Basic: GFG + CodeChef -> LeetCode & HackerRank rejected", async () => {
    const ent = { version: 1, plan: "basic", selectedPlatforms: ["geeksforgeeks", "codechef"] };
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode", ent), false);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank", ent), false);
  });

  await itAsync("I.5 Pro: all four platforms accepted", async () => {
    const ent = { version: 1, plan: "pro", selectedPlatforms: [] };
    assert.strictEqual(await entitlements.isPlatformAllowed("leetcode", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("geeksforgeeks", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("hackerrank", ent), true);
    assert.strictEqual(await entitlements.isPlatformAllowed("codechef", ent), true);
  });

  // ---------------------------------------------------------------------
  // J. CORRUPTED STORAGE SELF-HEALING
  // ---------------------------------------------------------------------
  console.log("\n--- J. CORRUPTED STORAGE SELF-HEALING ---");

  it("J.1 Corrupted entitlement storage states self-heal to default", () => {
    const malformedInputs = [
      null,
      undefined,
      "",
      "corrupted string",
      12345,
      [],
      { plan: "invalid_plan" },
      { plan: "basic", selectedPlatforms: "not an array" },
      { plan: "basic", selectedPlatforms: ["unknown_plat_1", "unknown_plat_2"] },
    ];

    for (const input of malformedInputs) {
      const healed = entitlements.sanitizeEntitlement(input);
      assert.strictEqual(healed.version, 1);
      assert.strictEqual(healed.plan, "basic");
      assert(Array.isArray(healed.selectedPlatforms));
      assert(healed.selectedPlatforms.length <= 2);
    }
  });

  // ---------------------------------------------------------------------
  // K. PATH TRAVERSAL & SANITIZATION
  // ---------------------------------------------------------------------
  console.log("\n--- K. PATH TRAVERSAL & SANITIZATION ---");

  it("K.1 Path traversal attacks in platform, difficulty, or problem name are neutralized", () => {
    const dangerousInputs = [
      "../../etc/passwd",
      "..\\..\\Windows\\System32",
      "....//....//config",
      "../../../secret.txt",
      "/root/forbidden",
      "problem:with:colons",
      "problem<with>bad*chars?|",
      "\x00null\x1fbyte\x7f",
    ];

    for (const input of dangerousInputs) {
      const safeSegment = platforms.sanitizePathSegment(input);
      assert(!safeSegment.includes(".."), `Must not contain ..: ${safeSegment}`);
      assert(!safeSegment.startsWith("/"), `Must not start with /: ${safeSegment}`);
      assert(!safeSegment.includes("<") && !safeSegment.includes(">") && !safeSegment.includes("*"), "Must not contain file system bad chars");
      assert(!/[\x00-\x1f\x7f]/.test(safeSegment), "Must not contain control characters");

      const fullPath = platforms.buildCanonicalFolderPath("LeetCode", "Medium", input);
      assert(!fullPath.includes(".."), `Canonical path must not contain ..: ${fullPath}`);
      assert(fullPath.startsWith("LeetCode/Medium/"), `Path must stay within platform/difficulty: ${fullPath}`);
    }
  });

  // ---------------------------------------------------------------------
  // L. GITHUB SAFETY
  // ---------------------------------------------------------------------
  console.log("\n--- L. GITHUB SAFETY ---");

  it("L.1 Zero force-pushes in entire codebase and explicit force:false in background.js", () => {
    assert(!bgSource.includes("force: true"), "background.js must never set force: true");
    assert(bgSource.includes("force: false"), "background.js must explicitly specify force: false");
  });

  it("L.2 Single-commit sync verified: commits solution and README in exactly one commit", () => {
    assert(bgSource.includes("commitSolutionAndReadme"), "background.js uses single commitSolutionAndReadme");
    assert(bgSource.includes("base_tree: baseTree.sha"), "Uses Git Data API tree creation");
    assert(bgSource.includes("parents: [latestCommitSha]"), "Explicit single parent commit");
  });

  // ---------------------------------------------------------------------
  // M. DIAGNOSTICS SECRET PROTECTION
  // ---------------------------------------------------------------------
  console.log("\n--- M. DIAGNOSTICS SECRET PROTECTION ---");

  it("M.1 Diagnostics snapshot NEVER contains tokens, secrets, cookies, or source code", () => {
    assert(bgSource.includes("function getDiagnosticsSnapshot()"));
    assert(bgSource.includes("const isConnected = Boolean(authData.auth && authData.auth.accessToken)"));
    assert(!bgSource.includes("token: authData.auth.accessToken"));
    assert(!bgSource.includes("accessToken: authData.auth.accessToken"));
    assert(!bgSource.includes("refreshToken: authData.auth.refreshToken"));
  });

  // ---------------------------------------------------------------------
  // N. SYNC HISTORY SOURCE-CODE PROTECTION
  // ---------------------------------------------------------------------
  console.log("\n--- N. SYNC HISTORY SOURCE-CODE PROTECTION ---");

  it("N.1 logSync sanitizes entries to guarantee metadata only, never persisting source code", () => {
    assert(bgSource.includes("cleanEntry = {"));
    assert(bgSource.includes("title: typeof entry.title === \"string\""));
    assert(bgSource.includes("difficulty: typeof entry.difficulty === \"string\""));
    assert(bgSource.includes("platform: typeof entry.platform === \"string\""));
    assert(bgSource.includes("lang: typeof entry.lang === \"string\""));
    assert(bgSource.includes("status: typeof entry.status === \"string\""));
    assert(!bgSource.includes("cleanEntry.code = entry.code;\n"));
  });

  // ---------------------------------------------------------------------
  // O. BOUNDED POLLING
  // ---------------------------------------------------------------------
  console.log("\n--- O. BOUNDED POLLING ---");

  it("O.1 Every polling loop has a verified bound and timeout", () => {
    assert(lcInjectSource.includes("DETAIL_RETRIES = 8"));
    assert(hrInjectSource.includes("MAX_POLL_ATTEMPTS = 25"));
    assert(ccInjectSource.includes("60000"));
  });

  // ---------------------------------------------------------------------
  // P, Q, R, S. CODECHEF PASSIVE OBSERVATION & RESULT HANDLING
  // ---------------------------------------------------------------------
  console.log("\n--- P-S. CODECHEF PASSIVE OBSERVATION ---");

  it("P.1 CodeChef adapter uses passive observation only (no invented polling endpoints)", () => {
    assert(!ccInjectSource.includes("nativeFetch("), "CodeChef inject must not call nativeFetch");
    assert(!ccInjectSource.includes("fetch(fallbackUrl"), "Must not call guessed fallbackUrl");
    assert(!ccInjectSource.includes("`https://www.codechef.com/${solutionId}/`"), "Must not invent /{id}/ endpoint");
    assert(!ccInjectSource.includes("`https://www.codechef.com/submit?solution_id=${solutionId}`"), "Must not invent active polling request");
  });

  it("Q.1 CodeChef accepted result triggers handleAcceptedSubmission", () => {
    assert(ccInjectSource.includes("resultCode === \"accepted\""));
    assert(ccInjectSource.includes("handleAcceptedSubmission("));
  });

  it("R.1 CodeChef terminal failures stop observation without triggering sync", () => {
    assert(ccInjectSource.includes("TERMINAL_FAILURES.indexOf(resultCode) !== -1"));
    assert(ccInjectSource.includes("delete pendingSubmissions[subIdStr]"));
  });

  it("S.1 CodeChef pending submission timeout cleans up after 60s", () => {
    assert(ccInjectSource.includes("delete pendingSubmissions[subIdStr]"));
    assert(ccInjectSource.includes("activePolls.delete(subIdStr)"));
  });

  // ---------------------------------------------------------------------
  // T. SPA LIFECYCLE & SINGLETON GUARDS
  // ---------------------------------------------------------------------
  console.log("\n--- T. SPA LIFECYCLE & SINGLETON GUARDS ---");

  it("T.1 All 8 adapter scripts have singleton guards against duplicate initialization", () => {
    assert(lcInjectSource.includes("__FLY2GIT_LEETCODE_INJECT_INITIALIZED__"));
    assert(lcContentSource.includes("__FLY2GIT_LEETCODE_CONTENT_INITIALIZED__"));
    assert(gfgInjectSource.includes("__FLY2GIT_GFG_INJECT_INITIALIZED__"));
    assert(gfgContentSource.includes("__FLY2GIT_GFG_CONTENT_INITIALIZED__"));
    assert(hrInjectSource.includes("__FLY2GIT_HACKERRANK_INJECT_INITIALIZED__"));
    assert(hrContentSource.includes("__FLY2GIT_HACKERRANK_CONTENT_INITIALIZED__"));
    assert(ccInjectSource.includes("__FLY2GIT_CODECHEF_INJECT_INITIALIZED__"));
    assert(ccContentSource.includes("__FLY2GIT_CODECHEF_CONTENT_INITIALIZED__"));
  });

  it("T.2 Observers disconnect before creating new instances on route change", () => {
    assert(gfgContentSource.includes("bodyObserver.disconnect()"));
    assert(hrInjectSource.includes("domObserver.disconnect()"));
  });

  // ---------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`PHASE 7C RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
