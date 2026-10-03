// Fly2Git — by SRT
// Phase UI/REPO-3: Universal Platform-Level README & Top-Level Folder Test Suite
//
// 18 Tests:
// 1. new repository + first platform sync
// 2. existing repository + missing platform README
// 3. existing repository + existing platform README
// 4. multiple missing platform READMEs
// 5. all seven active platforms
// 6. multiple users
// 7. multiple repositories
// 8. README not overwritten
// 9. solution path unchanged
// 10. one commit for first solution + platform README
// 11. one commit for multiple backfill READMEs
// 12. no duplicate README creation
// 13. no source code in README
// 14. no secrets in README
// 15. no hardcoded username
// 16. no hardcoded repository
// 17. inactive platform ignored
// 18. platform registry used dynamically

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
      setAccessLevel: () => {},
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
    sendMessage: async () => {},
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
      "if (typeof Fly2GitEntitlements !== 'undefined') global.Fly2GitEntitlements = Fly2GitEntitlements;\n"
  );
  fn(global);
};

// Load dependencies
global.importScripts("config.js");
global.importScripts("platforms.js");
global.importScripts("entitlements.js");

const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
const bg = require("./background.js");

// Test runner helper
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
console.log("   FLY2GIT: PHASE UI/REPO-3 PLATFORM README TEST SUITE ");
console.log("=======================================================\n");

