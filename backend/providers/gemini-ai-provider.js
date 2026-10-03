// Fly2Git Backend — Gemini AI Provider Adapter (Phase 15B)
// Official Google Gemini REST API implementation behind AIProvider abstraction.
// Security:
// - API key is strictly server-side (from environment/config).
// - NEVER exposes API keys in URLs (uses x-goog-api-key header).
// - NEVER logs provider credentials or raw responses with source code.
// - Fails safely with AI_PROVIDER_UNAVAILABLE if key is absent.

const AIProvider = require("./ai-provider");
const { getPrompt } = require("../ai/prompts");
const { validate } = require("../ai/validators");

class GeminiAIProvider extends AIProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] - Explicit API key (defaults to GEMINI_API_KEY)
   * @param {string} [options.model] - Model name (defaults to GEMINI_MODEL or gemini-1.5-flash)
   * @param {object} [options.config] - Backend config object
   * @param {Function} [options.fetch] - Injectable fetch client (defaults to global fetch)
   * @param {number} [options.timeoutMs] - Request timeout (default 30000ms)
   */
  constructor(options = {}) {
    super("gemini");
    const cfg = options.config && options.config.ai;
    this.apiKey =
      options.apiKey ||
      (cfg && cfg.geminiApiKey) ||
      process.env.GEMINI_API_KEY ||
      null;
    this.model =
      options.model ||
      (cfg && cfg.geminiModel) ||
      process.env.GEMINI_MODEL ||
      "gemini-1.5-flash";
    this.fetchFn = options.fetch || (typeof fetch !== "undefined" ? fetch : null);
    this.timeoutMs = options.timeoutMs || 30000;
  }

  /**
   * Generates structured AI output for a request using the Gemini API.
   *
   * @param {object} request - Normalized request payload from AI Gateway
   * @returns {Promise<{ answer: object|string, provider: string, model: string, usage: object }>}
   */
  async generate(request = {}) {
    // 1. Validate API Key Existence
    if (!this.apiKey || typeof this.apiKey !== "string" || !this.apiKey.trim()) {
      const err = new Error("Gemini AI provider is not configured with an API key on this server instance");
      err.code = "AI_PROVIDER_UNAVAILABLE";
      err.statusCode = 502;
      throw err;
    }

    if (!this.fetchFn) {
      const err = new Error("Fetch runtime not available for Gemini HTTP requests");
      err.code = "AI_PROVIDER_UNAVAILABLE";
      err.statusCode = 502;
      throw err;
    }

    // 2. Build Structured Prompts with Injection Defense
    const { systemInstruction, userPrompt } = getPrompt(request.feature, request);

    // 3. Prepare Gemini API Request
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    };

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    let response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey, // Header-only key transmission: never in URL query string
        },
        body: JSON.stringify(requestBody),
        signal: controller ? controller.signal : undefined,
      });
    } catch (netErr) {
      if (timeoutId) clearTimeout(timeoutId);
      const isTimeout = netErr && (netErr.name === "AbortError" || netErr.code === "ABORT_ERR");
      const err = new Error(
        isTimeout
          ? "Gemini AI provider request timed out. Please retry shortly."
          : "Network communication with Gemini AI provider failed."
      );
      err.code = "AI_PROVIDER_UNAVAILABLE";
      err.statusCode = 502;
      throw err;
    }

    if (timeoutId) clearTimeout(timeoutId);

    // 4. Handle Non-200 HTTP Responses Safely (Zero Credential Leakage)
    if (!response.ok) {
      const err = new Error(`Gemini AI provider returned error status (${response.status})`);
      err.code = "AI_PROVIDER_UNAVAILABLE";
      err.statusCode = 502;
      throw err;
    }

    // 5. Parse Response Content
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      const err = new Error("Failed to parse Gemini provider response as JSON");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    const candidate = data && data.candidates && data.candidates[0];
    const textPart =
      candidate &&
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts[0] &&
      candidate.content.parts[0].text;

    if (!textPart || typeof textPart !== "string") {
      const err = new Error("Gemini AI provider returned empty candidate output");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 6. Validate and Enforce Feature Schema
    let validatedAnswer;
    try {
      validatedAnswer = validate(request.feature, textPart, request);
    } catch (valErr) {
      // Re-throw with normalized code
      valErr.code = valErr.code || "AI_INVALID_RESPONSE";
      valErr.statusCode = valErr.statusCode || 502;
      throw valErr;
    }

    // 7. Token Usage Accounting
    const usageMetadata = (data && data.usageMetadata) || {};
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;
    const totalTokens = usageMetadata.totalTokenCount || inputTokens + outputTokens;

    return {
      answer: validatedAnswer,
      provider: "gemini",
      model: this.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
    };
  }
}

module.exports = GeminiAIProvider;
