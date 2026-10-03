// Fly2Git — Centralized Advanced Automation Rule Engine (Phase 14A)
//
// Governs Pro automation capabilities:
// 1. Commit message templates with strict sanitization and safe placeholders
// 2. Custom path / folder organization templates with canonical path safety
// 3. Submission filters (difficulty, language, platform toggles)
// 4. Per-platform automation controls (autoSync, autoReadme)
// 5. Workflow presets (Balanced, Clean Portfolio, Polyglot Archive)
//
// INVARIANT: Automation rules are executed ONLY after Platform Identity Guard,
// Entitlement, and Platform Allocation boundary checks have passed.
// Basic users NEVER gain access to custom automation behaviors.

(function (root) {
  "use strict";

  const AUTOMATION_STORAGE_KEY = "fly2git_automation_settings";

  const DEFAULT_COMMIT_TEMPLATE = "{action}: {problemTitle} ({difficulty})";
  const DEFAULT_PATH_TEMPLATE = "{platform}/{difficulty}/{slug}";

  const PRESETS = Object.freeze({
    balanced: Object.freeze({
      id: "balanced",
      name: "Balanced (Default)",
      description: "Standard clean commits and difficulty-based directory organization.",
      commitTemplate: "{action}: {problemTitle} ({difficulty})",
      pathTemplate: "{platform}/{difficulty}/{slug}",
      excludedDifficulties: [],
      languageMode: "all",
      languages: [],
    }),
    portfolio: Object.freeze({
      id: "portfolio",
      name: "Clean Portfolio",
      description: "Conventional commits, difficulty grouping, and skips Easy warm-up problems.",
      commitTemplate: "feat({platform}): solve {problemTitle} [{difficulty}]",
      pathTemplate: "{platform}/{difficulty}/{slug}",
      excludedDifficulties: ["Easy"],
      languageMode: "all",
      languages: [],
    }),
    polyglot: Object.freeze({
      id: "polyglot",
      name: "Polyglot Archive",
      description: "Language-nested folders for multi-language practice.",
      commitTemplate: "{action}: {problemTitle} in {language} ({difficulty})",
      pathTemplate: "{platform}/{slug}/{language}",
      excludedDifficulties: [],
      languageMode: "all",
      languages: [],
    }),
  });

  const DEFAULT_AUTOMATION_SETTINGS = Object.freeze({
    enabled: true,
    preset: "balanced",
    commitMessage: Object.freeze({
      template: DEFAULT_COMMIT_TEMPLATE,
    }),
    pathOrganization: Object.freeze({
      template: DEFAULT_PATH_TEMPLATE,
    }),
    filters: Object.freeze({
      excludedDifficulties: Object.freeze([]),
      languageMode: "all", // "all" | "include" | "exclude"
      languages: Object.freeze([]),
    }),
    perPlatform: Object.freeze({}),
    retryPolicy: Object.freeze({
      maxRetries: 1, // bounded: 0, 1, or 2
    }),
  });

  const SAFE_COMMIT_PLACEHOLDERS = Object.freeze([
    "{platform}",
    "{problemTitle}",
    "{difficulty}",
    "{language}",
    "{submissionId}",
    "{action}",
    "{slug}",
  ]);

  const SAFE_PATH_PLACEHOLDERS = Object.freeze([
    "{platform}",
    "{difficulty}",
    "{slug}",
    "{language}",
  ]);

  /**
   * Sanitizes a string for use in git commit subjects.
   * Strips newlines, control characters, and clamps length to 150.
   */
  function sanitizeCommitText(text, maxLen = 150) {
    if (!text || typeof text !== "string") return "";
    return text
      .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
  }

  /**
   * Validates and sanitizes a complete AutomationSettings object.
   * Fails closed to safe defaults on any malformed or tampered inputs.
   */
  function validateSettings(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return cloneSettings(DEFAULT_AUTOMATION_SETTINGS);
    }

    const enabled = raw.enabled !== false;
    let preset = typeof raw.preset === "string" ? raw.preset.toLowerCase() : "custom";
    if (!PRESETS[preset] && preset !== "custom") {
      preset = "balanced";
    }

    // Commit Message Template
    let commitTemplate = DEFAULT_COMMIT_TEMPLATE;
    if (
      raw.commitMessage &&
      typeof raw.commitMessage.template === "string" &&
      raw.commitMessage.template.trim().length > 0
    ) {
      const sanitized = sanitizeCommitText(raw.commitMessage.template, 200);
      if (sanitized.length > 0) {
        commitTemplate = sanitized;
      }
    }

    // Path Template
    let pathTemplate = DEFAULT_PATH_TEMPLATE;
    if (
      raw.pathOrganization &&
      typeof raw.pathOrganization.template === "string" &&
      raw.pathOrganization.template.trim().length > 0
    ) {
      const pCandidate = raw.pathOrganization.template.trim();
      // Ensure candidate only uses safe placeholders and doesn't contain path traversal
      if (!pCandidate.includes("..") && !pCandidate.startsWith("/")) {
        pathTemplate = pCandidate;
      }
    }

    // Filters
    const filters = {
      excludedDifficulties: [],
      languageMode: "all",
      languages: [],
    };

    if (raw.filters && typeof raw.filters === "object") {
      if (Array.isArray(raw.filters.excludedDifficulties)) {
        filters.excludedDifficulties = raw.filters.excludedDifficulties
          .filter((d) => typeof d === "string")
          .map((d) => d.trim())
          .filter((d) => d.length > 0 && d.length <= 30);
      }

      if (["all", "include", "exclude"].includes(raw.filters.languageMode)) {
        filters.languageMode = raw.filters.languageMode;
      }

      if (Array.isArray(raw.filters.languages)) {
        filters.languages = raw.filters.languages
          .filter((l) => typeof l === "string")
          .map((l) => l.trim().toLowerCase())
          .filter((l) => l.length > 0 && l.length <= 30);
      }
    }

    // Per-Platform settings
    const perPlatform = {};
    if (raw.perPlatform && typeof raw.perPlatform === "object" && !Array.isArray(raw.perPlatform)) {
      const validPlatforms = [
        "leetcode",
        "geeksforgeeks",
        "hackerrank",
        "codechef",
        "atcoder",
        "codeforces",
        "spoj",
      ];

      for (const p of Object.keys(raw.perPlatform)) {
        const normP = p.toLowerCase().trim();
        if (validPlatforms.includes(normP) && typeof raw.perPlatform[p] === "object") {
          perPlatform[normP] = {
            autoSync: raw.perPlatform[p].autoSync !== false,
            autoReadme: raw.perPlatform[p].autoReadme !== false,
          };
        }
      }
    }

    // Retry policy
    let maxRetries = 1;
    if (raw.retryPolicy && typeof raw.retryPolicy.maxRetries === "number") {
      maxRetries = Math.max(0, Math.min(2, Math.floor(raw.retryPolicy.maxRetries)));
    }

    return {
      enabled,
      preset,
      commitMessage: {
        template: commitTemplate,
      },
      pathOrganization: {
        template: pathTemplate,
      },
      filters,
      perPlatform,
      retryPolicy: {
        maxRetries,
      },
    };
  }

  function cloneSettings(s) {
    return JSON.parse(JSON.stringify(s));
  }

  /**
   * Applies a predefined workflow preset.
   */
  function applyPreset(presetId) {
    const p = PRESETS[presetId];
    if (!p) return cloneSettings(DEFAULT_AUTOMATION_SETTINGS);

    return {
      enabled: true,
      preset: p.id,
      commitMessage: {
        template: p.commitTemplate,
      },
      pathOrganization: {
        template: p.pathTemplate,
      },
      filters: {
        excludedDifficulties: [...p.excludedDifficulties],
        languageMode: p.languageMode,
        languages: [...p.languages],
      },
      perPlatform: {},
      retryPolicy: {
        maxRetries: 1,
      },
    };
  }

  /**
   * Renders a custom commit message subject using safe placeholders.
   * @param {string} template - The template string
   * @param {object} context - Submission context { platform, title, difficulty, language, submissionId, isUpdate, slug }
   * @returns {string} Sanitized commit subject
   */
  function renderCommitMessage(template, context = {}) {
    const rawTemplate =
      typeof template === "string" && template.trim().length > 0
        ? template.trim()
        : DEFAULT_COMMIT_TEMPLATE;

    const action = context.isUpdate ? "Update" : "Add";
    const platform = sanitizeCommitText(context.platform || "Platform", 40);
    const problemTitle = sanitizeCommitText(context.title || "Solution", 80);
    const difficulty = sanitizeCommitText(context.difficulty || "Unknown", 30);
    const language = sanitizeCommitText(context.language || context.lang || "code", 20);
    const submissionId = sanitizeCommitText(String(context.submissionId || ""), 40);
    const slug = sanitizeCommitText(context.slug || "", 60);

    let rendered = rawTemplate
      .replace(/{action}/g, action)
      .replace(/{platform}/g, platform)
      .replace(/{problemTitle}/g, problemTitle)
      .replace(/{difficulty}/g, difficulty)
      .replace(/{language}/g, language)
      .replace(/{submissionId}/g, submissionId)
      .replace(/{slug}/g, slug);

    // Sanitize any remaining unreplaced braces or dangerous chars
    rendered = sanitizeCommitText(rendered, 150);

    // If somehow blank, fallback to canonical format
    if (!rendered || rendered.length === 0) {
      rendered = `${action}: ${problemTitle} (${difficulty})`;
    }

    return rendered;
  }

  /**
   * Renders and strictly validates a canonical solution path.
   * Enforces:
   * - No path traversal (rejects '..', leading slashes)
   * - Normalized separators (converts '\' to '/')
   * - Rejects '.git' anywhere in the path
   * - Whitelisted characters only
   * - Appends standard solution.<ext>
   * @param {string} template - Path template
   * @param {object} context - { platform, platformFolder, difficulty, slug, language }
   * @param {string} ext - Valid language file extension
   * @returns {object} { folder: string, solutionPath: string, readmePath: string }
   */
  function renderSolutionPath(template, context = {}, ext = "txt") {
    const rawTemplate =
      typeof template === "string" && template.trim().length > 0
        ? template.trim()
        : DEFAULT_PATH_TEMPLATE;

    const platform = sanitizePathSegment(context.platformFolder || context.platform || "Other");
    const difficulty = sanitizePathSegment(context.difficulty || "Unknown");
    const slug = sanitizePathSegment(context.slug || "problem");
    const language = sanitizePathSegment(context.language || context.lang || "code");

    let rendered = rawTemplate
      .replace(/{platform}/g, platform)
      .replace(/{difficulty}/g, difficulty)
      .replace(/{slug}/g, slug)
      .replace(/{language}/g, language);

    // Canonical Path Sanitization
    // Normalize slashes
    rendered = rendered.replace(/\\/g, "/");

    // Split and filter segments
    const rawSegments = rendered.split("/");
    const cleanSegments = [];

    for (let seg of rawSegments) {
      seg = seg.trim();
      // Drop empty, current dir, and traversal
      if (!seg || seg === "." || seg === "..") continue;
      // Strip dangerous characters
      const sanitized = sanitizePathSegment(seg);
      // Reject .git folder injections
      if (sanitized.toLowerCase() === ".git" || sanitized.toLowerCase().startsWith(".git")) {
        continue;
      }
      if (sanitized.length > 0) {
        cleanSegments.push(sanitized.slice(0, 80));
      }
    }

    // Must have at least a platform segment
    if (cleanSegments.length === 0) {
      cleanSegments.push(platform, difficulty, slug);
    }

    const folder = cleanSegments.join("/");
    const safeExt = String(ext || "txt").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "txt";

    return {
      folder,
      solutionPath: `${folder}/solution.${safeExt}`,
      readmePath: `${folder}/README.md`,
    };
  }

  /**
   * Sanitizes an individual path component.
   * Allows only safe alphanumeric characters, underscores, hyphens, and spaces.
   */
  function sanitizePathSegment(seg) {
    if (!seg || typeof seg !== "string") return "unknown";
    const cleaned = seg
      .replace(/[^a-zA-Z0-9_\-\.\ ]/g, "_")
      .replace(/_{2,}/g, "_")
      .trim();
    return cleaned.length > 0 ? cleaned : "unknown";
  }

  /**
   * Evaluates automation filters to determine whether a submission should be synced.
   * If filtered, returns { allow: false, reason: string, code: "FILTER" }.
   * Skipping a filtered submission is NEVER a sync failure.
   */
  function shouldSyncSubmission(settings, submissionContext = {}) {
    const valid = validateSettings(settings);

    // If automation is disabled globally, allow standard sync
    if (!valid.enabled) {
      return { allow: true };
    }

    const { platform, difficulty, language, lang } = submissionContext;
    const currentLang = String(language || lang || "").trim().toLowerCase();
    const currentDiff = String(difficulty || "").trim();
    const currentPlat = String(platform || "").trim().toLowerCase();

    // 1. Per-Platform Auto-Sync Check
    if (valid.perPlatform[currentPlat] && valid.perPlatform[currentPlat].autoSync === false) {
      return {
        allow: false,
        type: "PLATFORM_DISABLED",
        reason: `Auto-sync is disabled for ${platform} in Advanced Automation settings`,
      };
    }

    // 2. Difficulty Filter Check
    if (currentDiff && Array.isArray(valid.filters.excludedDifficulties)) {
      const isExcluded = valid.filters.excludedDifficulties.some(
        (ex) => ex.toLowerCase() === currentDiff.toLowerCase()
      );
      if (isExcluded) {
        return {
          allow: false,
          type: "DIFFICULTY_FILTERED",
          reason: `Filtered by difficulty rule: ${currentDiff} problems are excluded`,
        };
      }
    }

    // 3. Language Filter Check
    if (currentLang && valid.filters.languageMode !== "all") {
      const langList = Array.isArray(valid.filters.languages) ? valid.filters.languages : [];
      if (valid.filters.languageMode === "include") {
        if (!langList.includes(currentLang)) {
          return {
            allow: false,
            type: "LANGUAGE_FILTERED",
            reason: `Filtered by language rule: '${currentLang}' is not in included languages`,
          };
        }
      } else if (valid.filters.languageMode === "exclude") {
        if (langList.includes(currentLang)) {
          return {
            allow: false,
            type: "LANGUAGE_FILTERED",
            reason: `Filtered by language rule: '${currentLang}' is in excluded languages`,
          };
        }
      }
    }

    return { allow: true };
  }

  /**
   * Checks whether platform README generation should run for this platform.
   */
  function shouldGeneratePlatformReadme(settings, platform) {
    const valid = validateSettings(settings);
    if (!valid.enabled) return true;
    const normP = String(platform || "").trim().toLowerCase();
    if (valid.perPlatform[normP] && valid.perPlatform[normP].autoReadme === false) {
      return false;
    }
    return true;
  }

  /**
   * Retrieves automation settings from chrome.storage.local, safely validating on read.
   */
  async function getStoredAutomationSettings() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const data = await chrome.storage.local.get(AUTOMATION_STORAGE_KEY);
        if (data && data[AUTOMATION_STORAGE_KEY]) {
          return validateSettings(data[AUTOMATION_STORAGE_KEY]);
        }
      } catch (err) {
        console.warn("[Fly2Git][Automation] Error reading automation settings:", err);
      }
    }
    return cloneSettings(DEFAULT_AUTOMATION_SETTINGS);
  }

  /**
   * Saves automation settings to chrome.storage.local.
   */
  async function saveStoredAutomationSettings(settings) {
    const valid = validateSettings(settings);
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [AUTOMATION_STORAGE_KEY]: valid });
    }
    return valid;
  }

  const exportsObj = {
    AUTOMATION_STORAGE_KEY,
    DEFAULT_COMMIT_TEMPLATE,
    DEFAULT_PATH_TEMPLATE,
    DEFAULT_AUTOMATION_SETTINGS,
    PRESETS,
    SAFE_COMMIT_PLACEHOLDERS,
    SAFE_PATH_PLACEHOLDERS,
    validateSettings,
    applyPreset,
    renderCommitMessage,
    renderSolutionPath,
    sanitizeCommitText,
    sanitizePathSegment,
    shouldSyncSubmission,
    shouldGeneratePlatformReadme,
    getStoredAutomationSettings,
    saveStoredAutomationSettings,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitAutomation = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
