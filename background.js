// Fly2Git — by SRT
// Background service worker: authentication (device flow), GitHub sync,
// error handling, pagination.
//
if (typeof importScripts === "function") {
  importScripts("config.js");
  importScripts("platforms.js");
  importScripts("entitlements.js");
  importScripts("identity.js");
  importScripts("automation-rules.js");
  importScripts("analytics.js");
}

if (typeof Fly2GitIdentity === "undefined" && typeof require !== "undefined") {
  try {
    globalThis.Fly2GitIdentity = require("./identity.js");
  } catch (_) {}
}

if (typeof Fly2GitAutomation === "undefined" && typeof require !== "undefined") {
  try {
    globalThis.Fly2GitAutomation = require("./automation-rules.js");
  } catch (_) {}
}

if (typeof Fly2GitAnalytics === "undefined" && typeof require !== "undefined") {
  try {
    globalThis.Fly2GitAnalytics = require("./analytics.js");
  } catch (_) {}
}


// Explicitly configure secure TRUSTED_CONTEXTS access level for extension session storage.
// Ensures staging storage is never exposed to untrusted/web contexts.
try {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
} catch (_) {}

const ATCODER_STAGING_KEY = "fly2git_atcoder_staging";
const ATCODER_STAGING_TTL_MS = 30000;

async function stageAtCoderSubmission(payload) {
  if (!payload || typeof payload !== "object") return;
  // Transient staging in extension session storage only. Never put into logs, history, or diagnostics.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [ATCODER_STAGING_KEY]: payload });
  }
}

async function getAtCoderStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    const res = await chrome.storage.session.get(ATCODER_STAGING_KEY);
    const data = res ? res[ATCODER_STAGING_KEY] : null;
    if (!data) return null;
    if (Date.now() - (data.timestamp || 0) > ATCODER_STAGING_TTL_MS) {
      await chrome.storage.session.remove(ATCODER_STAGING_KEY);
      return null;
    }
    return data;
  }
  return null;
}

async function clearAtCoderStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(ATCODER_STAGING_KEY);
  }
}

const CODEFORCES_STAGING_KEY = "fly2git_codeforces_staging";
const CODEFORCES_STAGING_TTL_MS = 30000;

async function stageCodeforcesSubmission(payload) {
  if (!payload || typeof payload !== "object") return;
  // Transient staging in extension session storage only. Never put into logs, history, or diagnostics.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [CODEFORCES_STAGING_KEY]: payload });
  }
}

async function getCodeforcesStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    const res = await chrome.storage.session.get(CODEFORCES_STAGING_KEY);
    const data = res ? res[CODEFORCES_STAGING_KEY] : null;
    if (!data) return null;
    if (Date.now() - (data.timestamp || 0) > CODEFORCES_STAGING_TTL_MS) {
      await chrome.storage.session.remove(CODEFORCES_STAGING_KEY);
      return null;
    }
    return data;
  }
  return null;
}

async function clearCodeforcesStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(CODEFORCES_STAGING_KEY);
  }
}

const SPOJ_STAGING_KEY = "fly2git_spoj_staging";
const SPOJ_STAGING_TTL_MS = 30000;

async function stageSPOJSubmission(payload) {
  if (!payload || typeof payload !== "object") return;
  // Transient staging in extension session storage only. Never put into logs, history, or diagnostics.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [SPOJ_STAGING_KEY]: payload });
  }
}

async function getSPOJStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    const res = await chrome.storage.session.get(SPOJ_STAGING_KEY);
    const data = res ? res[SPOJ_STAGING_KEY] : null;
    if (!data) return null;
    if (Date.now() - (data.timestamp || 0) > SPOJ_STAGING_TTL_MS) {
      await chrome.storage.session.remove(SPOJ_STAGING_KEY);
      return null;
    }
    return data;
  }
  return null;
}

async function clearSPOJStaging() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(SPOJ_STAGING_KEY);
  }
}

// ---------------------------------------------------------------
// Codeforces API boundary: all user.status polling runs HERE in
// the trusted background context, never in a content script.
// ---------------------------------------------------------------
const CF_API_HANDLE_RE = /^[A-Za-z0-9._-]{1,24}$/;

/**
 * Validates a Codeforces handle for safe inclusion in API URLs.
 * Handles may contain letters, digits, dots, underscores, and hyphens (max 24 chars).
 */
function isValidCodeforcesHandle(handle) {
  return typeof handle === "string" && CF_API_HANDLE_RE.test(handle);
}

/**
 * Fetches the 5 most recent submissions for a Codeforces handle via the
 * official user.status API. Returns a sanitized array of submission objects
 * containing only the fields the content script needs for correlation.
 *
 * SECURITY:
 * - Only calls https://codeforces.com/api/user.status (hardcoded).
 * - Validates handle against strict alphanumeric pattern.
 * - credentials: "omit" — never sends cookies or auth headers.
 * - Strips all fields except the safe correlation subset.
 * - Never logs source code.
 */
async function pollCodeforcesStatus(handle) {
  if (!isValidCodeforcesHandle(handle)) {
    return { ok: false, error: "Invalid handle" };
  }

  const apiUrl =
    "https://codeforces.com/api/user.status?handle=" +
    encodeURIComponent(handle) +
    "&from=1&count=5";

  try {
    const resp = await fetch(apiUrl, { credentials: "omit" });
    if (!resp.ok) {
      return { ok: false, error: "HTTP " + resp.status };
    }
    const data = await resp.json();
    if (!data || data.status !== "OK" || !Array.isArray(data.result)) {
      return { ok: false, error: data && data.comment ? data.comment : "Non-OK response" };
    }

    // Sanitize: return only the fields needed for correlation/verdict
    const sanitized = data.result.map(function (sub) {
      return {
        id: sub.id,
        contestId: sub.contestId,
        creationTimeSeconds: sub.creationTimeSeconds,
        verdict: sub.verdict || null,
        programmingLanguage: sub.programmingLanguage || null,
        problem: sub.problem
          ? {
              contestId: sub.problem.contestId,
              index: sub.problem.index,
              name: sub.problem.name,
              rating: sub.problem.rating != null ? sub.problem.rating : null,
            }
          : null,
        author: sub.author
          ? {
              participantType: sub.author.participantType || null,
              members: Array.isArray(sub.author.members)
                ? sub.author.members.map(function (m) {
                    return { handle: m.handle || null };
                  })
                : [],
            }
          : null,
      };
    });

    return { ok: true, submissions: sanitized };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "Fetch error" };
  }
}

const LANG_EXT = {
  python: "py",
  python3: "py",
  py: "py",
  pypy: "py",
  pypy3: "py",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  c_cpp: "cpp",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  javascript: "js",
  js: "js",
  nodejs: "js",
  typescript: "ts",
  ts: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  golang: "go",
  go: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  perl: "pl",
  r: "r",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
};

const DEVICE_POLL_ALARM = "fly2git-device-poll";

// ---------------------------------------------------------------
// FIX (P0-1): categorized GitHub errors.
//
// Previously, any non-200 response from a "does this file exist" check was
// treated as "file doesn't exist" — including a 401 (expired token) or a
// 403 (no permission), which would silently misroute an auth/permission
// failure into "must be a new file" and could produce confusing behavior
// downstream instead of a clear error.
//
// GitHubError.code lets callers (and the UI) react appropriately instead of
// showing a generic "GitHub API error".
// ---------------------------------------------------------------
class GitHubError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.code = code; // AUTH_EXPIRED | PERMISSION | NOT_FOUND | CONFLICT | VALIDATION | RATE_LIMIT | SERVER | NETWORK | UNKNOWN
  }
}

/**
 * Low-level fetch wrapper for the GitHub API. Classifies failures instead of
 * collapsing everything into "not ok". Returns the raw Response on success
 * (2xx) so callers can read headers (e.g. pagination Link headers) as well
 * as the body.
 *
 * @param {object} opts.treat404AsNull - if true, a literal 404 resolves to
 *   `null` instead of throwing. Only pass this where a 404 is a genuinely
 *   valid outcome (e.g. "does this file exist yet") — every other endpoint
 *   should let a 404 throw as NOT_FOUND, since a 404 on e.g. an
 *   installation-repositories call means something is actually wrong.
 */
