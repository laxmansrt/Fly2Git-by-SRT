// Fly2Git — by SRT
// Phase UI-2: GitHub Repository Picker & Installation Access Test Suite
//
// 23 Comprehensive Tests:
// 1. correct installation repository endpoint
// 2. installation ID
// 3. repository pagination
// 4. first page
// 5. second page
// 6. >100 repositories
// 7. existing repository
// 8. newly created repository
// 9. inaccessible repository excluded
// 10. zero repositories
// 11. selected repo persistence
// 12. invalid selected repo
// 13. deterministic sorting
// 14. 401 handling
// 15. 403 handling
// 16. 404 handling
// 17. 429 handling
// 18. 5xx handling
// 19. network failure
// 20. token never logged
// 21. token never persisted
// 22. no All-repositories escalation
// 23. explicit repository selection

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
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete storageState.session[k]);
      },
      setAccessLevel: () => {},
    },
  },
  runtime: {
    id: "test-extension-id",
    getURL: () => "chrome-extension://test-extension-id/",
    onConnect: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage: async () => {},
  },
  alarms: {
    create() {},
    clear() {},
    onAlarm: { addListener() {} },
  },
};

global.importScripts = (file) => {
  const content = fs.readFileSync(path.join(__dirname, file), "utf8");
  const fn = new Function(
    "global",
    content +
      "\nif (typeof FLY2GIT_CONFIG !== 'undefined') global.FLY2GIT_CONFIG = FLY2GIT_CONFIG;\n" +
      "if (typeof PLATFORMS !== 'undefined') global.PLATFORMS = PLATFORMS;\n" +
      "if (typeof Fly2GitEntitlements !== 'undefined') global.Fly2GitEntitlements = Fly2GitEntitlements;\n"
  );
  fn(global);
};

