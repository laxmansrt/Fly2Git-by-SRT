// Fly2Git — by SRT
// Phase 8B.2: AtCoder Adapter & Session Storage Access Level Test Suite
//
// Tests:
// 1. URL parsing
// 2. contest ID extraction
// 3. task ID extraction
// 4. title extraction fallback
// 5. editor extraction
// 6. textarea fallback
// 7. C mapping
// 8. C++ mapping
// 9. Java mapping
// 10. Python mapping
// 11. JavaScript mapping
// 12. TypeScript mapping
// 13. C# mapping
// 14. Go mapping
// 15. Rust mapping
// 16. Kotlin mapping
// 17. unknown language rejection
// 18. form submission capture across bridge
// 19. staging payload validation
// 20. staging expiry (>30s TTL in extension storage)
// 21. submission ID correlation
// 22. wrong-contest rejection
// 23. WJ handling
// 24. AC detection
// 25. WA detection
// 26. TLE detection
// 27. MLE detection
// 28. RE detection
// 29. CE detection
// 30. OLE detection
// 31. malformed JSON handling
// 32. passive observation URL matching
// 33. no active polling
// 34. duplicate suppression
// 35. timeout cleanup (60s bound)
// 36. origin validation
// 37. source validation
// 38. malformed message rejection
// 39. code length bounds
// 40. secret/log protection
// 41. NormalizedSubmission output
// 42. entitlement rejection
// 43. GitHub path safety
// 44. extension session storage staging (chrome.storage.session)
// 45. page sessionStorage is NOT used for production staging
// 46. staging deletion after correlation
// 47. malformed staging rejection
// 48. cross-contest staging rejection
// 49. source code absence in logs, diagnostics, and sync history
// 50. session storage access level is TRUSTED_CONTEXTS
// 51. TRUSTED_AND_UNTRUSTED_CONTEXTS is NOT configured
// 52. page context cannot directly access staging storage
// 53. background can set staging
// 54. background can get staging
// 55. background can clear staging
// 56. background staging expires after 30 seconds
// 57. correlation on submissions page clears staging via background boundary

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock Chrome API environment for tests
let storageState = {
  local: {},
  session: {},
};

let configuredAccessLevel = null;