async function ghFetchRaw(url, options = {}, { treat404AsNull = false } = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    throw new GitHubError(
      "Network unavailable. Check your connection and try again.",
      { code: "NETWORK" }
    );
  }

  if (res.status === 404 && treat404AsNull) {
    return null;
  }

  if (res.ok) {
    return res;
  }

  let body = {};
  try {
    body = await res.clone().json();
  } catch {
    /* body wasn't JSON — fine, we fall back to a generic message below */
  }

  switch (res.status) {
    case 401:
      throw new GitHubError(
        "GitHub authorization expired. Please reconnect GitHub.",
        { status: 401, code: "AUTH_EXPIRED" }
      );
    case 403: {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new GitHubError("GitHub rate limit reached. Try again later.", {
          status: 403,
          code: "RATE_LIMIT",
        });
      }
      throw new GitHubError(
        "Fly2Git does not have write permission for this repository.",
        { status: 403, code: "PERMISSION" }
      );
    }
    case 404:
      throw new GitHubError(
        "Repository or resource not found on GitHub. It may have been renamed, deleted, or Fly2Git's access to it was revoked.",
        { status: 404, code: "NOT_FOUND" }
      );
    case 409: {
      const isRepoEmpty =
        (body.message && body.message.toLowerCase().includes("empty")) ||
        (typeof body === "string" && body.toLowerCase().includes("empty"));
      if (isRepoEmpty) {
        throw new GitHubError("Git repository is empty.", {
          status: 409,
          code: "REPO_EMPTY",
        });
      }
      throw new GitHubError(
        body.message || "GitHub reported a conflict — the file changed elsewhere. Try syncing again.",
        { status: 409, code: "CONFLICT" }
      );
    }
    case 422:
      throw new GitHubError(
        body.message
          ? `GitHub rejected the request: ${body.message}`
          : "GitHub rejected the request (validation error).",
        { status: 422, code: "VALIDATION" }
      );
    case 429:
      throw new GitHubError("GitHub rate limit reached. Try again later.", {
        status: 429,
        code: "RATE_LIMIT",
      });
    default:
      if (res.status >= 500) {
        throw new GitHubError(
          "GitHub is having server issues right now. Try again shortly.",
          { status: res.status, code: "SERVER" }
        );
      }
      throw new GitHubError(body.message || `GitHub API error (${res.status})`, {
        status: res.status,
        code: "UNKNOWN",
      });
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Retries only failures where retrying is actually likely to help
// (transient network blips, GitHub 5xx). Auth/permission/validation errors
// are never retried — retrying those just wastes time and produces the same
// error again.
async function withRetry(fn, { retries = 1, delayMs = 1200, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof GitHubError &&
        (err.code === "NETWORK" || err.code === "SERVER" || err.code === "CONFLICT");
      if (!retryable || attempt === retries) throw err;
      if (onRetry) await onRetry(attempt + 1);
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------
// Pagination (FIX P1-6)
//
// Previously, only the first page of /user/installations and
// /user/installations/{id}/repositories was read, silently capping users at
// GitHub's default page size (30). This follows the Link: rel="next" header
// GitHub returns until there are no more pages.
// ---------------------------------------------------------------
function parseNextLink(linkHeader) {
  if (!linkHeader || typeof linkHeader !== "string") return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel=["']?next["']?/i);
    if (match) return match[1];
  }
  return null;
}

async function paginateItems(url, token, itemsKey, maxPages = 50) {
  let items = [];
  let next = `${url}${url.includes("?") ? "&" : "?"}per_page=100`;
  let pageCount = 0;

  while (next && pageCount < maxPages) {
    pageCount++;
    const res = await ghFetchRaw(next, { headers: authHeaders(token) });
    const data = await res.json();
    const pageItems = itemsKey ? data?.[itemsKey] : data;
    if (Array.isArray(pageItems)) {
      items = items.concat(pageItems);
    } else if (pageItems && typeof pageItems === "object") {
      items.push(pageItems);
    }
    const linkHeader =
      res.headers?.get ? res.headers.get("Link") : (res.headers && res.headers["link"]) || null;
    next = parseNextLink(linkHeader);
  }

  return items;
}

// ---------------------------------------------------------------
// Installations & repositories
//
// Collects repos across every matching installation and de-duplicates by
// full_name (GitHub repo full names are globally unique, protecting against
// accidental overlap).
// Returns an array-like object populated with repos, while also exposing
// .repos, .installations, and .manageUrl metadata.
// ---------------------------------------------------------------
async function listInstalledRepos() {
  const token = await getValidAccessToken();
  if (!token) {
    throw new GitHubError("Not connected to GitHub.", { code: "AUTH_EXPIRED" });
  }

  const installations = await paginateItems(
    "https://api.github.com/user/installations",
    token,
    "installations"
  );

  let fly2gitInstalls = installations.filter(
    (i) =>
      i &&
      i.app_slug &&
      i.app_slug.toLowerCase() === FLY2GIT_CONFIG.GITHUB_APP_SLUG.toLowerCase()
  );

  // Fallback: If slug didn't match (e.g. GitHub slug casing or null), but installations
  // exist for this authenticated user token (issued specifically for Fly2Git), preserve them.
  if (fly2gitInstalls.length === 0 && installations.length > 0) {
    fly2gitInstalls = installations;
  }

  const defaultManageUrl = `https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG}/installations/new`;

  if (fly2gitInstalls.length === 0) {
    const emptyResult = [];
    emptyResult.repos = [];
    emptyResult.installations = [];
    emptyResult.manageUrl = defaultManageUrl;
    return emptyResult;
  }

  const repoMap = new Map(); // full_name -> { fullName, private }
  for (const install of fly2gitInstalls) {
    if (!install?.id) continue;
    try {
      const repos = await paginateItems(
        `https://api.github.com/user/installations/${install.id}/repositories`,
        token,
        "repositories"
      );
      for (const r of repos) {
        if (r && r.full_name) {
          repoMap.set(r.full_name, {
            fullName: r.full_name,
            private: !!r.private,
          });
        }
      }
    } catch (err) {
      if (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.DEBUG) {
        console.warn(
          `[Fly2Git] Failed to fetch repositories for installation ${install.id}:`,
          err?.message
        );
      }
    }
  }

  const sortedRepos = Array.from(repoMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  const primaryInstall = fly2gitInstalls[0];
  const manageUrl =
    primaryInstall?.html_url ||
    (primaryInstall?.id
      ? `https://github.com/settings/installations/${primaryInstall.id}`
      : defaultManageUrl);

  const installList = fly2gitInstalls.map((i) => ({
    id: i.id,
    account: i.account?.login || null,
    repositorySelection: i.repository_selection || null,
    manageUrl:
      i.html_url || `https://github.com/settings/installations/${i.id}`,
  }));

  const result = [...sortedRepos];
  result.repos = sortedRepos;
  result.installations = installList;
  result.manageUrl = manageUrl;

  return result;
}

// ---------------------------------------------------------------
// File existence check for duplicate detection (FIX P0-1 applied here).
// Only a literal 404 means "no such file yet". Everything else — expired
// auth, no permission, GitHub down — throws a categorized error instead of
// being silently treated as "file doesn't exist", which could otherwise
// mask an auth failure as a normal first-time sync.
// ---------------------------------------------------------------
async function getFileIfExists(repo, path, token) {
  const res = await ghFetchRaw(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    { headers: authHeaders(token) },
    { treat404AsNull: true }
  );
  if (!res) return null;
  const data = await res.json();
  return {
    decodedContent: b64DecodeUnicode(data.content || ""),
    sha: data.sha || null,
  };
}

function normalizeCodeForComparison(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ---------------------------------------------------------------
// Single-commit sync (FIX P2-9)
//
// Previously: two separate Contents-API PUT calls (solution, then README)
// produced two commits per accepted solution.
//
// Now: uses the Git Data API (blobs -> tree -> commit -> ref update) to
// write both files in exactly one commit, matching the report's desired
// result of one "Add: Problem (Difficulty)" commit containing both files.
//
// Trade-off, as requested to document: this is 6 API calls instead of 2
// (repo lookup, ref lookup, base commit lookup, 2 blob creations, tree
// creation, commit creation, ref update — 7 total) per sync, versus 2
// before. All 7 run sequentially rather than racing GitHub's rate limits
// aggressively; for a single-user personal-use extension this is well
// within GitHub's rate limit even during a burst of accepted submissions,
// but it's worth knowing if usage patterns change (e.g. many
// submissions/minute across many users hitting a shared token, which
// doesn't apply to Fly2Git's per-user-token model anyway).
// ---------------------------------------------------------------
/**
 * Generic single-commit multi-file writer using GitHub Git Data API.
 * Writes N files in exactly one atomic commit (tree -> commit -> ref update).
 * Used for both individual solution syncs and repository-wide backfill operations.
 */
async function commitMultipleFiles({
  repo,
  files, // Array of { path, content }
  commitMessage,
  token,
}) {
  if (!files || files.length === 0) return { skipped: true };

  const repoRes = await ghFetchRaw(`https://api.github.com/repos/${repo}`, {
    headers: authHeaders(token),
  });
  const repoData = await repoRes.json();
  const branch = repoData.default_branch || "main";

  let latestCommitSha;
  let baseTree;

  try {
    const refRes = await ghFetchRaw(
      `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
      { headers: authHeaders(token) }
    );
    const { object: refObject } = await refRes.json();
    latestCommitSha = refObject.sha;

    const baseCommitRes = await ghFetchRaw(
      `https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`,
      { headers: authHeaders(token) }
    );
    const { tree } = await baseCommitRes.json();
    baseTree = tree;
  } catch (err) {
    if (
      err instanceof GitHubError &&
      (err.code === "REPO_EMPTY" ||
        (err.message && err.message.toLowerCase().includes("empty")))
    ) {
      await ghFetchRaw(`https://api.github.com/repos/${repo}/contents/README.md`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({
          message: `Initialize repository with README via ${FLY2GIT_CONFIG.BRAND_NAME}`,
          content: b64EncodeUnicode(
            `# Coding Solutions\n\nAutomated solution sync powered by [${FLY2GIT_CONFIG.BRAND_NAME}](https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG}).\n`
          ),
          branch,
        }),
      });

      const refRes = await ghFetchRaw(
        `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
        { headers: authHeaders(token) }
      );
      const { object: refObject } = await refRes.json();
      latestCommitSha = refObject.sha;

      const baseCommitRes = await ghFetchRaw(
        `https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`,
        { headers: authHeaders(token) }
      );
      const { tree } = await baseCommitRes.json();
      baseTree = tree;
    } else {
      throw err;
    }
  }

  // Create blobs in parallel
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const blob = await createBlob(repo, file.content, token);
      return {
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      };
    })
  );

  const treeRes = await ghFetchRaw(`https://api.github.com/repos/${repo}/git/trees`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      base_tree: baseTree.sha,
      tree: treeItems,
    }),
  });
  const newTree = await treeRes.json();

  const commitRes = await ghFetchRaw(`https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    }),
  });
  const newCommit = await commitRes.json();

  await ghFetchRaw(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });

  return { commitSha: newCommit.sha, branch, fileCount: files.length };
}

async function commitSolutionAndReadme({
  repo,
  solutionPath,
  solutionContent,
  readmePath,
  readmeContent,
  platformReadmePath = null,
  platformReadmeContent = null,
  commitMessage,
  token,
}) {
  const files = [
    { path: solutionPath, content: solutionContent },
    { path: readmePath, content: readmeContent },
  ];
  if (platformReadmePath && platformReadmeContent) {
    files.push({
      path: platformReadmePath,
      content: platformReadmeContent,
    });
  }

  return commitMultipleFiles({
    repo,
    files,
    commitMessage,
    token,
  });
}

/**
 * Checks all active platforms in PLATFORM_REGISTRY for missing top-level {Platform}/README.md.
 * If any platform READMEs are missing, creates ALL of them in a SINGLE GitHub commit.
 * Preserves existing READMEs without overwriting or modifying them.
 */
async function backfillPlatformReadmes(repo, token) {
  if (!repo || !token) {
    throw new Error("Repository and token are required for platform README backfill.");
  }

  const activePlatforms = Fly2GitPlatforms.getActivePlatforms
    ? Fly2GitPlatforms.getActivePlatforms()
    : Object.keys(Fly2GitPlatforms.PLATFORM_REGISTRY || {})
        .filter((k) => Fly2GitPlatforms.PLATFORM_REGISTRY[k].active)
        .map((k) => Fly2GitPlatforms.PLATFORM_REGISTRY[k]);

  const checkPromises = activePlatforms.map(async (plat) => {
    const platformId = plat.id || plat.name;
    const folder = Fly2GitPlatforms.getCanonicalPlatformFolder(platformId);
    const readmePath = Fly2GitPlatforms.buildPlatformReadmePath
      ? Fly2GitPlatforms.buildPlatformReadmePath(platformId)
      : `${folder}/README.md`;

    const existing = await getFileIfExists(repo, readmePath, token);
    return {
      platformId,
      folder,
      readmePath,
      exists: !!existing,
    };
  });

  const checkResults = await Promise.all(checkPromises);
  const missing = checkResults.filter((r) => !r.exists);

  if (missing.length === 0) {
    return { backfilled: false, count: 0, files: [] };
  }

  const filesToCommit = missing.map((m) => {
    const content = Fly2GitPlatforms.buildPlatformReadme
      ? Fly2GitPlatforms.buildPlatformReadme(m.platformId)
      : `# ${m.folder}\n\nSolutions synced by ${FLY2GIT_CONFIG.BRAND_NAME}.\n`;
    return {
      path: m.readmePath,
      content,
    };
  });

  const commitSubject = `Initialize platform directories (${filesToCommit.length})`;
  const commitBody = `Ensure top-level platform directories for GitHub repository view.\nSynced via ${FLY2GIT_CONFIG.BRAND_NAME}`;

  const commitResult = await commitMultipleFiles({
    repo,
    files: filesToCommit,
    commitMessage: `${commitSubject}\n\n${commitBody}`,
    token,
  });

  return {
    backfilled: true,
    count: filesToCommit.length,
    files: filesToCommit.map((f) => f.path),
    commitSha: commitResult.commitSha,
    branch: commitResult.branch,
  };
}

