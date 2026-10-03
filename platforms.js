// Fly2Git — by SRT
// Centralized Platform Registry & Normalized Submission Contract
//
// Shared module providing:
// 1. Central platform registry (active vs planned platforms)
// 2. Normalized submission contract converter & validator
// 3. Reusable Git path sanitizer for safe folder hierarchy

(function (root) {
  "use strict";

  const PLATFORM_REGISTRY = Object.freeze({
    leetcode: Object.freeze({
      id: "leetcode",
      name: "LeetCode",
      origin: "https://leetcode.com",
      active: true,
      allowedDifficulties: Object.freeze(["Easy", "Medium", "Hard", "Unknown"]),
    }),
    geeksforgeeks: Object.freeze({
      id: "geeksforgeeks",
      name: "GeeksforGeeks",
      origin: "https://www.geeksforgeeks.org",
      active: true,
      allowedDifficulties: Object.freeze(["School", "Basic", "Easy", "Medium", "Hard", "Unknown"]),
    }),
    hackerrank: Object.freeze({
      id: "hackerrank",
      name: "HackerRank",
      origin: "https://www.hackerrank.com",
      active: true,
      allowedDifficulties: Object.freeze(["Easy", "Medium", "Hard", "Unknown"]),
    }),
    codechef: Object.freeze({
      id: "codechef",
      name: "CodeChef",
      origin: "https://www.codechef.com",
      active: true,
      allowedDifficulties: Object.freeze(["Easy", "Medium", "Hard", "Unknown"]),
    }),
    codeforces: Object.freeze({
      id: "codeforces",
      name: "Codeforces",
      origin: "https://codeforces.com",
      active: true,
      allowedDifficulties: Object.freeze(["Unknown"]),
    }),
    atcoder: Object.freeze({
      id: "atcoder",
      name: "AtCoder",
      origin: "https://atcoder.jp",
      active: true,
      allowedDifficulties: Object.freeze(["Unknown"]),
    }),
    spoj: Object.freeze({
      id: "spoj",
      name: "SPOJ",
      origin: "https://www.spoj.com",
      active: true,
      allowedDifficulties: Object.freeze(["Unknown"]),
    }),
    usaco: Object.freeze({
      id: "usaco",
      name: "USACO",
      origin: "https://usaco.org",
      active: false,
      allowedDifficulties: Object.freeze(["Unknown"]),
    }),
  });

  /**
   * Sanitizes an individual path component (platform, difficulty, slug/problem title)
   * to guarantee safe Git paths without directory traversal or control characters,
   * while keeping human-readable problem names readable.
   */
  function sanitizePathSegment(segment, fallback, maxLength) {
    var fb = fallback || "Unknown";
    var maxLen = maxLength || 120;

    if (segment == null) return fb;
    var str = String(segment).trim();
    if (!str) return fb;

    // Remove null bytes and ASCII control characters (0-31 and 127)
    str = str.replace(/[\x00-\x1f\x7f]/g, "");

    // Remove directory traversal dots anywhere in the string
    str = str.replace(/\.\.+/g, "");

    // Prevent directory traversal: remove leading/trailing slashes and dots
    str = str.replace(/^[/\\.]+/g, "").replace(/[/\\.]+$/g, "");

    // Replace internal forward slashes, backslashes, colons with hyphens
    str = str.replace(/[/\\:]+/g, " - ");

    // Remove characters that cause issues in Git refs, Windows/Unix filenames: < > " | ? *
    str = str.replace(/[<>"|?*]/g, "");

    // Collapse multiple hyphens or whitespace
    str = str.replace(/\s*-\s*-+\s*/g, " - ");
    str = str.replace(/\s+/g, " ").trim();

    // Check again after sanitization
    if (!str || str === "." || str === "..") return fb;

    // Enforce max length while preserving word boundaries where possible
    if (str.length > maxLen) {
      str = str.slice(0, maxLen).trim();
    }

    return str || fb;
  }

  /**
   * Resolves the safe canonical platform folder name (e.g. "LeetCode", "Codeforces", "SPOJ").
   */
  function getCanonicalPlatformFolder(platformName) {
    var regKey = (platformName || "").toString().toLowerCase().trim();
    var canonicalName = (PLATFORM_REGISTRY[regKey] && PLATFORM_REGISTRY[regKey].name) || platformName;
    return sanitizePathSegment(canonicalName, "LeetCode", 50);
  }

  /**
   * Constructs the safe canonical platform-level README file path:
   * <Platform>/README.md
   */
  function buildPlatformReadmePath(platformName) {
    var folder = getCanonicalPlatformFolder(platformName);
    return folder + "/README.md";
  }

  /**
   * Retrieves all currently active platforms from PLATFORM_REGISTRY.
   */
  function getActivePlatforms() {
    return Object.keys(PLATFORM_REGISTRY)
      .filter(function (key) {
        return PLATFORM_REGISTRY[key] && PLATFORM_REGISTRY[key].active;
      })
      .map(function (key) {
        return PLATFORM_REGISTRY[key];
      });
  }

  /**
   * Constructs minimal, clean content for the platform-level README:
   * # {Platform}
   *
   * Solutions synced by Fly2Git by SRT.
   */
  function buildPlatformReadme(platformName) {
    var folder = getCanonicalPlatformFolder(platformName);
    var brand = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG && FLY2GIT_CONFIG.BRAND_NAME)
      ? FLY2GIT_CONFIG.BRAND_NAME
      : "Fly2Git by SRT";
    return "# " + folder + "\n\nSolutions synced by " + brand + ".\n";
  }

  /**
   * Constructs a safe canonical GitHub folder path:
   * <Platform>/<Difficulty>/<Problem>/
   */
  function buildCanonicalFolderPath(platformName, difficulty, problemIdentifier) {
    var safePlatform = getCanonicalPlatformFolder(platformName);
    var safeDifficulty = sanitizePathSegment(difficulty, "Unknown", 50);
    var safeProblem = sanitizePathSegment(problemIdentifier, "problem", 120);

    return safePlatform + "/" + safeDifficulty + "/" + safeProblem;
  }

  /**
   * Normalizes incoming submission payloads into the canonical NormalizedSubmission contract.
   * Fully backwards-compatible with the legacy flat LeetCode payload.
   */
  function normalizeSubmission(raw) {
    if (!raw || typeof raw !== "object") return null;

    // Case 1: Already structured as NormalizedSubmission
    if (raw.problem && raw.submission && typeof raw.problem === "object" && typeof raw.submission === "object") {
      var user1 = raw.user && typeof raw.user === "object"
        ? {
            platformUserId: raw.user.platformUserId ? String(raw.user.platformUserId).trim() : null,
            username: raw.user.username ? String(raw.user.username).trim() : null,
            detectedAt: typeof raw.user.detectedAt === "number" ? raw.user.detectedAt : Date.now(),
          }
        : (raw.username || raw.handle || raw.platformUserId
            ? {
                platformUserId: raw.platformUserId ? String(raw.platformUserId).trim() : (raw.handle || raw.username ? String(raw.handle || raw.username).trim() : null),
                username: (raw.handle || raw.username) ? String(raw.handle || raw.username).trim() : null,
                detectedAt: Date.now(),
              }
            : null);

      return {
        platform: raw.platform || "LeetCode",
        user: user1,
        problem: {
          slug: String(raw.problem.slug || "").trim(),
          title: String(raw.problem.title || raw.problem.slug || "").trim(),
          difficulty: String(raw.problem.difficulty || "Unknown").trim(),
          url: String(raw.problem.url || "").trim(),
        },
        submission: {
          id: String(raw.submission.id || "").trim(),
          status: String(raw.submission.status || "Accepted").trim(),
          language: String(raw.submission.language || raw.submission.lang || "unknown").trim(),
          code: typeof raw.submission.code === "string" ? raw.submission.code : "",
          runtime: raw.submission.runtime || raw.runtime || null,
          memory: raw.submission.memory || raw.memory || null,
        },
        metadata: {
          timestamp: typeof raw.metadata?.timestamp === "number" ? raw.metadata.timestamp : Date.now(),
        },
      };
    }

    // Case 2: Legacy flat LeetCode payload: { slug, title, difficulty, code, lang, url, submissionId }
    var user2 = raw.user && typeof raw.user === "object"
      ? {
          platformUserId: raw.user.platformUserId ? String(raw.user.platformUserId).trim() : null,
          username: raw.user.username ? String(raw.user.username).trim() : null,
          detectedAt: typeof raw.user.detectedAt === "number" ? raw.user.detectedAt : Date.now(),
        }
      : (raw.username || raw.handle || raw.platformUserId
          ? {
              platformUserId: raw.platformUserId ? String(raw.platformUserId).trim() : (raw.handle || raw.username ? String(raw.handle || raw.username).trim() : null),
              username: (raw.handle || raw.username) ? String(raw.handle || raw.username).trim() : null,
              detectedAt: Date.now(),
            }
          : null);

    return {
      platform: "LeetCode",
      user: user2,
      problem: {
        slug: String(raw.slug || "").trim(),
        title: String(raw.title || raw.slug || "").trim(),
        difficulty: String(raw.difficulty || "Unknown").trim(),
        url: String(raw.url || "").trim(),
      },
      submission: {
        id: String(raw.submissionId || raw.id || "").trim(),
        status: "Accepted",
        language: String(raw.lang || raw.language || "unknown").trim(),
        code: typeof raw.code === "string" ? raw.code : "",
        runtime: raw.runtime || null,
        memory: raw.memory || null,
      },
      metadata: {
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
      },
    };
  }

  /**
   * Validates a NormalizedSubmission object against security and schema constraints.
   */
  function validateNormalizedSubmission(norm) {
    if (!norm || typeof norm !== "object") {
      return { ok: false, error: "Invalid submission object" };
    }

    if (!norm.platform || typeof norm.platform !== "string") {
      return { ok: false, error: "Missing or invalid platform identifier" };
    }

    var regKey = norm.platform.toLowerCase();
    var registered = PLATFORM_REGISTRY[regKey];
    if (!registered) {
      return { ok: false, error: "Unrecognized platform: " + norm.platform };
    }

    // Only active platforms are permitted to sync
    if (!registered.active) {
      return { ok: false, error: "Platform is not yet active: " + norm.platform };
    }

    if (!norm.problem || typeof norm.problem !== "object") {
      return { ok: false, error: "Missing problem metadata" };
    }

    if (!norm.problem.slug || norm.problem.slug.length > 200) {
      return { ok: false, error: "Invalid problem slug" };
    }

    if (!norm.problem.title || norm.problem.title.length > 300) {
      return { ok: false, error: "Invalid problem title" };
    }

    if (!norm.submission || typeof norm.submission !== "object") {
      return { ok: false, error: "Missing submission details" };
    }

    if (!norm.submission.id || norm.submission.id.length > 100) {
      return { ok: false, error: "Invalid submission ID" };
    }

    if (norm.submission.status !== "Accepted") {
      return { ok: false, error: "Submission status is not Accepted" };
    }

    if (!norm.submission.language || norm.submission.language.length > 50 || norm.submission.language.toLowerCase() === "unknown") {
      return { ok: false, error: "Invalid or unknown language identifier" };
    }

    if (!norm.submission.code || typeof norm.submission.code !== "string") {
      return { ok: false, error: "Submission code is empty" };
    }

    if (norm.submission.code.length > 200000) {
      return { ok: false, error: "Submission code exceeds maximum permitted length" };
    }

    return { ok: true, normalized: norm };
  }

  var exportsObj = {
    PLATFORM_REGISTRY: PLATFORM_REGISTRY,
    sanitizePathSegment: sanitizePathSegment,
    getCanonicalPlatformFolder: getCanonicalPlatformFolder,
    getActivePlatforms: getActivePlatforms,
    buildPlatformReadmePath: buildPlatformReadmePath,
    buildPlatformReadme: buildPlatformReadme,
    buildCanonicalFolderPath: buildCanonicalFolderPath,
    normalizeSubmission: normalizeSubmission,
    validateNormalizedSubmission: validateNormalizedSubmission,
  };

  // Export for service worker (importScripts), browser globals, and Node testing
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitPlatforms = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