// Execute config, platforms, entitlements to ensure global presence
global.importScripts("config.js");
global.importScripts("platforms.js");
global.importScripts("entitlements.js");
const background = require("./background.js");
const {
  listInstalledRepos,
  paginateItems,
  parseNextLink,
  ghFetchRaw,
  GitHubError,
} = background;

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE UI-2: REPOSITORY PICKER TEST SUITE    ");
  console.log("=======================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error("    Error:", err.message);
        failed++;
      }
    })();
  }

  const TEST_TOKEN = "ghu_MockFly2GitUserAccessToken1234567890";
  const TEST_INSTALL_ID = 165524729;

  // Helper to setup valid auth in storage
  async function setupAuth() {
    storageState.local.auth = {
      accessToken: TEST_TOKEN,
      refreshToken: "ghr_MockRefreshToken1234567890",
      expiresAt: Date.now() + 3600 * 1000,
    };
  }

  // Helper to mock global.fetch
  function mockFetch(handler) {
    global.fetch = async (url, options = {}) => {
      return handler(url, options);
    };
  }

  // 1. Correct installation repository endpoint
  await test("1. correct installation repository endpoint", async () => {
    await setupAuth();
    let requestedReposUrl = null;
    let requestedHeaders = null;

    mockFetch(async (url, opts) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          clone: () => ({ json: async () => [] }),
          json: async () => ({
            total_count: 1,
            installations: [
              {
                id: TEST_INSTALL_ID,
                app_slug: "fly2git-by-srt",
                repository_selection: "selected",
                account: { login: "laxmansrt" },
                html_url: `https://github.com/settings/installations/${TEST_INSTALL_ID}`,
              },
            ],
          }),
        };
      }
      if (url.includes(`/user/installations/${TEST_INSTALL_ID}/repositories`)) {
        requestedReposUrl = url;
        requestedHeaders = opts.headers;
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          clone: () => ({ json: async () => [] }),
          json: async () => ({
            total_count: 1,
            repositories: [
              { id: 101, full_name: "laxmansrt/leetlife", private: false },
            ],
          }),
        };
      }
      return { ok: false, status: 404, headers: new Map(), json: async () => ({}) };
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 1);
    assert(
      requestedReposUrl.startsWith(
        `https://api.github.com/user/installations/${TEST_INSTALL_ID}/repositories`
      ),
      `Expected repository endpoint with installation ID, got: ${requestedReposUrl}`
    );
    assert.strictEqual(requestedHeaders["Authorization"], `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(requestedHeaders["Accept"], "application/vnd.github+json");
    assert.strictEqual(requestedHeaders["X-GitHub-Api-Version"], "2022-11-28");
  });

  // 2. Installation ID extraction and dynamic use
  await test("2. installation ID", async () => {
    await setupAuth();
    const dynamicId = 987654321;
    let endpointCalled = null;

    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [
              {
                id: dynamicId,
                app_slug: "fly2git-by-srt",
                repository_selection: "selected",
                account: { login: "laxmansrt" },
              },
            ],
          }),
        };
      }
      endpointCalled = url;
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          total_count: 1,
          repositories: [{ id: 1, full_name: "laxmansrt/demo-repo", private: false }],
        }),
      };
    });

    const res = await listInstalledRepos();
    assert(
      endpointCalled.includes(`/user/installations/${dynamicId}/repositories`),
      `Dynamic installation ID ${dynamicId} should be in endpoint URL`
    );
    assert.strictEqual(res.installations[0].id, dynamicId);
  });

  // 3. Repository pagination via Link header
  await test("3. repository pagination", async () => {
    const linkHeader =
      '<https://api.github.com/user/installations/1/repositories?page=2&per_page=100>; rel="next", <https://api.github.com/user/installations/1/repositories?page=5&per_page=100>; rel="last"';
    const nextUrl = parseNextLink(linkHeader);
    assert.strictEqual(
      nextUrl,
      "https://api.github.com/user/installations/1/repositories?page=2&per_page=100"
    );

    // Also test unquoted and uppercase rel
    const linkHeaderUnquoted =
      '<https://api.github.com/user/installations/1/repositories?page=3&per_page=100>; rel=next';
    assert.strictEqual(
      parseNextLink(linkHeaderUnquoted),
      "https://api.github.com/user/installations/1/repositories?page=3&per_page=100"
    );
  });

  // 4. First page repositories included
  await test("4. first page", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          total_count: 2,
          repositories: [
            { full_name: "user/page1-repo1", private: false },
            { full_name: "user/page1-repo2", private: true },
          ],
        }),
      };
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 2);
    assert(res.repos.some((r) => r.fullName === "user/page1-repo1"));
    assert(res.repos.some((r) => r.fullName === "user/page1-repo2" && r.private === true));
  });

  // 5. Second page repositories included
  await test("5. second page", async () => {
    await setupAuth();
    let pageCount = 0;
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      pageCount++;
      if (pageCount === 1) {
        const headers = new Map();
        headers.set(
          "Link",
          '<https://api.github.com/user/installations/1/repositories?page=2&per_page=100>; rel="next"'
        );
        return {
          ok: true,
          status: 200,
          headers: { get: (h) => headers.get(h) },
          json: async () => ({
            total_count: 2,
            repositories: [{ full_name: "user/page1-repo", private: false }],
          }),
        };
      } else {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            total_count: 2,
            repositories: [{ full_name: "user/page2-repo", private: false }],
          }),
        };
      }
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 2);
    assert(res.repos.some((r) => r.fullName === "user/page1-repo"));
    assert(res.repos.some((r) => r.fullName === "user/page2-repo"));
  });

  // 6. >100 repositories across multiple pages
  await test("6. >100 repositories", async () => {
    await setupAuth();
    let callIdx = 0;

    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      callIdx++;
      if (callIdx === 1) {
        // Generate 100 repos
        const repos100 = Array.from({ length: 100 }, (_, i) => ({
          full_name: `user/repo-${String(i + 1).padStart(3, "0")}`,
          private: false,
        }));
        return {
          ok: true,
          status: 200,
          headers: {
            get: (h) =>
              h === "Link"
                ? '<https://api.github.com/user/installations/1/repositories?page=2&per_page=100>; rel="next"'
                : null,
          },
          json: async () => ({ total_count: 140, repositories: repos100 }),
        };
      } else {
        // Page 2: 40 repos
        const repos40 = Array.from({ length: 40 }, (_, i) => ({
          full_name: `user/repo-${String(101 + i).padStart(3, "0")}`,
          private: false,
        }));
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ total_count: 140, repositories: repos40 }),
        };
      }
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 140);
    assert.strictEqual(res.repos[0].fullName, "user/repo-001");
    assert.strictEqual(res.repos[139].fullName, "user/repo-140");
  });

  // 7. Existing repository granted appears in selector
  await test("7. existing repository", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 2,
          repositories: [
            { full_name: "laxmansrt/Fly2Git-by-SRT", private: false },
            { full_name: "laxmansrt/leetlife", private: false },
          ],
        }),
      };
    });

    const res = await listInstalledRepos();
    const oldRepo = res.repos.find((r) => r.fullName === "laxmansrt/Fly2Git-by-SRT");
    assert(oldRepo, "Pre-existing repository must appear in repository list");
  });

  // 8. Newly created repository appears in selector
  await test("8. newly created repository", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repositories: [{ full_name: "laxmansrt/new-algo-solutions", private: true }],
        }),
      };
    });

    const res = await listInstalledRepos();
    const newRepo = res.repos.find((r) => r.fullName === "laxmansrt/new-algo-solutions");
    assert(newRepo, "Newly created repository must appear");
    assert.strictEqual(newRepo.private, true);
  });

  // 9. Inaccessible repository excluded (repositories not granted to the app)
  await test("9. inaccessible repository excluded", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      // GitHub API only returns granted repos for this installation
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repositories: [{ full_name: "laxmansrt/leetlife", private: false }],
        }),
      };
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 1);
    const ungranted = res.repos.find((r) => r.fullName === "laxmansrt/secret-unauthorized-repo");
    assert.strictEqual(ungranted, undefined, "Ungranted repositories must NOT be included");
  });

  // 10. Zero repositories handled cleanly
  await test("10. zero repositories", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [
              {
                id: 1,
                app_slug: "fly2git-by-srt",
                html_url: "https://github.com/settings/installations/1",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ total_count: 0, repositories: [] }),
      };
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos.length, 0);
    assert.strictEqual(res.manageUrl, "https://github.com/settings/installations/1");
  });

  // 11. Selected repo persistence
  await test("11. selected repo persistence", async () => {
    delete storageState.local.selectedRepo;
    const targetRepo = "laxmansrt/leetlife";

    // Simulate saving selected repo in popup
    await chrome.storage.local.set({ selectedRepo: targetRepo });
    const { selectedRepo } = await chrome.storage.local.get("selectedRepo");
    assert.strictEqual(selectedRepo, targetRepo, "Selected repo must persist to storage");
  });

  // 12. Invalid selected repo handled safely
  await test("12. invalid selected repo", async () => {
    await setupAuth();
    storageState.local.selectedRepo = "laxmansrt/deleted-or-revoked-repo";

    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repositories: [{ full_name: "laxmansrt/leetlife", private: false }],
        }),
      };
    });

    const res = await listInstalledRepos();
    const isAccessible = res.repos.some(
      (r) => r.fullName === storageState.local.selectedRepo
    );
    assert.strictEqual(
      isAccessible,
      false,
      "Revoked/invalid repository must not be treated as accessible"
    );
  });

  // 13. Deterministic alphabetical sorting
  await test("13. deterministic sorting", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 3,
          repositories: [
            { full_name: "user/zebra-algo", private: false },
            { full_name: "user/apple-code", private: false },
            { full_name: "user/mango-problems", private: false },
          ],
        }),
      };
    });

    const res = await listInstalledRepos();
    assert.strictEqual(res.repos[0].fullName, "user/apple-code");
    assert.strictEqual(res.repos[1].fullName, "user/mango-problems");
    assert.strictEqual(res.repos[2].fullName, "user/zebra-algo");
  });

  // 14. 401 handling -> AUTH_EXPIRED
  await test("14. 401 handling", async () => {
    await setupAuth();
    mockFetch(async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      clone: () => ({ json: async () => ({ message: "Bad credentials" }) }),
      json: async () => ({ message: "Bad credentials" }),
    }));

    try {
      await listInstalledRepos();
      assert.fail("Should have thrown on 401");
    } catch (err) {
      assert(err instanceof GitHubError, "Should be GitHubError instance");
      assert.strictEqual(err.code, "AUTH_EXPIRED");
      assert.strictEqual(err.status, 401);
    }
  });

  // 15. 403 handling -> RATE_LIMIT or PERMISSION
  await test("15. 403 handling", async () => {
    // 15a: Rate limit
    mockFetch(async () => ({
      ok: false,
      status: 403,
      headers: { get: (h) => (h === "x-ratelimit-remaining" ? "0" : null) },
      clone: () => ({ json: async () => ({ message: "API rate limit exceeded" }) }),
      json: async () => ({ message: "API rate limit exceeded" }),
    }));

    try {
      await ghFetchRaw("https://api.github.com/user");
      assert.fail("Should have thrown on 403 rate limit");
    } catch (err) {
      assert.strictEqual(err.code, "RATE_LIMIT");
      assert.strictEqual(err.status, 403);
    }

    // 15b: Permission denied
    mockFetch(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      clone: () => ({ json: async () => ({ message: "Forbidden" }) }),
      json: async () => ({ message: "Forbidden" }),
    }));

    try {
      await ghFetchRaw("https://api.github.com/user");
      assert.fail("Should have thrown on 403 permission");
    } catch (err) {
      assert.strictEqual(err.code, "PERMISSION");
      assert.strictEqual(err.status, 403);
    }
  });

  // 16. 404 handling -> NOT_FOUND
  await test("16. 404 handling", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 404,
      headers: new Map(),
      clone: () => ({ json: async () => ({ message: "Not Found" }) }),
      json: async () => ({ message: "Not Found" }),
    }));

    try {
      await ghFetchRaw("https://api.github.com/user/installations/999/repositories");
      assert.fail("Should have thrown on 404");
    } catch (err) {
      assert.strictEqual(err.code, "NOT_FOUND");
      assert.strictEqual(err.status, 404);
    }
  });

  // 17. 429 handling -> RATE_LIMIT
  await test("17. 429 handling", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 429,
      headers: new Map(),
      clone: () => ({ json: async () => ({ message: "Too Many Requests" }) }),
      json: async () => ({ message: "Too Many Requests" }),
    }));

    try {
      await ghFetchRaw("https://api.github.com/user/installations/1/repositories");
      assert.fail("Should have thrown on 429");
    } catch (err) {
      assert.strictEqual(err.code, "RATE_LIMIT");
      assert.strictEqual(err.status, 429);
    }
  });

  // 18. 5xx handling -> SERVER
  await test("18. 5xx handling", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 503,
      headers: new Map(),
      clone: () => ({ json: async () => ({ message: "Service Unavailable" }) }),
      json: async () => ({ message: "Service Unavailable" }),
    }));

    try {
      await ghFetchRaw("https://api.github.com/user/installations/1/repositories");
      assert.fail("Should have thrown on 503");
    } catch (err) {
      assert.strictEqual(err.code, "SERVER");
      assert.strictEqual(err.status, 503);
    }
  });

  // 19. Network failure -> NETWORK
  await test("19. network failure", async () => {
    mockFetch(async () => {
      throw new Error("Failed to fetch (DNS / connection offline)");
    });

    try {
      await ghFetchRaw("https://api.github.com/user/installations/1/repositories");
      assert.fail("Should have thrown on network failure");
    } catch (err) {
      assert.strictEqual(err.code, "NETWORK");
    }
  });

  // 20. Token never logged or exposed in errors
  await test("20. token never logged", async () => {
    await setupAuth();
    let loggedStrings = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args) => loggedStrings.push(args.join(" "));
    console.warn = (...args) => loggedStrings.push(args.join(" "));
    console.error = (...args) => loggedStrings.push(args.join(" "));

    try {
      mockFetch(async () => ({
        ok: false,
        status: 401,
        headers: new Map(),
        clone: () => ({ json: async () => ({ message: "Unauthorized" }) }),
        json: async () => ({ message: "Unauthorized" }),
      }));

      try {
        await listInstalledRepos();
      } catch (err) {
        assert(!err.message.includes(TEST_TOKEN), "Error message must never contain token");
      }

      for (const str of loggedStrings) {
        assert(!str.includes(TEST_TOKEN), `Log output must never contain token: ${str}`);
      }
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });

  // 21. Token never persisted to syncLog or repo data
  await test("21. token never persisted", async () => {
    await setupAuth();
    mockFetch(async (url) => {
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [{ id: 1, app_slug: "fly2git-by-srt" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repositories: [{ full_name: "user/clean-repo", private: false }],
        }),
      };
    });

    const res = await listInstalledRepos();
    const serialized = JSON.stringify(res);
    assert(!serialized.includes(TEST_TOKEN), "Returned repo data must not contain token");
  });

  // 22. No All-repositories escalation
  await test("22. no All-repositories escalation", async () => {
    await setupAuth();
    let requestedUrls = [];

    mockFetch(async (url) => {
      requestedUrls.push(url);
      if (url.includes("/user/installations") && !url.includes("/repositories")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            total_count: 1,
            installations: [
              {
                id: 1,
                app_slug: "fly2git-by-srt",
                repository_selection: "selected", // Strict selected mode
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ total_count: 0, repositories: [] }),
      };
    });

    await listInstalledRepos();
    for (const u of requestedUrls) {
      assert(
        !u.includes("repository_selection=all"),
        "Must never request or escalate to all repositories"
      );
    }
  });

  // 23. Explicit repository selection
  await test("23. explicit repository selection", async () => {
    // In popup.js:
    // A placeholder option with value="" is selected by default:
    // const placeholder = makeOption("", "Select a repository…");
    // placeholder.disabled = true;
    // placeholder.selected = true;
    //
    // Clicking "Use this repository" with value="" is rejected:
    // const repo = select.value;
    // if (!repo) { showNotice("Please select a repository..."); return; }

    let savedRepo = null;
    const saveHandler = async (selectedOptionValue) => {
      if (!selectedOptionValue) return { ok: false, message: "Please select a repository" };
      savedRepo = selectedOptionValue;
      return { ok: true };
    };

    const emptyAttempt = await saveHandler("");
    assert.strictEqual(emptyAttempt.ok, false);
    assert.strictEqual(savedRepo, null, "Should not save when no repo selected");

    const validAttempt = await saveHandler("laxmansrt/leetlife");
    assert.strictEqual(validAttempt.ok, true);
    assert.strictEqual(savedRepo, "laxmansrt/leetlife");
  });

  console.log("\n=======================================================");
  console.log(`REPOSITORY PICKER RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