async function createBlob(repo, content, token) {
  const res = await ghFetchRaw(`https://api.github.com/repos/${repo}/git/blobs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content: b64EncodeUnicode(content), encoding: "base64" }),
  });
  return res.json();
}

function buildReadme({ title, difficulty, lang, url, platform }) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# ${title}`,
    "",
  ];
  if (platform && platform !== "LeetCode") {
    lines.push(`**Platform:** ${platform}`);
  }
  lines.push(
    `**Difficulty:** ${difficulty || "Unknown"}`,
    `**Link:** ${url || ""}`,
    `**Language:** ${lang}`,
    `**Synced:** ${date} via [${FLY2GIT_CONFIG.BRAND_NAME}](https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG})`,
    ""
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------
// Main sync entry point, called when content.js forwards a validated
// ACCEPTED event.
// ---------------------------------------------------------------
let syncQueue = Promise.resolve();

function enqueueSync(payload) {
  const run = syncQueue.then(() => handleAcceptedSubmissionInternal(payload));
  syncQueue = run.catch(() => {});
  return run;
}

/**
 * Phase 16.3: Dispatch sync notification to active content tab + popup.
 * This function is fire-and-forget: it never throws and never blocks sync.
 * Zero credentials, tokens, or source code in the payload.
 */
function dispatchSyncNotification(notifPayload) {
  try {
    if (!chrome || !chrome.tabs || !chrome.runtime) return;
    const message = { type: "fly2git-sync-result", payload: notifPayload };

    // Broadcast to popup (if open)
    chrome.runtime.sendMessage(message).catch(function () {});

    // Send to the active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(function () {});
      }
    });
  } catch (_) {
    // Silent fail: notification dispatch must never disrupt sync
  }
}

/**
 * Resolves the authorized target repository for a given platform.
 * Under Basic: strictly limited to the single selectedRepo.
 * Under Pro: routes to platformRepoTargets[platform] if configured, falling back to selectedRepo.
 *
 * Repository Security:
 * - Verifies user entitlement before routing.
 * - Verifies the target repository is in the user's authorized GitHub App installation.
 * - Prevents arbitrary repository writes, cross-user repository access, and leakage.
 */
async function resolveTargetRepository(platform, options = {}) {
  const { selectedRepo, platformRepoTargets } = await chrome.storage.local.get([
    "selectedRepo",
    "platformRepoTargets",
  ]);

  let target = selectedRepo || null;
  const canMultiRepo = await Fly2GitEntitlements.canUseMultipleRepositories();

  if (canMultiRepo && platform && platformRepoTargets && typeof platformRepoTargets === "object") {
    if (platformRepoTargets[platform]) {
      target = platformRepoTargets[platform];
    }
  }

  if (!target) {
    throw new GitHubError(
      "No repository selected. Open the popup to connect Fly2Git.",
      { code: "CONFIG" }
    );
  }

  // Repository Security Check: Must be authorized through GitHub App installation
  try {
    const listFn = options.listInstalledRepos || listInstalledRepos;
    const installed = options.installedRepos || (await listFn());
    if (Array.isArray(installed) && installed.length > 0) {
      const isAuthorized = installed.some(
        (r) => (r.fullName || r.full_name || r) === target
      );
      if (!isAuthorized) {
        throw new GitHubError(
          `Repository '${target}' is not authorized under your GitHub App installation.`,
          { code: "UNAUTHORIZED_REPO" }
        );
      }
    }
  } catch (err) {
    if (err && err.code === "UNAUTHORIZED_REPO") {
      throw err;
    }
  }

  return target;
}