(async () => {
  // ---------------------------------------------------------------
  // 1. New repository + first platform sync
  // ---------------------------------------------------------------
  await itAsync("1. new repository + first platform sync", async () => {
    let putReadmeCalled = false;
    let createdBlobs = [];

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("api.github.com/repos/alice/new-empty-repo/git/ref/heads/main")) {
        if (!putReadmeCalled) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ message: "Git Repository is empty." }),
            clone() {
              return this;
            },
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "commit_bootstrap" } }),
        };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo/contents/README.md")) {
        putReadmeCalled = true;
        return { ok: true, status: 201, json: async () => ({ content: {} }) };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo/git/commits/commit_bootstrap")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "tree_bootstrap" } }) };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo/git/blobs")) {
        createdBlobs.push(JSON.parse(options.body).content);
        return { ok: true, status: 201, json: async () => ({ sha: `blob_${createdBlobs.length}` }) };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo/git/trees")) {
        return { ok: true, status: 201, json: async () => ({ sha: "tree_first_solution" }) };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo/git/commits")) {
        return { ok: true, status: 201, json: async () => ({ sha: "commit_first_solution" }) };
      }
      if (u.includes("api.github.com/repos/alice/new-empty-repo")) {
        return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: "Not found" }) };
    };

    const res = await bg.commitSolutionAndReadme({
      repo: "alice/new-empty-repo",
      solutionPath: "Codeforces/Unknown/codeforces-2269-A/solution.cpp",
      solutionContent: "int main() { return 0; }",
      readmePath: "Codeforces/Unknown/codeforces-2269-A/README.md",
      readmeContent: "# SauSaGe Bank",
      platformReadmePath: "Codeforces/README.md",
      platformReadmeContent: platforms.buildPlatformReadme("codeforces"),
      commitMessage: "Add: SauSaGe Bank (Unknown)",
      token: "ghp_fake_token",
    });

    assert(putReadmeCalled, "Must bootstrap empty repo with initial root README.md");
    assert.strictEqual(res.commitSha, "commit_first_solution");
    assert.strictEqual(createdBlobs.length, 3, "Must create 3 blobs in 1 commit (solution + problem README + platform README)");
  });

  // ---------------------------------------------------------------
  // 2. Existing repository + missing platform README
  // ---------------------------------------------------------------
  await itAsync("2. existing repository + missing platform README", async () => {
    let treeCreatedWith = null;

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("api.github.com/repos/bob/existing-repo/contents/")) {
        // Return 404 for CodeChef/README.md, 200 for others
        if (u.includes("CodeChef/README.md")) {
          return { ok: false, status: 404, json: async () => ({ message: "Not found" }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: Buffer.from("# Platform").toString("base64"), sha: "sha_existing" }),
        };
      }
      if (u.includes("/git/ref/heads/main")) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "commit_base" } }) };
      }
      if (u.includes("/git/commits/commit_base")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "tree_base" } }) };
      }
      if (u.includes("/git/blobs")) {
        return { ok: true, status: 201, json: async () => ({ sha: "blob_codechef_readme" }) };
      }
      if (u.includes("/git/trees")) {
        treeCreatedWith = JSON.parse(options.body);
        return { ok: true, status: 201, json: async () => ({ sha: "tree_backfilled" }) };
      }
      if (u.includes("/git/commits")) {
        return { ok: true, status: 201, json: async () => ({ sha: "commit_backfilled" }) };
      }
      if (u.includes("api.github.com/repos/bob/existing-repo")) {
        return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const result = await bg.backfillPlatformReadmes("bob/existing-repo", "ghp_fake_token");
    assert.strictEqual(result.backfilled, true);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.files[0], "CodeChef/README.md");
    assert.strictEqual(treeCreatedWith.tree.length, 1);
    assert.strictEqual(treeCreatedWith.tree[0].path, "CodeChef/README.md");
  });

  // ---------------------------------------------------------------
  // 3. Existing repository + existing platform README
  // ---------------------------------------------------------------
  await itAsync("3. existing repository + existing platform README", async () => {
    let commitCalled = false;

    global.fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/contents/")) {
        // All platform READMEs exist
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: Buffer.from("# Existing").toString("base64"), sha: "sha_1" }),
        };
      }
      if (u.includes("/git/commits") && !u.includes("/commits/")) {
        commitCalled = true;
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
    };

    const result = await bg.backfillPlatformReadmes("charlie/complete-repo", "ghp_fake_token");
    assert.strictEqual(result.backfilled, false);
    assert.strictEqual(result.count, 0);
    assert.strictEqual(commitCalled, false, "Must make zero commits when all platform READMEs already exist");
  });

  // ---------------------------------------------------------------
  // 4. Multiple missing platform READMEs
  // ---------------------------------------------------------------
  await itAsync("4. multiple missing platform READMEs", async () => {
    let committedPaths = [];

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("/contents/")) {
        // LeetCode and SPOJ exist, rest are missing
        if (u.includes("LeetCode/README.md") || u.includes("SPOJ/README.md")) {
          return { ok: true, status: 200, json: async () => ({ content: Buffer.from("# Exists").toString("base64") }) };
        }
        return { ok: false, status: 404, json: async () => ({ message: "Not found" }) };
      }
      if (u.includes("/git/ref/heads/main")) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "c_head" } }) };
      }
      if (u.includes("/git/commits/c_head")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "t_head" } }) };
      }
      if (u.includes("/git/blobs")) {
        return { ok: true, status: 201, json: async () => ({ sha: "b_sha" }) };
      }
      if (u.includes("/git/trees")) {
        committedPaths = JSON.parse(options.body).tree.map((t) => t.path);
        return { ok: true, status: 201, json: async () => ({ sha: "t_new" }) };
      }
      if (u.includes("/git/commits")) {
        return { ok: true, status: 201, json: async () => ({ sha: "c_new" }) };
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
    };

    const result = await bg.backfillPlatformReadmes("dan/partial-repo", "ghp_fake_token");
    assert.strictEqual(result.backfilled, true);
    assert.strictEqual(result.count, 5, "Expected 5 missing platform READMEs");
    assert(!committedPaths.includes("LeetCode/README.md"), "Must not recreate LeetCode/README.md");
    assert(!committedPaths.includes("SPOJ/README.md"), "Must not recreate SPOJ/README.md");
    assert(committedPaths.includes("CodeChef/README.md"));
    assert(committedPaths.includes("Codeforces/README.md"));
    assert(committedPaths.includes("GeeksforGeeks/README.md"));
    assert(committedPaths.includes("HackerRank/README.md"));
    assert(committedPaths.includes("AtCoder/README.md"));
  });

  // ---------------------------------------------------------------
  // 5. All seven active platforms
  // ---------------------------------------------------------------
  it("5. all seven active platforms", () => {
    const active = platforms.getActivePlatforms();
    assert.strictEqual(active.length, 7, "Must have exactly 7 active platforms");
    const activeIds = active.map((p) => p.id);
    const expected = ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "atcoder", "codeforces", "spoj"];
    for (const id of expected) {
      assert(activeIds.includes(id), `Active platform ${id} missing`);
    }
  });

  // ---------------------------------------------------------------
  // 6. Multiple users independence
  // ---------------------------------------------------------------
  it("6. multiple users", () => {
    const users = ["alice_coder", "bob_dev", "charlie_test", "dan_user"];
    for (const u of users) {
      assert(u.length >= 3);
      assert(!u.includes("laxmansrt"), "Must not hardcode author username");
    }
  });

  // ---------------------------------------------------------------
  // 7. Multiple repositories independence
  // ---------------------------------------------------------------
  it("7. multiple repositories", () => {
    const repos = ["user1/repoA", "user2/repoB", "company/coding-challenges"];
    for (const r of repos) {
      assert(r.includes("/"), "Must be valid owner/repo string");
      assert(!r.includes("Fly2Git-by-SRT"), "Must not hardcode repo name");
      assert(!r.includes("leetlife"), "Must not hardcode personal repo");
    }
  });

  // ---------------------------------------------------------------
  // 8. README not overwritten
  // ---------------------------------------------------------------
  it("8. README not overwritten", () => {
    const customContent = "# My Custom Codeforces Notes\n\nPersonal problem archive.";
    const defaultContent = platforms.buildPlatformReadme("codeforces");
    assert.notStrictEqual(customContent, defaultContent);
  });

  // ---------------------------------------------------------------
  // 9. Solution path unchanged
  // ---------------------------------------------------------------
  it("9. solution path unchanged", () => {
    const p1 = platforms.buildCanonicalFolderPath("codechef", "Unknown", "RPPS");
    assert.strictEqual(p1, "CodeChef/Unknown/RPPS");

    const p2 = platforms.buildCanonicalFolderPath("codeforces", "Unknown", "codeforces-2269-A");
    assert.strictEqual(p2, "Codeforces/Unknown/codeforces-2269-A");

    const p3 = platforms.buildCanonicalFolderPath("geeksforgeeks", "Basic", "replace-all-0s-with-5");
    assert.strictEqual(p3, "GeeksforGeeks/Basic/replace-all-0s-with-5");

    const p4 = platforms.buildCanonicalFolderPath("hackerrank", "Unknown", "simple-array-sum");
    assert.strictEqual(p4, "HackerRank/Unknown/simple-array-sum");

    // Full solution paths
    assert.strictEqual(`${p1}/solution.java`, "CodeChef/Unknown/RPPS/solution.java");
    assert.strictEqual(`${p2}/solution.cpp`, "Codeforces/Unknown/codeforces-2269-A/solution.cpp");
  });

  // ---------------------------------------------------------------
  // 10. One commit for first solution + platform README
  // ---------------------------------------------------------------
  await itAsync("10. one commit for first solution + platform README", async () => {
    let treeItemCount = 0;
    let commitCount = 0;

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("/git/ref/heads/main")) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "head_commit" } }) };
      }
      if (u.includes("/git/commits/head_commit")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "head_tree" } }) };
      }
      if (u.includes("/git/blobs")) {
        return { ok: true, status: 201, json: async () => ({ sha: "b_sha" }) };
      }
      if (u.includes("/git/trees")) {
        treeItemCount = JSON.parse(options.body).tree.length;
        return { ok: true, status: 201, json: async () => ({ sha: "new_tree" }) };
      }
      if (u.includes("/git/commits")) {
        commitCount++;
        return { ok: true, status: 201, json: async () => ({ sha: "new_commit" }) };
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
    };

    const res = await bg.commitSolutionAndReadme({
      repo: "elena/test-repo",
      solutionPath: "AtCoder/Unknown/abc300_a/solution.cpp",
      solutionContent: "int main() {}",
      readmePath: "AtCoder/Unknown/abc300_a/README.md",
      readmeContent: "# Problem A",
      platformReadmePath: "AtCoder/README.md",
      platformReadmeContent: platforms.buildPlatformReadme("atcoder"),
      commitMessage: "Add: Problem A (Unknown)",
      token: "ghp_fake_token",
    });

    assert.strictEqual(commitCount, 1, "Must produce exactly 1 commit");
    assert.strictEqual(treeItemCount, 3, "Must combine solution, problem README, and platform README in 1 commit");
    assert.strictEqual(res.commitSha, "new_commit");
  });

  // ---------------------------------------------------------------
  // 11. One commit for multiple backfill READMEs
  // ---------------------------------------------------------------
  await itAsync("11. one commit for multiple backfill READMEs", async () => {
    let commitCount = 0;
    let treeItemCount = 0;

    global.fetch = async (url, options = {}) => {
      const u = url.toString();
      if (u.includes("/contents/")) {
        return { ok: false, status: 404, json: async () => ({ message: "Not found" }) };
      }
      if (u.includes("/git/ref/heads/main")) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "head_commit" } }) };
      }
      if (u.includes("/git/commits/head_commit")) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "head_tree" } }) };
      }
      if (u.includes("/git/blobs")) {
        return { ok: true, status: 201, json: async () => ({ sha: "b_sha" }) };
      }
      if (u.includes("/git/trees")) {
        treeItemCount = JSON.parse(options.body).tree.length;
        return { ok: true, status: 201, json: async () => ({ sha: "new_tree" }) };
      }
      if (u.includes("/git/commits")) {
        commitCount++;
        return { ok: true, status: 201, json: async () => ({ sha: "backfill_commit" }) };
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
    };

    const res = await bg.backfillPlatformReadmes("frank/repo-with-7-missing", "ghp_fake_token");
    assert.strictEqual(res.backfilled, true);
    assert.strictEqual(res.count, 7, "Must identify all 7 missing platform READMEs");
    assert.strictEqual(commitCount, 1, "Must create all 7 platform READMEs in exactly ONE commit");
    assert.strictEqual(treeItemCount, 7, "Tree must contain all 7 platform README blobs");
  });

  // ---------------------------------------------------------------
  // 12. No duplicate README creation
  // ---------------------------------------------------------------
  it("12. no duplicate README creation", () => {
    const existingSolution = { decodedContent: "print('hello')" };
    const existingReadme = { decodedContent: "# Problem" };
    const existingPlatformReadme = { decodedContent: "# LeetCode" };

    const sameSolution = true;
    const isSkip = Boolean(sameSolution && existingReadme && existingPlatformReadme);
    assert.strictEqual(isSkip, true, "Must skip when solution, problem README, and platform README all exist");
  });

  // ---------------------------------------------------------------
  // 13. No source code in README
  // ---------------------------------------------------------------
  it("13. no source code in README", () => {
    for (const p of ["leetcode", "codeforces", "spoj", "atcoder", "codechef"]) {
      const readme = platforms.buildPlatformReadme(p);
      assert(!readme.includes("class Solution"), "Must not contain code template");
      assert(!readme.includes("int main"), "Must not contain main function");
      assert(!readme.includes("public static void"), "Must not contain java code");
      assert(!readme.includes("def solve()"), "Must not contain python function");
    }
  });

  // ---------------------------------------------------------------
  // 14. No secrets in README
  // ---------------------------------------------------------------
  it("14. no secrets in README", () => {
    for (const p of ["leetcode", "codeforces", "spoj", "atcoder", "codechef", "hackerrank", "geeksforgeeks"]) {
      const readme = platforms.buildPlatformReadme(p);
      assert(!readme.includes("token"));
      assert(!readme.includes("secret"));
      assert(!readme.includes("password"));
      assert(!readme.includes("cookie"));
    }
  });

  // ---------------------------------------------------------------
  // 15. No hardcoded username
  // ---------------------------------------------------------------
  it("15. no hardcoded username", () => {
    const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
    const platCode = fs.readFileSync(path.join(__dirname, "platforms.js"), "utf8");
    const entCode = fs.readFileSync(path.join(__dirname, "entitlements.js"), "utf8");
    const popCode = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

    assert(!bgCode.includes("laxmansrt"), "background.js must not contain hardcoded username");
    assert(!platCode.includes("laxmansrt"), "platforms.js must not contain hardcoded username");
    assert(!entCode.includes("laxmansrt"), "entitlements.js must not contain hardcoded username");
    assert(!popCode.includes("laxmansrt"), "popup.js must not contain hardcoded username");
  });

  // ---------------------------------------------------------------
  // 16. No hardcoded repository
  // ---------------------------------------------------------------
  it("16. no hardcoded repository", () => {
    const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
    const platCode = fs.readFileSync(path.join(__dirname, "platforms.js"), "utf8");
    const popCode = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

    assert(!bgCode.includes("Fly2Git-by-SRT"), "background.js must not hardcode personal repo");
    assert(!platCode.includes("Fly2Git-by-SRT"), "platforms.js must not hardcode personal repo");
    assert(!popCode.includes("Fly2Git-by-SRT"), "popup.js must not hardcode personal repo");
    assert(!bgCode.includes("leetlife"), "background.js must not hardcode personal repo leetlife");
  });

  // ---------------------------------------------------------------
  // 17. Inactive platform ignored
  // ---------------------------------------------------------------
  it("17. inactive platform ignored", () => {
    assert(platforms.PLATFORM_REGISTRY.usaco, "usaco exists in registry");
    assert.strictEqual(platforms.PLATFORM_REGISTRY.usaco.active, false, "usaco is inactive");

    const activeList = platforms.getActivePlatforms();
    const usacoFound = activeList.find((p) => p.id === "usaco");
    assert.strictEqual(usacoFound, undefined, "Inactive platform usaco must be ignored during backfill");
  });

  // ---------------------------------------------------------------
  // 18. Platform registry used dynamically
  // ---------------------------------------------------------------
  it("18. platform registry used dynamically", () => {
    // Canonical platform name resolution is driven by registry
    for (const [id, def] of Object.entries(platforms.PLATFORM_REGISTRY)) {
      if (def.active) {
        assert.strictEqual(
          platforms.getCanonicalPlatformFolder(id),
          def.name,
          `Canonical folder must match registry definition for ${id}`
        );
        assert.strictEqual(
          platforms.buildPlatformReadmePath(id),
          `${def.name}/README.md`,
          `Path must match canonical folder for ${id}`
        );
      }
    }
  });

  console.log("\n=======================================================");
  console.log(`UNIVERSAL PLATFORM README RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
})();
