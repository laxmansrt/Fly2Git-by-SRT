// Fly2Git Backend — Privacy Guard (Phase 15A)
// Enforces:
// 1. Input bounds (code size, prompt size, metadata limits)
// 2. Control character normalization
// 3. High-confidence secret redaction before logging or diagnostics
// 4. Source code isolation: NEVER writes solution source code to server logs or analytics

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  // GitHub Personal Access Tokens & OAuth Tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
  // OpenAI Secret Keys
  /\bsk-[A-Za-z0-9_-]{20,255}\b/g,
  // Google / Gemini API Keys
  /\bAIzaSy[A-Za-z0-9_-]{33}\b/g,
  // Asymmetric Private Keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Generic Bearer Tokens
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Password / Secret in JSON or Query
  /(["']?(?:password|passwd|secret|api_key|apikey|token)["']?\s*[:=]\s*["'])([^"'\r\n]{4,})(['"])/gi,
];

class PrivacyGuard {
  /**
   * Sanitizes request payload according to configured limits.
   * Throws structured error if limits are exceeded.
   *
   * @param {object} request - Unsanitized request
   * @param {object} limits - Configured constraints
   * @returns {object} Sanitized request object
   */
  static sanitizeRequest(request, limits = {}) {
    if (!request || typeof request !== "object") {
      const err = new Error("Invalid request body");
      err.code = "AI_INVALID_REQUEST";
      err.statusCode = 400;
      throw err;
    }

    const maxInputChars = limits.maxInputChars || 30000;
    const maxPromptChars = limits.maxPromptChars || 5000;

    const code = typeof request.code === "string" ? request.code : "";
    const userQuestion = typeof request.userQuestion === "string" ? request.userQuestion : "";
    const errorContext = typeof request.errorContext === "string" ? request.errorContext : "";

    if (code.length > maxInputChars) {
      const err = new Error(`Code length (${code.length}) exceeds maximum limit (${maxInputChars} characters)`);
      err.code = "AI_INPUT_TOO_LARGE";
      err.statusCode = 400;
      throw err;
    }

    if (userQuestion.length > maxPromptChars) {
      const err = new Error(`Prompt length (${userQuestion.length}) exceeds maximum limit (${maxPromptChars} characters)`);
      err.code = "AI_INPUT_TOO_LARGE";
      err.statusCode = 400;
      throw err;
    }

    // Strip unprintable control characters (preserving \n, \r, \t)
    const cleanCode = code.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    const cleanQuestion = userQuestion.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    const cleanError = errorContext.slice(0, 4000).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    const problem = request.problem && typeof request.problem === "object" ? request.problem : {};

    return {
      feature: typeof request.feature === "string" ? request.feature.trim().toLowerCase() : "",
      platform: typeof request.platform === "string" ? request.platform.trim().toLowerCase().slice(0, 50) : "unknown",
      problem: {
        slug: typeof problem.slug === "string" ? problem.slug.trim().slice(0, 200) : "unknown",
        title: typeof problem.title === "string" ? problem.title.trim().slice(0, 300) : "Untitled",
        difficulty: typeof problem.difficulty === "string" ? problem.difficulty.trim().slice(0, 50) : "Unknown",
        url: typeof problem.url === "string" ? problem.url.trim().slice(0, 500) : "",
      },
      code: cleanCode,
      language: typeof request.language === "string" ? request.language.trim().toLowerCase().slice(0, 50) : "unknown",
      errorContext: cleanError,
      userQuestion: cleanQuestion,
      metadata: request.metadata && typeof request.metadata === "object" ? request.metadata : {},
      mode: typeof request.mode === "string" ? request.mode.trim().slice(0, 50) : undefined,
      coachContext: request.coachContext && typeof request.coachContext === "object" ? request.coachContext : undefined,
      observations: Array.isArray(request.observations) ? request.observations : undefined,
      balance: request.balance && typeof request.balance === "object" ? request.balance : undefined,
      derivedContext: request.derivedContext && typeof request.derivedContext === "object" ? request.derivedContext : undefined,
      currentProblem: request.currentProblem && typeof request.currentProblem === "object" ? request.currentProblem : undefined,
    };
  }

  /**
   * Redacts sensitive secrets from a string prior to logging or recording diagnostics.
   * NEVER logs source code or full prompts.
   *
   * @param {string} text - Raw log candidate
   * @returns {string} Redacted log text
   */
  static redactSecretsForLogging(text) {
    if (typeof text !== "string") return "";
    let sanitized = text;

    for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, (...args) => {
        if (typeof args[1] === "string" && typeof args[2] === "string" && typeof args[3] === "string") {
          return `${args[1]}[REDACTED_SECRET]${args[3]}`;
        }
        return "[REDACTED_SECRET]";
      });
    }

    return sanitized;
  }

  /**
   * Generates a safe audit log entry for an AI request without source code.
   *
   * @param {object} req - Request metadata
   * @returns {object} Safe audit object
   */
  static createSafeAuditLog(req) {
    return {
      requestId: req.requestId,
      userId: req.userId,
      feature: req.feature,
      platform: req.platform,
      problemSlug: req.problem && req.problem.slug,
      language: req.language,
      codeLength: (req.code || "").length,
      hasPrompt: Boolean(req.userQuestion),
      timestamp: Date.now(),
    };
  }
}

module.exports = PrivacyGuard;