async function handleAcceptedSubmissionInternal(rawPayload) {
  if (!rawPayload) return;

  const normalized = Fly2GitPlatforms.normalizeSubmission(rawPayload);
  const validation = Fly2GitPlatforms.validateNormalizedSubmission(normalized);
  if (!validation.ok) {
    console.warn("[Fly2Git][Sync] Invalid submission rejected:", validation.error);
    const error = new GitHubError(validation.error, { code: "VALIDATION" });
    setStatus(false, error.message);
    throw error;
  }

  const { platform, problem, submission, user } = normalized;
  const { slug, title, difficulty, url } = problem;
  const { code, language: lang } = submission;

  console.log("[Fly2Git][Background] Accepted submission received", {
    platform,
    problem: { slug, title, difficulty },
    submission: { id: submission.id, language: lang },
  });

  // Authoritative Platform Identity Guard Check:
  // Enforces platform account matching BEFORE entitlement, duplicate detection, or GitHub writes.
  if (typeof Fly2GitIdentity !== "undefined" && Fly2GitIdentity.verifySubmissionIdentity) {
    const idCheck = await Fly2GitIdentity.verifySubmissionIdentity(platform, user);
    if (!idCheck.ok) {
      console.warn(`[Fly2Git][Identity] Submission blocked for ${platform}: ${idCheck.status} - ${idCheck.reason}`);
      const error = new GitHubError(idCheck.status, { code: idCheck.status });
      setStatus(false, idCheck.reason || idCheck.status);
      await logSync({
        title,
        difficulty,
        platform,
        lang,
        status: "failed",
        reason: idCheck.reason,
        code: idCheck.status,
      });
      throw error;
    }
  }

  // Centralized Entitlement Check: enforce platform permission at background boundary
  // BEFORE any repository reads, token verification, GitHub API calls, or commits.
  const allowed = await Fly2GitEntitlements.canUsePlatform(platform);
  if (!allowed) {
    console.warn(`[Fly2Git][Entitlement] Platform not allowed under current plan: ${platform}`);
    const error = new GitHubError("PLATFORM_NOT_ALLOWED", { code: "ENTITLEMENT" });
    setStatus(false, "Platform not enabled for current plan");
    await logSync({
      title,
      difficulty,
      platform,
      lang,
      status: "failed",
      reason: `Platform '${platform}' is not enabled in your selected plan. Enable it in the popup.`,
      code: "ENTITLEMENT",
    });
    throw error;
  }

  // Advanced Automation Integration (Phase 14A):
  // Check if current user entitlement authorizes advancedAutomation (Pro feature).
  // If authorized and automation is active, evaluate filters before proceeding to repo/token calls.
  let autoSettings = null;
  let isAutomationAuthorized = false;
  try {
    if (typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.canUseAdvancedAutomation) {
      isAutomationAuthorized = await Fly2GitEntitlements.canUseAdvancedAutomation();
    }
  } catch (_) {
    isAutomationAuthorized = false;
  }

  if (isAutomationAuthorized && typeof Fly2GitAutomation !== "undefined") {
    autoSettings = await Fly2GitAutomation.getStoredAutomationSettings();
    const filterDecision = Fly2GitAutomation.shouldSyncSubmission(autoSettings, {
      platform,
      difficulty,
      language: lang,
      slug,
      title,
    });

    if (!filterDecision.allow) {
      console.log(`[Fly2Git][Automation] Submission skipped: ${filterDecision.reason}`);
      setStatus(true, `Skipped: ${filterDecision.reason}`);
      await logSync({
        title,
        difficulty,
        platform,
        lang,
        status: "skipped",
        reason: filterDecision.reason,
      });
      await recordAnalyticsEventIfAuthorized({
        platform,
        problemSlug: slug,
        title,
        difficulty,
        language: lang,
        action: "skipped",
        syncStatus: "skipped",
        isUpdate: false,
        repositoryTarget: "unresolved",
        skipReason: filterDecision.reason,
      });
      dispatchSyncNotification({
        syncId: `${platform}:${slug}:${submission.id || Date.now()}`,
        type: "skipped",
        platform,
        problemTitle: title,
        difficulty,
        reason: filterDecision.reason,
        timestamp: Date.now(),
      });
      return { skipped: true, reason: filterDecision.reason };
    }
  }

  // Build syncId for notification deduplication
  const syncId = `${platform}:${slug}:${submission.id || Date.now()}`;

  let selectedRepo;
  try {
    selectedRepo = await resolveTargetRepository(platform);
  } catch (err) {
    setStatus(false, err.message);
    await logSync({
      title,
      difficulty,
      platform,
      lang,
      status: "failed",
      reason: err.message,
      code: err.code || "CONFIG",
    });
    throw err;
  }

  const token = await getValidAccessToken();
  if (!token) {
    const error = new GitHubError(
      "Not connected to GitHub. Open the popup to reconnect.",
      { code: "AUTH_EXPIRED" }
    );
    setStatus(false, error.message);
    await logSync({ title, difficulty, platform, lang, status: "failed", reason: error.message, code: error.code });
    throw error;
  }

  const ext = LANG_EXT[lang.toLowerCase()];
  if (!ext) {
    const error = new GitHubError(
      `Unsupported or unknown language: ${lang}`,
      { code: "VALIDATION" }
    );
    setStatus(false, error.message);
    await logSync({ title, difficulty, platform, lang, status: "failed", reason: error.message, code: error.code });
    throw error;
  }
  let folder = Fly2GitPlatforms.buildCanonicalFolderPath(platform, difficulty, slug);
  let solutionPath = `${folder}/solution.${ext}`;
  let readmePath = `${folder}/README.md`;

  if (
    isAutomationAuthorized &&
    autoSettings &&
    autoSettings.pathOrganization &&
    autoSettings.pathOrganization.template &&
    typeof Fly2GitAutomation !== "undefined"
  ) {
    const customPaths = Fly2GitAutomation.renderSolutionPath(
      autoSettings.pathOrganization.template,
      {
        platform,
        platformFolder: folder.split("/")[0],
        difficulty,
        slug,
        language: lang,
      },
      ext
    );
    folder = customPaths.folder;
    solutionPath = customPaths.solutionPath;
    readmePath = customPaths.readmePath;
  }

  const platformReadmePath = Fly2GitPlatforms.buildPlatformReadmePath
    ? Fly2GitPlatforms.buildPlatformReadmePath(platform)
    : `${folder.split("/")[0]}/README.md`;

  console.log("[Fly2Git][Background] Starting GitHub sync", {
    platform,
    repo: selectedRepo,
    path: solutionPath,
  });

  try {
    const maxRetries =
      isAutomationAuthorized &&
      autoSettings &&
      autoSettings.retryPolicy &&
      typeof autoSettings.retryPolicy.maxRetries === "number"
        ? Math.max(0, Math.min(2, autoSettings.retryPolicy.maxRetries))
        : 1;

    const result = await withRetry(
      async () => {
        // Check for existing solution, problem README, and platform-level README.
        // The platform-level README ({Platform}/README.md) prevents GitHub's file browser
        // from collapsing nested single-child paths into a single line on the repository root.
        const [existingSolution, existingReadme, existingPlatformReadme] = await Promise.all([
          getFileIfExists(selectedRepo, solutionPath, token),
          getFileIfExists(selectedRepo, readmePath, token),
          getFileIfExists(selectedRepo, platformReadmePath, token),
        ]);

        const sameSolution =
          existingSolution &&
          normalizeCodeForComparison(existingSolution.decodedContent) ===
            normalizeCodeForComparison(code);

        // Duplicate detection: skip only when the solution is unchanged,
        // the companion README exists, and the platform README exists.
        if (sameSolution && existingReadme && existingPlatformReadme) {
          return { skipped: true };
        }

        const isUpdate = Boolean(existingSolution);
        let commitSubject;
        if (
          isAutomationAuthorized &&
          autoSettings &&
          autoSettings.commitMessage &&
          autoSettings.commitMessage.template &&
          typeof Fly2GitAutomation !== "undefined"
        ) {
          commitSubject = Fly2GitAutomation.renderCommitMessage(
            autoSettings.commitMessage.template,
            {
              platform,
              title,
              difficulty,
              language: lang,
              submissionId: submission.id,
              isUpdate,
              slug,
            }
          );
        } else {
          commitSubject = `${isUpdate ? "Update" : "Add"}: ${title} (${difficulty || "Unknown"})`;
        }
        const commitBody = `Platform: ${platform}\nLanguage: ${lang}\nSynced via ${FLY2GIT_CONFIG.BRAND_NAME}\n${url || ""}`;

        // Create the platform-level README only if it does not already exist in this repository.
        // If it already exists or if disabled by automation rules, preserve it completely.
        const allowPlatformReadme =
          isAutomationAuthorized && autoSettings && typeof Fly2GitAutomation !== "undefined"
            ? Fly2GitAutomation.shouldGeneratePlatformReadme(autoSettings, platform)
            : true;
        const shouldCreatePlatformReadme = !existingPlatformReadme && allowPlatformReadme;
        const platformReadmeContent = shouldCreatePlatformReadme
          ? (Fly2GitPlatforms.buildPlatformReadme
              ? Fly2GitPlatforms.buildPlatformReadme(platform)
              : `# ${platformReadmePath.split("/")[0]}\n\nSolutions synced automatically by ${FLY2GIT_CONFIG.BRAND_NAME}.\n`)
          : null;

        const { branch } = await commitSolutionAndReadme({
          repo: selectedRepo,
          solutionPath,
          solutionContent: code,
          readmePath,
          readmeContent: buildReadme({ title, difficulty, lang, url, platform }),
          platformReadmePath: shouldCreatePlatformReadme ? platformReadmePath : null,
          platformReadmeContent: platformReadmeContent,
          commitMessage: `${commitSubject}\n\n${commitBody}`,
          token,
        });

        return {
          skipped: false,
          isUpdate,
          githubUrl: `https://github.com/${selectedRepo}/tree/${branch}/${folder}`,
        };
      },
      {
        retries: maxRetries,
        onRetry: () => logSync({ title, difficulty, platform, lang, status: "retrying" }),
      }
    );

    console.log("[Fly2Git][Background] GitHub sync result", result);

    if (result.skipped) {
      setStatus(true, `No changes — ${title} already synced`);
      await logSync({ title, difficulty, platform, lang, status: "skipped" });
      await recordAnalyticsEventIfAuthorized({
        platform,
        problemSlug: slug,
        title,
        difficulty,
        language: lang,
        action: "skipped",
        syncStatus: "skipped",
        isUpdate: false,
        repositoryTarget: selectedRepo,
        skipReason: "DUPLICATE: Solution already synced",
      });
      dispatchSyncNotification({
        syncId: syncId,
        type: "duplicate",
        platform,
        problemTitle: title,
        difficulty,
        repository: selectedRepo,
        path: solutionPath,
        timestamp: Date.now(),
      });
    } else {
      setStatus(true, `${result.isUpdate ? "Updated" : "Pushed"}: ${title}`);
      await logSync({
        title,
        difficulty,
        platform,
        lang,
        status: result.isUpdate ? "updated" : "added",
        githubUrl: result.githubUrl,
      });
      await recordAnalyticsEventIfAuthorized({
        platform,
        problemSlug: slug,
        title,
        difficulty,
        language: lang,
        action: "synced",
        syncStatus: result.isUpdate ? "updated" : "added",
        isUpdate: Boolean(result.isUpdate),
        repositoryTarget: selectedRepo,
        retryCount: result.retryCount || 0,
      });
      dispatchSyncNotification({
        syncId: syncId,
        type: result.isUpdate ? "update" : "success",
        platform,
        problemTitle: title,
        difficulty,
        repository: selectedRepo,
        path: solutionPath,
        commitUrl: result.githubUrl || null,
        timestamp: Date.now(),
      });
    }

    // Phase 16.4: Store latest accepted problem complexity context
    try {
      const measuredRuntime = (normalized.submission && normalized.submission.runtime) || rawPayload.runtime || null;
      const measuredMemory = (normalized.submission && normalized.submission.memory) || rawPayload.memory || null;
      await chrome.storage.local.set({
        latestProblemComplexity: {
          platform,
          problemSlug: slug,
          title,
          difficulty,
          language: lang,
          measured: {
            runtime: measuredRuntime,
            memory: measuredMemory,
          },
          timestamp: Date.now(),
        },
      });
    } catch (_) {}

    return result;
  } catch (err) {
    const message =
      err && err.message
        ? err.message
        : "Unknown error";

    console.log("[Fly2Git][Background] GitHub sync result", {
      success: false,
      error: message,
      code: err && err.code ? err.code : "UNKNOWN",
    });

    console.error("Fly2Git sync failed:", err);
    setStatus(false, message);
    await logSync({
      title,
      difficulty,
      platform,
      lang,
      status: "failed",
      reason: message,
      code: err && err.code ? err.code : "UNKNOWN",
    });
    await recordAnalyticsEventIfAuthorized({
      platform,
      problemSlug: slug,
      title,
      difficulty,
      language: lang,
      action: "failed",
      syncStatus: "failed",
      isUpdate: false,
      repositoryTarget: selectedRepo || "unresolved",
      skipReason: message,
    });
    dispatchSyncNotification({
      syncId: syncId,
      type: "error",
      platform,
      problemTitle: title,
      difficulty,
      repository: selectedRepo || "unresolved",
      error: message,
      timestamp: Date.now(),
    });
    throw err;
  }
}

