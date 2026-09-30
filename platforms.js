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
      active: false,
      allowedDifficulties: Object.freeze(["Unknown"]),
    }),
    atcoder: Object.freeze({
      id: "atcoder",
      name: "AtCoder",
      origin: "https://atcoder.jp",
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
   * Constructs a safe canonical GitHub folder path:
   * <Platform>/<Difficulty>/<Problem>/
   */
  function buildCanonicalFolderPath(platformName, difficulty, problemIdentifier) {
    var safePlatform = sanitizePathSegment(platformName, "LeetCode", 50);
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
      return {
        platform: raw.platform || "LeetCode",
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
        },
        metadata: {
          timestamp: typeof raw.metadata?.timestamp === "number" ? raw.metadata.timestamp : Date.now(),
        },
      };
    }

    // Case 2: Legacy flat LeetCode payload: { slug, title, difficulty, code, lang, url, submissionId }
    return {
      platform: "LeetCode",
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