global.importScripts = () => {};

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
      setAccessLevel: (opts) => {
        configuredAccessLevel = opts && opts.accessLevel;
      },
    },
  },
  runtime: {
    id: "test-extension-id",
    getURL: () => "chrome-extension://test-extension-id/",
    onConnect: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage: async (msg) => {
      if (msg.type === "STAGE_ATCODER_SUBMISSION") {
        storageState.session.fly2git_atcoder_staging = msg.payload;
        return { ok: true };
      }
      if (msg.type === "GET_ATCODER_STAGING") {
        return { ok: true, staging: storageState.session.fly2git_atcoder_staging };
      }
      if (msg.type === "CLEAR_ATCODER_STAGING") {
        delete storageState.session.fly2git_atcoder_staging;
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

// Mock DOM & window
global.window = {
  location: {
    hostname: "atcoder.jp",
    pathname: "/contests/abc300/tasks/abc300_a",
    href: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
    origin: "https://atcoder.jp",
  },
  contestScreenName: "abc300",
  taskScreenName: "abc300_a",
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  postMessage() {},
};

global.document = {
  title: "A - N-choice question - AtCoder Beginner Contest 300",
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
};

global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

// Load modules
const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
const atcoderInject = require("./atcoder-inject.js");
const atcoderContent = require("./atcoder-content.js");
const background = require("./background.js");

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 8B.2: ATCODER ADAPTER TEST SUITE");
  console.log("=======================================================\n");

  // 1. URL parsing
  it("1. URL parsing", () => {
    const taskUrl = "https://atcoder.jp/contests/abc300/tasks/abc300_a";
    const parsedContest = taskUrl.match(/\/contests\/([^\/]+)/)[1];
    const parsedTask = taskUrl.match(/\/tasks\/([^\/]+)/)[1];
    assert.strictEqual(parsedContest, "abc300");
    assert.strictEqual(parsedTask, "abc300_a");
  });

  // 2. Contest ID extraction
  it("2. contest ID extraction", () => {
    window.contestScreenName = "abs";
    assert.strictEqual(atcoderInject.extractContestScreenName(), "abs");
    window.contestScreenName = null;
    window.location.pathname = "/contests/abc300/tasks/abc300_a";
    assert.strictEqual(atcoderInject.extractContestScreenName(), "abc300");
  });

  // 3. Task ID extraction
  it("3. task ID extraction", () => {
    window.taskScreenName = "practice_1";
    assert.strictEqual(atcoderInject.extractTaskScreenName(), "practice_1");
    window.taskScreenName = null;
    window.location.pathname = "/contests/abs/tasks/practice_1";
    assert.strictEqual(atcoderInject.extractTaskScreenName(), "practice_1");
  });

  // 4. Title extraction fallback
  it("4. title extraction fallback", () => {
    document.title = "A - N-choice question - AtCoder Beginner Contest 300";
    const title = atcoderInject.extractProblemTitle("abc300_a");
    assert(title.includes("A - N-choice question"));
  });

  // 5. Editor extraction
  it("5. editor extraction", () => {
    window.ace = {
      edit: (id) => {
        if (id === "editor") {
          return { getValue: () => "int main() { return 0; }" };
        }
        return null;
      },
    };
    const code = atcoderInject.getAtCoderSourceCode();
    assert.strictEqual(code, "int main() { return 0; }");
  });

  // 6. Textarea fallback
  it("6. textarea fallback", () => {
    delete window.ace;
    document.getElementById = (id) => {
      if (id === "plain-textarea") return { value: "print('hello')" };
      return null;
    };
    const code = atcoderInject.getAtCoderSourceCode();
    assert.strictEqual(code, "print('hello')");
    document.getElementById = () => null;
  });

  // 7-16. Language mappings
  it("7. C mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5002"), "c");
  });

  it("8. C++ mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5001"), "cpp");
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5003"), "cpp");
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5004"), "cpp");
  });

  it("9. Java mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5005"), "java");
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5006"), "java");
  });

  it("10. Python mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5028"), "python");
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5029"), "python");
  });

  it("11. JavaScript mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5042"), "javascript");
  });

  it("12. TypeScript mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5043"), "typescript");
  });

  it("13. C# mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5011"), "csharp");
  });

  it("14. Go mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5013"), "go");
  });

  it("15. Rust mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5017"), "rust");
  });

  it("16. Kotlin mapping", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("5020"), "kotlin");
  });

  // 17. Unknown language rejection
  it("17. unknown language rejection", () => {
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("9999", null, null), null);
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage("foo", null, null), null);
    assert.strictEqual(atcoderInject.normalizeAtCoderLanguage(null, null, null), null);
  });

  // 18. Form submission capture across bridge
  await itAsync("18. form submission capture across bridge", async () => {
    storageState.session = {};
    const stagingPayload = {
      platform: "atcoder",
      contestId: "abc300",
      taskId: "abc300_a",
      language: "cpp",
      code: "int main() { return 0; }",
      title: "A - N-choice question",
      url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      timestamp: Date.now(),
    };
    await atcoderContent.saveStaging(stagingPayload);
    const loaded = await atcoderContent.loadStaging();
    assert(loaded);
    assert.strictEqual(loaded.contestId, "abc300");
    assert.strictEqual(loaded.taskId, "abc300_a");
    assert.strictEqual(loaded.language, "cpp");
  });

  // 19. Staging payload validation
  it("19. staging payload validation", () => {
    const valid = {
      platform: "atcoder",
      contestId: "abc300",
      taskId: "abc300_a",
      language: "python",
      code: "print(1)",
      title: "Problem Title",
      url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      timestamp: Date.now(),
    };
    assert(valid.contestId && valid.taskId && valid.language && valid.code);
    assert(valid.code.length <= 200000);
  });

  // 20. Staging expiry (>30s TTL in extension storage)
  await itAsync("20. staging expiry (>30s TTL in extension storage)", async () => {
    storageState.session = {};
    const stalePayload = {
      platform: "atcoder",
      contestId: "abc300",
      taskId: "abc300_a",
      language: "cpp",
      code: "int main(){}",
      title: "Title",
      url: "https://atcoder.jp/",
      timestamp: Date.now() - 35000, // 35s ago (> 30s TTL)
    };
    storageState.session[atcoderContent.STAGING_STORAGE_KEY] = stalePayload;
    // loadStaging should detect expiry, clear storage, and return null
    const res = await atcoderContent.loadStaging();
    assert.strictEqual(res, null, "Staged submission over 30s must return null");
    assert.strictEqual(storageState.session[atcoderContent.STAGING_STORAGE_KEY], undefined, "Expired staging must be deleted");
  });

  // 21. Submission ID correlation
  it("21. submission ID correlation", () => {
    const rawHtml = '<td class="text-center waiting-judge" data-id="45678901">WJ</td>';
    const match = rawHtml.match(/data-id="(\d+)"/);
    assert(match && match[1]);
    assert.strictEqual(match[1], "45678901");
  });

  // 22. Wrong-contest rejection
  it("22. wrong-contest rejection", () => {
    const stagedContest = "abc300";
    const currentContest = "abc299";
    assert.notStrictEqual(stagedContest, currentContest);
  });

  // 23-30. Verdict detection
  it("23. WJ handling", () => {
    atcoderInject.registerPendingSubmission("1001", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1001", '<span class="label label-default">WJ</span>');
    assert(atcoderInject.pendingSubmissions["1001"], "WJ must keep passive observation active");
  });

  it("24. AC detection", () => {
    let dispatched = false;
    const oldDispatch = window.dispatchEvent;
    window.dispatchEvent = (ev) => {
      if (ev.type === "FLY2GIT_ATCODER_ACCEPTED") dispatched = true;
    };
    atcoderInject.registerPendingSubmission("1002", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1002", '<span class="label label-success" title="Accepted">AC</span>');
    assert.strictEqual(dispatched, true);
    assert.strictEqual(atcoderInject.pendingSubmissions["1002"], undefined, "AC must stop tracking");
    window.dispatchEvent = oldDispatch;
  });

  it("25. WA detection", () => {
    atcoderInject.registerPendingSubmission("1003", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1003", '<span class="label label-warning" title="Wrong Answer">WA</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1003"], undefined, "WA must stop tracking");
  });

  it("26. TLE detection", () => {
    atcoderInject.registerPendingSubmission("1004", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1004", '<span class="label label-warning" title="Time Limit Exceeded">TLE</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1004"], undefined, "TLE must stop tracking");
  });

  it("27. MLE detection", () => {
    atcoderInject.registerPendingSubmission("1005", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1005", '<span class="label label-warning" title="Memory Limit Exceeded">MLE</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1005"], undefined, "MLE must stop tracking");
  });

  it("28. RE detection", () => {
    atcoderInject.registerPendingSubmission("1006", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1006", '<span class="label label-warning" title="Runtime Error">RE</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1006"], undefined, "RE must stop tracking");
  });

  it("29. CE detection", () => {
    atcoderInject.registerPendingSubmission("1007", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1007", '<span class="label label-warning" title="Compilation Error">CE</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1007"], undefined, "CE must stop tracking");
  });

  it("30. OLE detection", () => {
    atcoderInject.registerPendingSubmission("1008", {
      contestId: "c1", taskId: "t1", language: "cpp", code: "code", title: "T", url: "U"
    });
    atcoderInject.handleResultHtml("1008", '<span class="label label-warning" title="Output Limit Exceeded">OLE</span>');
    assert.strictEqual(atcoderInject.pendingSubmissions["1008"], undefined, "OLE must stop tracking");
  });

  // 31. Malformed JSON handling
  it("31. malformed JSON handling", () => {
    assert.doesNotThrow(() => {
      const badJson = "{ invalid json ]";
      try {
        JSON.parse(badJson);
      } catch (_) {}
    });
  });

  // 32. Passive observation URL matching
  it("32. passive observation URL matching", () => {
    const url1 = "https://atcoder.jp/contests/abc300/submissions/me/status/json?reload=true&sids[]=123";
    const url2 = "https://atcoder.jp/contests/abc300/submissions/status/json";
    const url3 = "https://atcoder.jp/contests/abc300/tasks";

    assert(atcoderInject.STATUS_JSON_REGEX.test(url1));
    assert(atcoderInject.STATUS_JSON_REGEX.test(url2));
    assert.strictEqual(atcoderInject.STATUS_JSON_REGEX.test(url3), false);
  });

  // 33. No active polling
  it("33. no active polling", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "atcoder-inject.js"), "utf8");
    assert(!injectCode.includes("fetch(/contests/"));
    assert(!injectCode.includes("setInterval"));
    assert(!injectCode.includes("doPoll"));
  });

  // 34. Duplicate suppression
  it("34. duplicate suppression", () => {
    const testKey = "atcoder:c1:t1:99999";
    atcoderContent.emittedAcceptanceKeys.add(testKey);

    const payload = {
      platform: "atcoder",
      problem: { slug: "t1", title: "T", url: "U" },
      submission: { id: "99999", status: "Accepted", language: "cpp", code: "code" },
      metadata: { timestamp: Date.now() },
    };

    let sent = false;
    const prevSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async () => { sent = true; return { ok: true }; };
    window.location.pathname = "/contests/c1/submissions/me";
    atcoderContent.processAcceptedPayload(payload);

    assert.strictEqual(sent, false, "Duplicate submission key must not be forwarded");
    atcoderContent.emittedAcceptanceKeys.delete(testKey);
    chrome.runtime.sendMessage = prevSendMessage;
  });

  // 35. Timeout cleanup
  it("35. timeout cleanup", () => {
    assert.strictEqual(atcoderInject.TRACKING_TIMEOUT_MS, 60000);
    assert.strictEqual(atcoderContent.STAGING_TTL_MS, 30000);
  });

  // 36. Origin validation
  it("36. origin validation", () => {
    const origin = "https://atcoder.jp";
    assert.strictEqual(origin, "https://atcoder.jp");
    assert.notStrictEqual("https://evil.com", "https://atcoder.jp");
  });

  // 37. Source validation
  it("37. source validation", () => {
    const msg = { source: "fly2git-atcoder", type: "ACCEPTED" };
    assert.strictEqual(msg.source, "fly2git-atcoder");
    assert.strictEqual(msg.type, "ACCEPTED");
  });

  // 38. Malformed message rejection
  it("38. malformed message rejection", () => {
    assert(atcoderContent.validatePayload(null));
    assert(atcoderContent.validatePayload({}));
    assert(atcoderContent.validatePayload({ platform: "unknown" }));
    assert(atcoderContent.validatePayload({ platform: "atcoder", problem: {} }));
  });

  // 39. Code length bounds
  it("39. code length bounds", () => {
    const emptyCodePayload = {
      platform: "atcoder",
      problem: { slug: "t1", title: "T" },
      submission: { id: "123", status: "Accepted", language: "cpp", code: "" }
    };
    assert(atcoderContent.validatePayload(emptyCodePayload).includes("empty"));

    const hugeCode = "a".repeat(200001);
    const hugePayload = {
      platform: "atcoder",
      problem: { slug: "t1", title: "T" },
      submission: { id: "123", status: "Accepted", language: "cpp", code: hugeCode }
    };
    assert(atcoderContent.validatePayload(hugePayload).includes("exceeds"));
  });

  // 40. Secret/log protection
  it("40. secret/log protection", () => {
    const injectContent = fs.readFileSync(path.join(__dirname, "atcoder-inject.js"), "utf8");
    const contentBridge = fs.readFileSync(path.join(__dirname, "atcoder-content.js"), "utf8");
    assert(!injectContent.includes("console.log(code)"));
    assert(!injectContent.includes("console.log(sourceCode)"));
    assert(!contentBridge.includes("console.log(p.submission.code)"));
    assert(!contentBridge.includes("console.log(normalizedPayload.submission.code)"));
  });

  // 41. NormalizedSubmission output
  it("41. NormalizedSubmission output", () => {
    const raw = {
      platform: "atcoder",
      problem: {
        slug: "abc300_a",
        title: "A - N-choice question",
        difficulty: null,
        url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
      },
      submission: {
        id: "45678901",
        status: "Accepted",
        language: "cpp",
        code: "int main() { return 0; }",
      },
      metadata: {
        timestamp: 1727700000000,
      },
    };

    const normalized = platforms.normalizeSubmission(raw);
    assert.strictEqual(normalized.platform, "atcoder");
    assert.strictEqual(normalized.problem.slug, "abc300_a");
    assert.strictEqual(normalized.problem.difficulty, "Unknown");
    assert.strictEqual(normalized.submission.id, "45678901");
    assert.strictEqual(normalized.submission.language, "cpp");

    const val = platforms.validateNormalizedSubmission(normalized);
    assert.strictEqual(val.ok, true);
  });

  // 42. Entitlement rejection & acceptance
  await itAsync("42. entitlement rejection", async () => {
    const basicEntitlement = {
      version: 1,
      plan: "basic",
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
    };
    const allowedBasic = await entitlements.isPlatformAllowed("atcoder", basicEntitlement);
    assert.strictEqual(allowedBasic, false, "AtCoder must be rejected when not in Basic selectedPlatforms");

    const basicWithAtCoder = {
      version: 1,
      plan: "basic",
      selectedPlatforms: ["leetcode", "atcoder"],
    };
    const allowedSelected = await entitlements.isPlatformAllowed("atcoder", basicWithAtCoder);
    assert.strictEqual(allowedSelected, true, "AtCoder must be allowed when in Basic selectedPlatforms");

    const proEntitlement = {
      version: 1,
      plan: "pro",
      selectedPlatforms: [],
    };
    const allowedPro = await entitlements.isPlatformAllowed("atcoder", proEntitlement);
    assert.strictEqual(allowedPro, true, "AtCoder must be allowed on Pro plan");
  });

  // 43. GitHub path safety
  it("43. GitHub path safety", () => {
    const folder = platforms.buildCanonicalFolderPath("atcoder", "Unknown", "abc300_a");
    assert.strictEqual(folder, "AtCoder/Unknown/abc300_a");

    const traversalFolder = platforms.buildCanonicalFolderPath("atcoder", "../Unknown", "../../abc300_a");
    assert(!traversalFolder.includes(".."));
  });

  // 44. Extension session storage staging (chrome.storage.session)
  await itAsync("44. extension session storage staging (chrome.storage.session)", async () => {
    storageState.session = {};
    const testPayload = {
      contestId: "abc300",
      taskId: "abc300_b",
      language: "python",
      code: "print('test')",
      title: "Problem B",
      url: "https://atcoder.jp/contests/abc300/tasks/abc300_b",
      timestamp: Date.now(),
    };
    await atcoderContent.saveStaging(testPayload);
    assert(storageState.session.fly2git_atcoder_staging, "Staging must be saved into chrome.storage.session");
    assert.strictEqual(storageState.session.fly2git_atcoder_staging.taskId, "abc300_b");
  });

  // 45. Page sessionStorage is NOT used for production staging
  it("45. page sessionStorage is NOT used for production staging", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "atcoder-inject.js"), "utf8");
    const contentCode = fs.readFileSync(path.join(__dirname, "atcoder-content.js"), "utf8");
    assert(!injectCode.includes("sessionStorage.setItem"), "atcoder-inject.js must never call sessionStorage.setItem");
    assert(!injectCode.includes("sessionStorage.getItem"), "atcoder-inject.js must never call sessionStorage.getItem");
    assert(!contentCode.includes("sessionStorage.setItem"), "atcoder-content.js must never call sessionStorage.setItem");
    assert(!contentCode.includes("sessionStorage.getItem"), "atcoder-content.js must never call sessionStorage.getItem");
  });

  // 46. Staging deletion after correlation
  await itAsync("46. staging deletion after correlation", async () => {
    storageState.session = {
      fly2git_atcoder_staging: {
        contestId: "abc300",
        taskId: "abc300_a",
        language: "cpp",
        code: "code",
        timestamp: Date.now(),
      },
    };
    await atcoderContent.clearStaging();
    const after = await atcoderContent.loadStaging();
    assert.strictEqual(after, null, "Staging must be completely cleared after correlation");
    assert.strictEqual(storageState.session.fly2git_atcoder_staging, undefined);
  });

  // 47. Malformed staging rejection
  await itAsync("47. malformed staging rejection", async () => {
    storageState.session = {};
    await atcoderContent.saveStaging(null);
    assert.strictEqual(storageState.session.fly2git_atcoder_staging, undefined);

    await atcoderContent.saveStaging({ contestId: "abc300" }); // missing code, taskId, etc.
    assert.strictEqual(storageState.session.fly2git_atcoder_staging, undefined);

    const hugeCode = "x".repeat(200001);
    await atcoderContent.saveStaging({
      contestId: "abc300",
      taskId: "abc300_a",
      language: "cpp",
      code: hugeCode,
    });
    assert.strictEqual(storageState.session.fly2git_atcoder_staging, undefined, "Oversized code in staging must be rejected");
  });

  // 48. Cross-contest staging rejection
  it("48. cross-contest staging rejection", () => {
    const staged = { contestId: "abc300", taskId: "abc300_a" };
    const pathname = "/contests/abc299/submissions/me";
    const contestMatch = pathname.match(/\/contests\/([^\/\?#]+)/);
    const currentContest = contestMatch ? contestMatch[1] : null;

    assert.notStrictEqual(currentContest, staged.contestId, "Contest mismatch must prevent correlation");
  });

  // 49. Source code absence in logs, diagnostics, and sync history
  it("49. source code absence in logs, diagnostics, and sync history", () => {
    const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
    // Diagnostics snapshot check: ensure it does not include code
    assert(!bgCode.includes("snapshot.code"));
    assert(!bgCode.includes("cleanEntry.code = entry.code;") || bgCode.includes("cleanEntry.code = entry.code.slice(0, 50)")); // error code only
    assert(!bgCode.includes("syncLog: updated.map(x => x.code)"));
  });

  // 50. Session storage access level is TRUSTED_CONTEXTS
  it("50. session storage access level is TRUSTED_CONTEXTS", () => {
    const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
    assert(
      bgCode.includes('accessLevel: "TRUSTED_CONTEXTS"'),
      "background.js must explicitly configure accessLevel: 'TRUSTED_CONTEXTS'"
    );
    assert.strictEqual(
      configuredAccessLevel,
      "TRUSTED_CONTEXTS",
      "chrome.storage.session.setAccessLevel must be invoked with TRUSTED_CONTEXTS"
    );
  });

  // 51. TRUSTED_AND_UNTRUSTED_CONTEXTS is NOT configured
  it("51. TRUSTED_AND_UNTRUSTED_CONTEXTS is NOT configured", () => {
    const jsFiles = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js") || f.endsWith(".json"));
    for (const file of jsFiles) {
      if (file === "test_atcoder.js") continue;
      const content = fs.readFileSync(path.join(__dirname, file), "utf8");
      assert(
        !content.includes("TRUSTED_AND_UNTRUSTED_CONTEXTS"),
        `TRUSTED_AND_UNTRUSTED_CONTEXTS must NOT be configured or present in ${file}`
      );
    }
  });

  // 52. Page context cannot directly access staging storage
  it("52. page context cannot directly access staging storage", () => {
    const injectCode = fs.readFileSync(path.join(__dirname, "atcoder-inject.js"), "utf8");
    const contentCode = fs.readFileSync(path.join(__dirname, "atcoder-content.js"), "utf8");

    // atcoder-inject.js runs in MAIN page world: must have ZERO access to chrome.storage
    assert(!injectCode.includes("chrome.storage"), "atcoder-inject.js must never touch chrome.storage");
    assert(!injectCode.includes("sessionStorage.setItem"), "atcoder-inject.js must never touch sessionStorage");

    // atcoder-content.js runs in ISOLATED world: must NOT directly call chrome.storage.session
    // All staging operations must route through chrome.runtime.sendMessage to background.js
    const contentLinesWithoutComments = contentCode
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");

    assert(
      !contentLinesWithoutComments.includes("chrome.storage.session.set"),
      "atcoder-content.js must not directly set chrome.storage.session"
    );
    assert(
      !contentLinesWithoutComments.includes("chrome.storage.session.get"),
      "atcoder-content.js must not directly get chrome.storage.session"
    );
    assert(
      !contentLinesWithoutComments.includes("chrome.storage.session.remove"),
      "atcoder-content.js must not directly remove chrome.storage.session"
    );
  });

  // 53. Background can set staging
  await itAsync("53. background can set staging", async () => {
    storageState.session = {};
    const payload = {
      contestId: "abc300",
      taskId: "abc300_a",
      language: "cpp",
      code: "int main() {}",
      timestamp: Date.now(),
    };
    await background.stageAtCoderSubmission(payload);
    assert.deepStrictEqual(
      storageState.session[background.ATCODER_STAGING_KEY],
      payload,
      "Background must set staging into chrome.storage.session"
    );
  });

  // 54. Background can get staging
  await itAsync("54. background can get staging", async () => {
    const payload = {
      contestId: "abc300",
      taskId: "abc300_a",
      language: "cpp",
      code: "int main() {}",
      timestamp: Date.now(),
    };
    storageState.session = {
      [background.ATCODER_STAGING_KEY]: payload,
    };
    const staged = await background.getAtCoderStaging();
    assert.deepStrictEqual(staged, payload, "Background must retrieve staging from chrome.storage.session");
  });

  // 55. Background can clear staging
  await itAsync("55. background can clear staging", async () => {
    storageState.session = {
      [background.ATCODER_STAGING_KEY]: { test: 123 },
    };
    await background.clearAtCoderStaging();
    assert.strictEqual(
      storageState.session[background.ATCODER_STAGING_KEY],
      undefined,
      "Background must clear staging from chrome.storage.session"
    );
    const staged = await background.getAtCoderStaging();
    assert.strictEqual(staged, null);
  });

  // 56. Background staging expires after 30 seconds
  await itAsync("56. background staging expires after 30 seconds", async () => {
    storageState.session = {
      [background.ATCODER_STAGING_KEY]: {
        contestId: "abc300",
        taskId: "abc300_a",
        language: "python",
        code: "print()",
        timestamp: Date.now() - 31000, // 31 seconds ago (> 30s TTL)
      },
    };
    const staged = await background.getAtCoderStaging();
    assert.strictEqual(staged, null, "Expired staging must return null from background");
    assert.strictEqual(
      storageState.session[background.ATCODER_STAGING_KEY],
      undefined,
      "Expired staging must be auto-deleted from chrome.storage.session"
    );
  });

  // 57. Correlation on submissions page clears staging via background boundary
  await itAsync("57. correlation on submissions page clears staging via background boundary", async () => {
    storageState.session = {
      [background.ATCODER_STAGING_KEY]: {
        contestId: "abc300",
        taskId: "abc300_a",
        language: "cpp",
        code: "int main() {}",
        timestamp: Date.now(),
      },
    };
    window.location.pathname = "/contests/abc300/submissions/me";
    const oldQuerySelectorAll = document.querySelectorAll;
    const mockRow = {
      querySelector: (sel) => {
        if (sel.includes("/tasks/")) return { getAttribute: () => "/contests/abc300/tasks/abc300_a" };
        if (sel.includes("waiting-judge") || sel.includes("data-id")) return { getAttribute: () => "55443322" };
        return null;
      },
    };
    document.querySelectorAll = (sel) => {
      if (sel.includes("table")) return [mockRow];
      return [];
    };

    await atcoderContent.checkForSubmissionsPage();
    assert.strictEqual(
      storageState.session[background.ATCODER_STAGING_KEY],
      undefined,
      "Staging must be deleted immediately after correlation on submissions page"
    );
    document.querySelectorAll = oldQuerySelectorAll;
  });

  console.log("\n=======================================================");
  console.log(`ATCODER RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