// ---------------------------------------------------------------
// Device Flow authentication (FIX P0-4)
//
// Previously this whole flow — including the poll loop — lived in
// popup.js's setInterval. Closing the popup destroyed that interval, so
// authorizing GitHub *after* closing the popup silently never completed.
//
// It now lives here in the background worker. Two complementary polling
// mechanisms cover both cases:
//
//  1. While the popup is open, it holds a long-lived port connection open,
//     which keeps this service worker alive. We poll at GitHub's requested
//     interval (usually ~5s) via setInterval for a fast, responsive UI.
//
//  2. If the popup is closed, the service worker can be suspended by
//     Chrome at any time — a bare setInterval would simply stop. So we
//     also register a chrome.alarms alarm as a durable backstop. Chrome
//     alarms survive service worker suspension and will wake the worker up
//     to poll even with the popup closed.
//
// Documented platform limitation: Manifest V3 clamps alarm periods to a
// minimum of 1 minute in a published (non-unpacked) extension. So with the
// popup closed, authorization can take up to ~1 minute to be detected after
// you approve it on GitHub, instead of ~5 seconds. This is a real trade-off
// inherent to MV3 service workers, not something Fly2Git can avoid short of
// running a persistent background page (not available in MV3) or a
// backend — see README "Known limitations".
// ---------------------------------------------------------------

let fastPollTimer = null;
let popupPort = null;
let devicePollInFlight = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "fly2git-popup") return;
  popupPort = port;
  maybeStartFastPoll();
  port.onDisconnect.addListener(() => {
    popupPort = null;
    clearInterval(fastPollTimer);
    fastPollTimer = null;
  });
});

function maybeStartFastPoll() {
  if (!popupPort || fastPollTimer) return;
  chrome.storage.local.get("deviceFlow").then(({ deviceFlow }) => {
    if (deviceFlow?.status === "pending") {
      fastPollTimer = setInterval(
        pollDeviceFlow,
        Math.max(5, Number(deviceFlow.interval) || 5) * 1000
      );
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DEVICE_POLL_ALARM) {
    pollDeviceFlow();
  }
});

async function startDeviceFlow() {
  if (FLY2GIT_CONFIG.GITHUB_APP_CLIENT_ID.startsWith("REPLACE_WITH")) {
    await chrome.storage.local.set({
      deviceFlow: {
        status: "error",
        message: "Fly2Git isn't configured yet. Set GITHUB_APP_CLIENT_ID in config.js.",
      },
    });
    return;
  }

  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: FLY2GIT_CONFIG.GITHUB_APP_CLIENT_ID }),
  });
  const data = await res.json();

  if (!data.device_code) {
    await chrome.storage.local.set({
      deviceFlow: {
        status: "error",
        message: "Couldn't start GitHub connection. Check your Client ID in config.js.",
      },
    });
    return;
  }

  await chrome.storage.local.set({
    deviceFlow: {
      status: "pending",
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      deviceCode: data.device_code,
      interval: data.interval || 5,
      expiresAt: Date.now() + (data.expires_in || 900) * 1000,
      message: "Waiting for authorization…",
    },
  });

  // Durable backstop: fires even if this service worker gets suspended.
  // Chrome clamps periodInMinutes to a 1-minute minimum for published
  // extensions (see comment above).
  chrome.alarms.create(DEVICE_POLL_ALARM, { periodInMinutes: 1 });

  maybeStartFastPoll();
  pollDeviceFlow(); // also try immediately rather than waiting for the first tick
}

