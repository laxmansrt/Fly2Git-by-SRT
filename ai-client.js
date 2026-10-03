// Fly2Git — Extension AI Client Wrapper (Phase 15A & 15B)
// Universal module for Browser (Extension background/popup) and Node.js (tests).
// Communicates ONLY with Fly2Git Backend: POST /api/ai/generate
// NEVER connects to Gemini, OpenAI, or other providers directly.
// NEVER stores, receives, or exposes provider API keys or secrets.
// Enforces safe bounded retries on transient network/provider failures only.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitAIClient = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 25000;
  const NON_RETRYABLE_CODES = [
    "AI_UNAUTHORIZED",
    "AI_FORBIDDEN",
    "AI_LIMIT_REACHED",
    "AI_INVALID_REQUEST",
    "AI_INPUT_TOO_LARGE",
  ];

  /**
   * Creates an initial idle AI state object.
   * @param {string} [feature]
   * @returns {object} Normalized frontend state
   */
  function createInitialState(feature = "analyze") {
    return {
      status: "idle",
      feature,
      requestId: null,
      answer: null,
      errorCode: null,
      errorMessage: null,
      timestamp: Date.now(),
    };
  }

  /**
   * Helper to get backend base URL from FLY2GIT_CONFIG or default.
   */
  function getBackendBaseUrl() {
    if (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_API_URL) {
      return FLY2GIT_CONFIG.BACKEND_API_URL;
    }
    if (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) {
      return FLY2GIT_CONFIG.BACKEND_URL;
    }
    return "https://api.fly2git.com";
  }

  /**
   * Internal helper to resolve auth token from options or chrome.storage.local.
   */
  async function getToken() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const { userSession, auth, fly2git_session } = await chrome.storage.local.get([
          "userSession",
          "auth",
          "fly2git_session",
        ]);
        if (userSession && userSession.token) return userSession.token;
        if (auth && auth.fly2gitToken) return auth.fly2gitToken;
        if (fly2git_session && fly2git_session.token) return fly2git_session.token;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Internal single execution of /api/ai/generate.
   */
  async function executeSingleAttempt(payload, options, token, backendBase, timeoutMs) {
    const feature = (payload && payload.feature) || "analyze";
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(`${backendBase}/api/ai/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || (!data.ok && !data.success)) {
        const errorCode = (data && data.code) || `HTTP_${response.status}`;
        const errorMessage = (data && data.error) || "AI generation failed. Please try again.";
        return {
          status: "error",
          feature,
          requestId: (data && data.requestId) || null,
          answer: null,
          errorCode,
          errorMessage,
          timestamp: Date.now(),
        };
      }

      return {
        status: "success",
        feature: data.feature || feature,
        requestId: data.requestId,
        answer: data.answer,
        provider: data.provider,
        model: data.model,
        usage: data.usage,
        errorCode: null,
        errorMessage: null,
        timestamp: Date.now(),
      };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);

      const isTimeout = err && (err.name === "AbortError" || err.code === "ABORT_ERR");
      const errorCode = isTimeout ? "AI_TIMEOUT" : "AI_OFFLINE";
      const errorMessage = isTimeout
        ? "AI request timed out. Please try again."
        : "Fly2Git AI backend unreachable. Check your internet connection.";

      return {
        status: "error",
        feature,
        requestId: null,
        answer: null,
        errorCode,
        errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Generates AI assistance by sending request to the Fly2Git Backend Gateway.
   * Automatically retries once on safe transient failures (network / timeout / provider 502).
   * Never retries 401, 403, 400, or 429 quota exhaustion.
   *
   * @param {object} payload - Request payload
   * @param {string} payload.feature - "analyze" | "explain" | "hint" | "assistant"
   * @param {string} [payload.platform] - e.g. "leetcode"
   * @param {object} [payload.problem] - { slug, title, difficulty, url }
   * @param {string} [payload.code] - Solution source code
   * @param {string} [payload.language] - e.g. "python3"
   * @param {string} [payload.errorContext] - Optional error string
   * @param {string} [payload.userQuestion] - User prompt
   * @param {object} [options]
   * @param {string} [options.token] - Explicit JWT token override (for Node tests)
   * @param {string} [options.backendUrl] - Explicit backend URL override (for tests)
   * @param {number} [options.timeoutMs] - Request timeout in milliseconds
   * @param {boolean} [options.retry] - Whether to allow safe retry (default: true)
   * @param {number} [options.maxRetries] - Maximum retry attempts (default: 1)
   * @returns {Promise<object>} Normalized state object with status "success" or "error"
   */
  async function generate(payload, options = {}) {
    const feature = (payload && payload.feature) || "analyze";
    const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const backendBase = options.backendUrl || getBackendBaseUrl();
    const allowRetry = options.retry !== false;
    const maxRetries = typeof options.maxRetries === "number" ? options.maxRetries : 1;

    // 1. Resolve authentication token
    let token = options.token || null;
    if (!token && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const { userSession } = await chrome.storage.local.get("userSession");
        if (userSession && userSession.token) {
          token = userSession.token;
        }
      } catch (_) {}
    }

    if (!token) {
      return {
        status: "error",
        feature,
        requestId: null,
        answer: null,
        errorCode: "AI_UNAUTHORIZED",
        errorMessage: "Please sign in to Fly2Git to use AI features.",
        timestamp: Date.now(),
      };
    }

    // 2. Initial Attempt
    let result = await executeSingleAttempt(payload, options, token, backendBase, timeoutMs);

    // 3. Safe Bounded Retry (Transient errors only)
    if (result.status === "error" && allowRetry && maxRetries > 0) {
      const isNonRetryable = NON_RETRYABLE_CODES.includes(result.errorCode);
      if (!isNonRetryable) {
        // Safe transient failure: wait short backoff and retry once
        await new Promise((r) => setTimeout(r, 400));
        result = await executeSingleAttempt(payload, options, token, backendBase, timeoutMs);
      }
    }

    return result;
  }

  /**
   * Helper: Runs AI Analyze on the given problem and code.
   */
  async function analyze(problem, code, language, options = {}) {
    return generate({ feature: "analyze", problem, code, language, ...options.payload }, options);
  }

  /**
   * Helper: Runs AI Explain on the given problem and code.
   */
  async function explain(problem, code, language, options = {}) {
    return generate({ feature: "explain", problem, code, language, ...options.payload }, options);
  }

  /**
   * Helper: Runs AI Hint with a specific hint level (1-4).
   */
  async function hint(problem, code, language, hintLevel = 1, options = {}) {
    const metadata = { ...(options.metadata || {}), hintLevel };
    return generate(
      { feature: "hint", problem, code, language, metadata, hintLevel, ...options.payload },
      options
    );
  }

  /**
   * Helper: Runs Personal Coding Coach with a specific mode.
   *
   * @param {string} [mode="daily"] - "daily" | "weekly" | "balance" | "portfolio" | "reflection"
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function coach(mode = "daily", options = {}) {
    const backendUrl =
      options.backendUrl ||
      (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl
        ? Fly2GitConfig.backendUrl
        : getBackendBaseUrl());
    const token = options.token || (await getToken());

    if (!token) {
      return {
        status: "error",
        feature: "coach",
        requestId: null,
        answer: null,
        errorCode: "AI_UNAUTHORIZED",
        errorMessage: "Authentication required for Personal Coding Coach.",
        timestamp: Date.now(),
      };
    }

    try {
      const response = await fetch(`${backendUrl}/api/coach/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode, ...options.payload }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || !data.ok) {
        return {
          status: "error",
          feature: "coach",
          requestId: (data && data.requestId) || null,
          answer: null,
          errorCode: (data && data.code) || `HTTP_${response.status}`,
          errorMessage: (data && data.error) || "Coaching generation failed.",
          timestamp: Date.now(),
        };
      }

      return {
        status: "success",
        feature: "coach",
        mode: data.mode,
        summary: data.summary,
        observations: data.observations,
        suggestedDirection: data.suggestedDirection,
        suggestedActions: data.suggestedActions,
        reflectionQuestion: data.reflectionQuestion,
        evidence: data.evidence,
        confidence: data.confidence,
        context: data.context,
        balance: data.balance,
        requestId: data.requestId,
        usage: data.usage,
        errorCode: null,
        errorMessage: null,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        status: "error",
        feature: "coach",
        requestId: null,
        answer: null,
        errorCode: "AI_OFFLINE",
        errorMessage: "Fly2Git backend unreachable.",
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Helper: Retrieves Coding Intelligence pattern activity.
   *
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function getIntelligencePatterns(options = {}) {
    const backendUrl =
      options.backendUrl ||
      (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl
        ? Fly2GitConfig.backendUrl
        : getBackendBaseUrl());
    const token = options.token || (await getToken());
    const range = options.range ? `?range=${encodeURIComponent(options.range)}` : "";

    try {
      const response = await fetch(`${backendUrl}/api/intelligence/patterns${range}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await response.json().catch(() => null);
      return data || { ok: false, error: "Failed to fetch patterns" };
    } catch (err) {
      return { ok: false, error: "Network error fetching patterns" };
    }
  }

  /**
   * Helper: Retrieves Coding Journey timeline.
   *
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function getIntelligenceJourney(options = {}) {
    const backendUrl =
      options.backendUrl ||
      (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl
        ? Fly2GitConfig.backendUrl
        : getBackendBaseUrl());
    const token = options.token || (await getToken());
    const query = new URLSearchParams();
    if (options.range) query.set("range", options.range);
    if (options.tz !== undefined) query.set("tz", options.tz);
    const qs = query.toString() ? `?${query.toString()}` : "";

    try {
      const response = await fetch(`${backendUrl}/api/intelligence/journey${qs}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await response.json().catch(() => null);
      return data || { ok: false, error: "Failed to fetch journey" };
    } catch (err) {
      return { ok: false, error: "Network error fetching journey" };
    }
  }

  /**
   * Helper: Retrieves contextual personal history for current problem.
   *
   * @param {object} problemInput
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function getProblemContext(problemInput, options = {}) {
    const backendUrl =
      options.backendUrl ||
      (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl
        ? Fly2GitConfig.backendUrl
        : getBackendBaseUrl());
    const token = options.token || (await getToken());

    try {
      const response = await fetch(`${backendUrl}/api/intelligence/problem-context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(problemInput || {}),
      });
      const data = await response.json().catch(() => null);
      return data || { ok: false, error: "Failed to fetch problem context" };
    } catch (err) {
      return { ok: false, error: "Network error fetching problem context" };
    }
  }

  /**
   * Helper: Explains intelligence patterns with AI grounding.
   *
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function explainIntelligence(options = {}) {
    const backendUrl =
      options.backendUrl ||
      (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl
        ? Fly2GitConfig.backendUrl
        : getBackendBaseUrl());
    const token = options.token || (await getToken());

    try {
      const response = await fetch(`${backendUrl}/api/intelligence/explain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(options.payload || {}),
      });
      const data = await response.json().catch(() => null);
      return data || { ok: false, error: "Failed to explain intelligence" };
    } catch (err) {
      return { ok: false, error: "Network error explaining intelligence" };
    }
  }

  return {
    createInitialState,
    generate,
    analyze,
    explain,
    hint,
    coach,
    getIntelligencePatterns,
    getIntelligenceJourney,
    getProblemContext,
    explainIntelligence,
    DEFAULT_TIMEOUT_MS,
    NON_RETRYABLE_CODES,
  };
});
