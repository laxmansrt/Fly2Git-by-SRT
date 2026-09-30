// Fly2Git — by SRT
// Background service worker: authentication (device flow), GitHub sync,
// error handling, pagination.
//
// See README.md "Security considerations" for what this file stores and why.
importScripts("config.js");
importScripts("platforms.js");
importScripts("entitlements.js");

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
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function paginateItems(url, token, itemsKey) {
  let items = [];
  let next = `${url}${url.includes("?") ? "&" : "?"}per_page=100`;

  while (next) {
    const res = await ghFetchRaw(next, { headers: authHeaders(token) });
    const data = await res.json();
    const pageItems = itemsKey ? data[itemsKey] : data;
    items = items.concat(pageItems || []);
    next = parseNextLink(res.headers.get("Link"));
  }

  return items;
}

// ---------------------------------------------------------------
// Installations & repositories (FIX P1-5)
//
// Previously this picked the *first* installation matching the app slug —
// a user with Fly2Git installed on their personal account AND an
// organization would only ever see the first one's repos. This now
// collects repos across every matching installation and de-duplicates by
// full_name (GitHub repo full names are globally unique, so this also
// protects against any accidental overlap).
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

  const fly2gitInstalls = installations.filter(
    (i) => i.app_slug === FLY2GIT_CONFIG.GITHUB_APP_SLUG
  );
  if (fly2gitInstalls.length === 0) return [];

  const repoMap = new Map(); // full_name -> { fullName, private }
  for (const install of fly2gitInstalls) {
    const repos = await paginateItems(
      `https://api.github.com/user/installations/${install.id}/repositories`,
      token,
      "repositories"
    );
    for (const r of repos) {
      repoMap.set(r.full_name, { fullName: r.full_name, private: r.private });
    }
  }

  return Array.from(repoMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );
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
async function commitSolutionAndReadme({
  repo,
  solutionPath,
  solutionContent,
  readmePath,
  readmeContent,
  commitMessage,
  token,
}) {
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

  const [solutionBlob, readmeBlob] = await Promise.all([
    createBlob(repo, solutionContent, token),
    createBlob(repo, readmeContent, token),
  ]);

  const treeRes = await ghFetchRaw(`https://api.github.com/repos/${repo}/git/trees`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      base_tree: baseTree.sha,
      tree: [
        { path: solutionPath, mode: "100644", type: "blob", sha: solutionBlob.sha },
        { path: readmePath, mode: "100644", type: "blob", sha: readmeBlob.sha },
      ],
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

  return { commitSha: newCommit.sha, branch };
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

  const { platform, problem, submission } = normalized;
  const { slug, title, difficulty, url } = problem;
  const { code, language: lang } = submission;

  // Centralized Entitlement Check: enforce platform permission at background boundary
  // BEFORE any repository reads, token verification, GitHub API calls, or commits.
  const allowed = await Fly2GitEntitlements.isPlatformAllowed(platform);
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

  const { selectedRepo } = await chrome.storage.local.get("selectedRepo");
  if (!selectedRepo) {
    const error = new GitHubError(
      "No repository selected. Open the popup to connect Fly2Git.",
      { code: "CONFIG" }
    );
    setStatus(false, error.message);
    await logSync({ title, difficulty, platform, lang, status: "failed", reason: error.message, code: error.code });
    throw error;
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
  const folder = Fly2GitPlatforms.buildCanonicalFolderPath(platform, difficulty, slug);
  const solutionPath = `${folder}/solution.${ext}`;
  const readmePath = `${folder}/README.md`;

  try {
    const result = await withRetry(
      async () => {
        // Duplicate detection: skip only when the solution is unchanged and
        // the companion README already exists. Line endings are normalized,
        // but meaningful whitespace changes are preserved.
        const [existingSolution, existingReadme] = await Promise.all([
          getFileIfExists(selectedRepo, solutionPath, token),
          getFileIfExists(selectedRepo, readmePath, token),
        ]);

        const sameSolution =
          existingSolution &&
          normalizeCodeForComparison(existingSolution.decodedContent) ===
            normalizeCodeForComparison(code);

        if (sameSolution && existingReadme) {
          return { skipped: true };
        }

        const isUpdate = Boolean(existingSolution);
        const commitSubject = `${isUpdate ? "Update" : "Add"}: ${title} (${difficulty || "Unknown"})`;
        const commitBody = `Platform: ${platform}\nLanguage: ${lang}\nSynced via ${FLY2GIT_CONFIG.BRAND_NAME}\n${url || ""}`;

        const { branch } = await commitSolutionAndReadme({
          repo: selectedRepo,
          solutionPath,
          solutionContent: code,
          readmePath,
          readmeContent: buildReadme({ title, difficulty, lang, url, platform }),
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
        retries: 1,
        onRetry: () => logSync({ title, difficulty, platform, lang, status: "retrying" }),
      }
    );

    if (result.skipped) {
      setStatus(true, `No changes — ${title} already synced`);
      await logSync({ title, difficulty, platform, lang, status: "skipped" });
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
    }
    return result;
  } catch (err) {
    const message =
      err && err.message
        ? err.message
        : "Unknown error";

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
        .then((repos) => sendResponse({ ok: true, repos }))
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

    case "SET_SELECTED_PLATFORMS":
      Fly2GitEntitlements.setSelectedPlatforms(message.platforms)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SET_TEST_PLAN":
      Fly2GitEntitlements.setTestPlan(message.plan)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_DIAGNOSTICS":
      getDiagnosticsSnapshot()
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    default:
      return false;
  }
});

// ---------------------------------------------------------------
// Diagnostics snapshot (safe: NEVER includes tokens, secrets, or code)
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
  const plan = entData.plan === "pro" ? "Pro" : "Basic";
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
  chrome.action.setBadgeText({ text: ok ? "✓" : "✗" });
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#2ea44f" : "#d73a49" });
  chrome.storage.local.set({ lastSync: { ok, text, time: Date.now() } });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
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