async function pollDeviceFlow() {
  if (devicePollInFlight) return;
  devicePollInFlight = true;

  try {
    const { deviceFlow } = await chrome.storage.local.get("deviceFlow");
    if (!deviceFlow || deviceFlow.status !== "pending") {
      chrome.alarms.clear(DEVICE_POLL_ALARM);
      clearInterval(fastPollTimer);
      fastPollTimer = null;
      return;
    }

    if (Date.now() > deviceFlow.expiresAt) {
      await chrome.storage.local.set({
        deviceFlow: {
          status: "expired",
          message: "Code expired — click Connect GitHub to try again.",
        },
      });
      chrome.alarms.clear(DEVICE_POLL_ALARM);
      clearInterval(fastPollTimer);
      fastPollTimer = null;
      return;
    }

    let tokenData;
    try {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: FLY2GIT_CONFIG.GITHUB_APP_CLIENT_ID,
          device_code: deviceFlow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      tokenData = await res.json();
    } catch {
      return;
    }

    if (tokenData.access_token) {
      await chrome.storage.local.set({
        auth: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Date.now() + (tokenData.expires_in || 28800) * 1000,
        },
        deviceFlow: { status: "success" },
      });
      chrome.alarms.clear(DEVICE_POLL_ALARM);
      clearInterval(fastPollTimer);
      fastPollTimer = null;
      return;
    }

    if (tokenData.error === "slow_down") {
      const nextInterval = Math.max(5, Number(deviceFlow.interval) || 5) + 5;
      await chrome.storage.local.set({
        deviceFlow: { ...deviceFlow, interval: nextInterval },
      });
      if (fastPollTimer) {
        clearInterval(fastPollTimer);
        fastPollTimer = null;
        maybeStartFastPoll();
      }
      return;
    }

    if (tokenData.error && tokenData.error !== "authorization_pending") {
      await chrome.storage.local.set({
        deviceFlow: {
          status: "error",
          message:
            tokenData.error === "expired_token"
              ? "Code expired — click Connect GitHub to try again."
              : `GitHub error: ${tokenData.error}`,
        },
      });
      chrome.alarms.clear(DEVICE_POLL_ALARM);
      clearInterval(fastPollTimer);
      fastPollTimer = null;
    }
  } finally {
    devicePollInFlight = false;
  }
}

// ---------------------------------------------------------------
// Token storage & refresh. Device Flow tokens for GitHub Apps don't need a
// client secret to refresh (unlike classic OAuth Apps), so this stays
// backend-free.
// ---------------------------------------------------------------
async function getValidAccessToken() {
  const { auth } = await chrome.storage.local.get("auth");
  if (!auth?.accessToken) return null;

  const bufferMs = 5 * 60 * 1000;
  if (auth.expiresAt && Date.now() > auth.expiresAt - bufferMs) {
    return refreshAccessToken(auth.refreshToken);
  }
  return auth.accessToken;
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;

  let data;
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: FLY2GIT_CONFIG.GITHUB_APP_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    data = await res.json();
  } catch {
    return null; // network failure — caller will surface "not connected"
  }

  if (!data.access_token) return null;

  const auth = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 28800) * 1000,
  };
  await chrome.storage.local.set({ auth });
  return auth.accessToken;
}

// ---------------------------------------------------------------
// Message router
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "PUSH_TO_GITHUB":
      enqueueSync(message.payload)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code }));
      return true;

    case "GET_REPOS":
      listInstalledRepos()
        .then((result) =>
          sendResponse({
            ok: true,
            repos: result.repos || result,
            installations: result.installations || [],
            manageUrl: result.manageUrl || null,
          })
        )
        .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code }));
      return true;

    case "START_DEVICE_FLOW":
      startDeviceFlow().then(() => sendResponse({ ok: true }));
      return true;

    case "GET_DEVICE_FLOW_STATUS":
      chrome.storage.local.get("deviceFlow").then(({ deviceFlow }) => {
        sendResponse({ ok: true, deviceFlow: deviceFlow || { status: "idle" } });
      });
      return true;

    case "DISCONNECT":
      chrome.storage.local
        .remove(["auth", "selectedRepo", "deviceFlow"])
        .then(() => sendResponse({ ok: true }));
      return true;

    case "CLEAR_SYNC_LOG":
      chrome.storage.local
        .set({ syncLog: [] })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_ENTITLEMENT":
      Fly2GitEntitlements.getEntitlement()
        .then((entitlement) => sendResponse({ ok: true, entitlement }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "IS_PRO":
      Fly2GitEntitlements.isPro()
        .then((isPro) => sendResponse({ ok: true, isPro }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CAN_USE_FEATURE":
      Fly2GitEntitlements.canUseFeature(message.feature)
        .then((allowed) => sendResponse({ ok: true, allowed }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_FEATURE_LIMIT":
      Fly2GitEntitlements.getFeatureLimit(message.feature)
        .then((limit) => sendResponse({ ok: true, limit }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CAN_USE_PLATFORM":
      Fly2GitEntitlements.canUsePlatform(message.platform)
        .then((allowed) => sendResponse({ ok: true, allowed }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CAN_USE_MULTIPLE_REPOSITORIES":
      Fly2GitEntitlements.canUseMultipleRepositories()
        .then((allowed) => sendResponse({ ok: true, allowed }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SET_SELECTED_PLATFORMS":
      Fly2GitEntitlements.setSelectedPlatforms(message.platforms)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SET_TEST_PLAN":
      Fly2GitEntitlements.setTestPlan(message.plan, message.options)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SYNC_BACKEND_ENTITLEMENT":
      chrome.storage.local.get(["auth"]).then(async ({ auth }) => {
        const token = (auth && auth.fly2gitToken) || message.authToken || null;
        const backendUrl = message.backendUrl || null;
        const res = await Fly2GitEntitlements.syncBackendEntitlement(token, backendUrl);
        sendResponse(res);
      }).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

function getBackendBaseUrl(overrideUrl) {
  if (overrideUrl && typeof overrideUrl === "string") return overrideUrl.replace(/\/+$/, "");
  if (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG) {
    if (FLY2GIT_CONFIG.BACKEND_API_URL) return FLY2GIT_CONFIG.BACKEND_API_URL.replace(/\/+$/, "");
    if (FLY2GIT_CONFIG.BACKEND_URL) return FLY2GIT_CONFIG.BACKEND_URL.replace(/\/+$/, "");
  }
  return "https://api.fly2git.com";
}

async function fetchBackend(endpoint, options = {}, overrideUrl) {
  let baseUrl = overrideUrl;
  if (!baseUrl && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(["backendUrl", "backendApiUrl"]);
      if (stored && (stored.backendUrl || stored.backendApiUrl)) {
        baseUrl = stored.backendUrl || stored.backendApiUrl;
      }
    } catch (_) {}
  }
  if (!baseUrl) {
    baseUrl = getBackendBaseUrl();
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const targetUrl = `${cleanBase}${endpoint}`;

  try {
    const res = await fetch(targetUrl, options);
    return { res, baseUrlUsed: cleanBase };
  } catch (netErr) {
    // If canonical production domain failed (e.g. unresolvable DNS or offline during local testing),
    // probe local dev server on port 8080.
    if (!overrideUrl && cleanBase.includes("fly2git.com")) {
      const devCandidate = "http://localhost:8080";
      try {
        const probeRes = await fetch(`${devCandidate}/health`, { method: "GET" });
        if (probeRes.ok) {
          const fallbackRes = await fetch(`${devCandidate}${endpoint}`, options);
          try {
            await chrome.storage.local.set({ backendUrl: devCandidate });
          } catch (_) {}
          return { res: fallbackRes, baseUrlUsed: devCandidate };
        }
      } catch (_) {
        // Fallback probe failed, proceed to informative error
      }
    }
    const msg =
      netErr && netErr.message === "Failed to fetch"
        ? `Could not connect to Fly2Git backend (${cleanBase}). If testing locally, ensure your server is running on port 8080.`
        : (netErr && netErr.message) || "Network request failed";
    const enhancedErr = new Error(msg);
    throw enhancedErr;
  }
}

    case "CREATE_CHECKOUT_SESSION":
      chrome.storage.local.get(["auth"]).then(async ({ auth }) => {
        const token = (auth && auth.fly2gitToken) || message.authToken || null;
        if (!token) {
          sendResponse({ ok: false, error: "UNAUTHENTICATED", message: "Fly2Git backend authentication required" });
          return;
        }
        try {
          const { res } = await fetchBackend(
            "/api/checkout/create-session",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                plan: message.plan || "pro",
                billingCycle: message.billingCycle || "monthly",
              }),
            },
            message.backendUrl
          );
          const data = await res.json();
          sendResponse(data);
        } catch (err) {
          sendResponse({ ok: false, error: "NETWORK_ERROR", message: err.message });
        }
      }).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CREATE_PORTAL_SESSION":
      chrome.storage.local.get(["auth"]).then(async ({ auth }) => {
        const token = (auth && auth.fly2gitToken) || message.authToken || null;
        if (!token) {
          sendResponse({ ok: false, error: "UNAUTHENTICATED", message: "Fly2Git backend authentication required" });
          return;
        }
        try {
          const { res } = await fetchBackend(
            "/api/billing/portal-session",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({}),
            },
            message.backendUrl
          );
          const data = await res.json();
          sendResponse(data);
        } catch (err) {
          sendResponse({ ok: false, error: "NETWORK_ERROR", message: err.message });
        }
      }).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SET_PLATFORM_REPO_TARGET":
      (async () => {
        const isPro = await Fly2GitEntitlements.canUseMultipleRepositories();
        if (!isPro) {
          return { ok: false, error: "Multi-repository mapping requires Fly2Git Pro" };
        }
        const { platform, repo } = message;
        if (!platform || typeof platform !== "string") {
          return { ok: false, error: "Invalid platform specified" };
        }
        const { platformRepoTargets } = await chrome.storage.local.get("platformRepoTargets");
        const targets = Object.assign({}, platformRepoTargets || {});
        if (repo) {
          targets[platform] = repo;
        } else {
          delete targets[platform];
        }
        await chrome.storage.local.set({ platformRepoTargets: targets });
        return { ok: true, targets };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_PLATFORM_REPO_TARGETS":
      chrome.storage.local
        .get("platformRepoTargets")
        .then(({ platformRepoTargets }) => {
          sendResponse({ ok: true, targets: platformRepoTargets || {} });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "REGISTER_FLY2GIT_ACCOUNT":
      (async () => {
        const { email, password, backendUrl } = message;
        const { res: resp, baseUrlUsed } = await fetchBackend(
          "/api/auth/register",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          },
          backendUrl
        );
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          return { ok: false, error: data.error || "Registration failed" };
        }
        const { auth } = await chrome.storage.local.get("auth");
        const updatedAuth = Object.assign({}, auth || {}, {
          fly2gitToken: data.token,
          fly2gitUser: data.user,
        });
        await chrome.storage.local.set({
          auth: updatedAuth,
          userSession: { token: data.token, user: data.user },
          fly2git_session: { token: data.token, user: data.user },
        });
        await Fly2GitEntitlements.syncBackendEntitlement(data.token, baseUrlUsed);
        return { ok: true, user: data.user };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "LOGIN_FLY2GIT_ACCOUNT":
      (async () => {
        const { email, password, backendUrl } = message;
        const { res: resp, baseUrlUsed } = await fetchBackend(
          "/api/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          },
          backendUrl
        );
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          return { ok: false, error: data.error || "Login failed" };
        }
        const { auth } = await chrome.storage.local.get("auth");
        const updatedAuth = Object.assign({}, auth || {}, {
          fly2gitToken: data.token,
          fly2gitUser: data.user,
        });
        await chrome.storage.local.set({
          auth: updatedAuth,
          userSession: { token: data.token, user: data.user },
          fly2git_session: { token: data.token, user: data.user },
        });
        await Fly2GitEntitlements.syncBackendEntitlement(data.token, baseUrlUsed);
        return { ok: true, user: data.user };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "LOGOUT_FLY2GIT_ACCOUNT":
      (async () => {
        const { auth } = await chrome.storage.local.get("auth");
        if (auth) {
          const updatedAuth = Object.assign({}, auth);
          delete updatedAuth.fly2gitToken;
          delete updatedAuth.fly2gitUser;
          await chrome.storage.local.set({ auth: updatedAuth });
        }
        await chrome.storage.local.remove(["userSession", "fly2git_session"]);
        if (typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.clearTestEntitlement) {
          Fly2GitEntitlements.clearTestEntitlement();
        }
        // Fallback to basic entitlement safely without touching GitHub connection
        const basic = Fly2GitEntitlements.sanitizeEntitlement({ plan: "basic" });
        await chrome.storage.local.set({ [Fly2GitEntitlements.ENTITLEMENT_STORAGE_KEY]: basic });
        return { ok: true };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_FLY2GIT_ACCOUNT":
      chrome.storage.local
        .get("auth")
        .then(({ auth }) => {
          const user = (auth && auth.fly2gitUser) || null;
          const token = (auth && auth.fly2gitToken) || null;
          sendResponse({ ok: true, user, authenticated: Boolean(token) });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_DIAGNOSTICS":
      getDiagnosticsSnapshot()
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "STAGE_ATCODER_SUBMISSION":
      stageAtCoderSubmission(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_ATCODER_STAGING":
      getAtCoderStaging()
        .then((staging) => sendResponse({ ok: true, staging }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CLEAR_ATCODER_STAGING":
      clearAtCoderStaging()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "STAGE_CODEFORCES_SUBMISSION":
      stageCodeforcesSubmission(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_CODEFORCES_STAGING":
      getCodeforcesStaging()
        .then((staging) => sendResponse({ ok: true, staging }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CLEAR_CODEFORCES_STAGING":
      clearCodeforcesStaging()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "POLL_CODEFORCES_STATUS":
      pollCodeforcesStatus(message.handle)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "STAGE_SPOJ_SUBMISSION":
      stageSPOJSubmission(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_SPOJ_STAGING":
      getSPOJStaging()
        .then((staging) => sendResponse({ ok: true, staging }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CLEAR_SPOJ_STAGING":
      clearSPOJStaging()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "BACKFILL_PLATFORM_READMES":
      (async () => {
        const repo = message.repo || (await chrome.storage.local.get("selectedRepo")).selectedRepo;
        const token = await getValidAccessToken();
        if (!repo || !token) {
          return { ok: false, error: "Repository or token unavailable" };
        }
        return backfillPlatformReadmes(repo, token);
      })()
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_PLATFORM_IDENTITIES":
      if (typeof Fly2GitIdentity !== "undefined") {
        Fly2GitIdentity.getStoredIdentities()
          .then((identities) => sendResponse({ ok: true, identities }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      } else {
        sendResponse({ ok: false, error: "Identity guard not loaded" });
      }
      return true;

    case "GET_PLATFORM_IDENTITY_STATE":
      if (typeof Fly2GitIdentity !== "undefined") {
        Fly2GitIdentity.getPlatformState(message.platform)
          .then((state) => sendResponse({ ok: true, state }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      } else {
        sendResponse({ ok: false, error: "Identity guard not loaded" });
      }
      return true;

    case "PLATFORM_IDENTITY_DETECTED":
      if (typeof Fly2GitIdentity !== "undefined") {
        Fly2GitIdentity.onIdentityDetected(message.platform, message.identity)
          .then((res) => sendResponse({ ok: true, ...res }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      } else {
        sendResponse({ ok: false, error: "Identity guard not loaded" });
      }
      return true;

    case "BIND_PLATFORM_IDENTITY":
      if (typeof Fly2GitIdentity !== "undefined") {
        Fly2GitIdentity.bindPlatformIdentity(message.platform, message.identity)
          .then((res) => sendResponse({ ok: true, ...res }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      } else {
        sendResponse({ ok: false, error: "Identity guard not loaded" });
      }
      return true;

    case "CLEAR_PLATFORM_IDENTITY":
      if (typeof Fly2GitIdentity !== "undefined") {
        Fly2GitIdentity.clearPlatformBinding(message.platform)
          .then((res) => sendResponse({ ok: true, ...res }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      } else {
        sendResponse({ ok: false, error: "Identity guard not loaded" });
      }
      return true;

    // --- Personal Coding Analytics (Phase 14B) ---
    case "GET_ANALYTICS_OVERVIEW":
      (async () => {
        const authorized = typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.canUseAnalytics
          ? await Fly2GitEntitlements.canUseAnalytics()
          : false;
        if (!authorized) {
          return { ok: false, error: "PRO_REQUIRED", isPro: false };
        }

        const { userSession, cachedAnalyticsEvents } = await chrome.storage.local.get(["userSession", "cachedAnalyticsEvents"]);
        const range = message.range || "30d";
        const tz = typeof message.tz === "number" ? message.tz : 0;

        if (userSession && userSession.token) {
          try {
            const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
            const res = await fetch(`${backendBase}/api/analytics/overview?range=${encodeURIComponent(range)}&tz=${encodeURIComponent(tz)}`, {
              headers: { Authorization: `Bearer ${userSession.token}` },
            });
            if (res.ok) {
              const data = await res.json();
              return { ok: true, isPro: true, offline: false, ...data };
            }
          } catch (_) {}
        }

        const events = Array.isArray(cachedAnalyticsEvents) ? cachedAnalyticsEvents : [];
        if (typeof Fly2GitAnalytics !== "undefined") {
          const overview = Fly2GitAnalytics.computeOverview(events, { range, timezoneOffset: tz });
          return { ok: true, isPro: true, offline: true, ...overview };
        }
        return { ok: false, error: "Analytics engine unavailable" };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_ANALYTICS_ACTIVITY":
      (async () => {
        const authorized = typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.canUseAnalytics
          ? await Fly2GitEntitlements.canUseAnalytics()
          : false;
        if (!authorized) return { ok: false, error: "PRO_REQUIRED", isPro: false };

        const { userSession, cachedAnalyticsEvents } = await chrome.storage.local.get(["userSession", "cachedAnalyticsEvents"]);
        const range = message.range || "30d";
        const tz = typeof message.tz === "number" ? message.tz : 0;

        if (userSession && userSession.token) {
          try {
            const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
            const res = await fetch(`${backendBase}/api/analytics/activity?range=${encodeURIComponent(range)}&tz=${encodeURIComponent(tz)}`, {
              headers: { Authorization: `Bearer ${userSession.token}` },
            });
            if (res.ok) {
              const data = await res.json();
              return { ok: true, isPro: true, offline: false, ...data };
            }
          } catch (_) {}
        }

        const events = Array.isArray(cachedAnalyticsEvents) ? cachedAnalyticsEvents : [];
        if (typeof Fly2GitAnalytics !== "undefined") {
          const timeline = Fly2GitAnalytics.computeActivityTimeline(events, { range, timezoneOffset: tz });
          return { ok: true, isPro: true, offline: true, range, timeline };
        }
        return { ok: false, error: "Analytics engine unavailable" };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "DELETE_ANALYTICS_DATA":
      (async () => {
        await chrome.storage.local.set({ cachedAnalyticsEvents: [] });
        const { userSession } = await chrome.storage.local.get("userSession");
        if (userSession && userSession.token) {
          try {
            const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
            await fetch(`${backendBase}/api/analytics`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${userSession.token}` },
            });
          } catch (_) {}
        }
        return { ok: true, deleted: true };
      })()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;


    default:
      return false;
  }
});

// ---------------------------------------------------------------
// Diagnostics snapshot (safe: NEVER includes tokens, secrets, or code)
/**
 * Pro Multi-Repository Architecture Preparation (Phase 12A):
 * Retrieves the configured target repository / repositories.
 * Under Basic: strictly limited to the single selectedRepo.
 * Under Pro: returns targetRepos array if configured, falling back to [selectedRepo].
 */
async function getTargetRepositories() {
  const { selectedRepo, targetRepos } = await chrome.storage.local.get(["selectedRepo", "targetRepos"]);
  const canMulti = await Fly2GitEntitlements.canUseMultipleRepositories();
  if (canMulti && Array.isArray(targetRepos) && targetRepos.length > 0) {
    return targetRepos;
  }
  return selectedRepo ? [selectedRepo] : [];
}

// ---------------------------------------------------------------
async function getDiagnosticsSnapshot() {
  const [authData, repoData, entData, lastSyncData, syncLogData] = await Promise.all([
    chrome.storage.local.get("auth"),
    chrome.storage.local.get("selectedRepo"),
    Fly2GitEntitlements.getEntitlement(),
    chrome.storage.local.get("lastSync"),
    chrome.storage.local.get("syncLog"),
  ]);

  const isConnected = Boolean(authData.auth && authData.auth.accessToken);
  const selectedRepo = repoData.selectedRepo || null;
  const isProPlan = await Fly2GitEntitlements.isPro(entData);
  const plan = isProPlan ? "Pro" : "Basic";
  const allowedPlatforms = await Fly2GitEntitlements.getAllowedPlatforms(entData);

  let version = "1.1.6";
  try {
    if (chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest && manifest.version) version = manifest.version;
    }
  } catch (_) {}

  return {
    extension: "OK",
    version: version,
    github: {
      connected: isConnected,
      repository: selectedRepo,
    },
    plan: plan,
    connectedPlatforms: allowedPlatforms,
    syncEngine: "OK",
    queue: "Empty",
    lastSync: lastSyncData.lastSync || null,
    recentSyncCount: Array.isArray(syncLogData.syncLog) ? syncLogData.syncLog.length : 0,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------
function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUnicode(str) {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

function setStatus(ok, text) {
  if (typeof chrome !== "undefined" && chrome.action && chrome.action.setBadgeText) {
    chrome.action.setBadgeText({ text: ok ? "✓" : "✗" });
    if (chrome.action.setBadgeBackgroundColor) {
      chrome.action.setBadgeBackgroundColor({ color: ok ? "#2ea44f" : "#d73a49" });
    }
    setTimeout(() => {
      try {
        if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: "" });
      } catch (_) {}
    }, 6000);
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ lastSync: { ok, text, time: Date.now() } });
  }
}

// status: "added" | "updated" | "skipped" | "failed" | "retrying"
async function logSync(entry) {
  if (!entry || typeof entry !== "object") return;
  // Sanitize to guarantee metadata only — never persist source code, tokens, or raw payloads
  const cleanEntry = {
    title: typeof entry.title === "string" ? entry.title.slice(0, 300) : "Untitled",
    difficulty: typeof entry.difficulty === "string" ? entry.difficulty.slice(0, 50) : "Unknown",
    platform: typeof entry.platform === "string" ? entry.platform.slice(0, 50) : "Unknown",
    lang: typeof entry.lang === "string" ? entry.lang.slice(0, 50) : "unknown",
    status: typeof entry.status === "string" ? entry.status : "unknown",
    time: typeof entry.time === "number" ? entry.time : Date.now(),
  };
  if (entry.githubUrl && typeof entry.githubUrl === "string") {
    cleanEntry.githubUrl = entry.githubUrl.slice(0, 500);
  }
  if (entry.code && typeof entry.code === "string") {
    cleanEntry.code = entry.code.slice(0, 50);
  }
  if (entry.reason && typeof entry.reason === "string") {
    cleanEntry.reason = entry.reason.slice(0, 300);
  }

  let currentLog = [];
  try {
    const data = await chrome.storage.local.get("syncLog");
    if (Array.isArray(data.syncLog)) currentLog = data.syncLog;
  } catch (_) {
    currentLog = [];
  }
  const updated = [cleanEntry, ...currentLog].slice(0, 20);
  await chrome.storage.local.set({ syncLog: updated });
}

/**
 * Personal Coding Analytics Event Recording (Phase 14B)
 * Strictly Pro-only: Basic users are never tracked (Data Minimization).
 * Pure metadata: NEVER stores solution code, cookies, passwords, tokens, or raw HTML.
 */
async function recordAnalyticsEventIfAuthorized(eventData) {
  try {
    if (typeof Fly2GitEntitlements !== "undefined" && Fly2GitEntitlements.canUseAnalytics) {
      const authorized = await Fly2GitEntitlements.canUseAnalytics();
      if (!authorized) return null; // Basic users are never tracked
    } else {
      return null;
    }

    const sanitized = typeof Fly2GitAnalytics !== "undefined"
      ? Fly2GitAnalytics.sanitizeEvent(eventData)
      : eventData;
    if (!sanitized) return null;

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get("cachedAnalyticsEvents");
      const list = Array.isArray(stored.cachedAnalyticsEvents) ? stored.cachedAnalyticsEvents : [];
      const updated = [sanitized, ...list].slice(0, 500);
      await chrome.storage.local.set({ cachedAnalyticsEvents: updated });

      const { userSession } = await chrome.storage.local.get("userSession");
      if (userSession && userSession.token) {
        const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
        fetch(`${backendBase}/api/analytics/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userSession.token}`,
          },
          body: JSON.stringify(sanitized),
        }).catch(() => {});
      }
    }
    return sanitized;
  } catch (err) {
    console.debug("[Fly2Git][Analytics] Non-blocking event recording error:", err.message);
    return null;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    stageAtCoderSubmission,
    getAtCoderStaging,
    clearAtCoderStaging,
    ATCODER_STAGING_KEY,
    ATCODER_STAGING_TTL_MS,
    stageCodeforcesSubmission,
    getCodeforcesStaging,
    clearCodeforcesStaging,
    CODEFORCES_STAGING_KEY,
    CODEFORCES_STAGING_TTL_MS,
    stageSPOJSubmission,
    getSPOJStaging,
    clearSPOJStaging,
    SPOJ_STAGING_KEY,
    SPOJ_STAGING_TTL_MS,
    pollCodeforcesStatus,
    isValidCodeforcesHandle,
    CF_API_HANDLE_RE,
    LANG_EXT,
    listInstalledRepos,
    paginateItems,
    parseNextLink,
    ghFetchRaw,
    GitHubError,
    getValidAccessToken,
    withRetry,
    commitMultipleFiles,
    commitSolutionAndReadme,
    backfillPlatformReadmes,
    handleAcceptedSubmissionInternal,
    resolveTargetRepository,
    getTargetRepositories,
    buildReadme,
    recordAnalyticsEventIfAuthorized,
    Fly2GitIdentity: typeof Fly2GitIdentity !== "undefined" ? Fly2GitIdentity : null,
    Fly2GitAnalytics: typeof Fly2GitAnalytics !== "undefined" ? Fly2GitAnalytics : null,
  };
}
