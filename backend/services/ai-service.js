// Fly2Git Backend — Central AI Gateway / Service (Phase 15A)
// Provider-agnostic gateway orchestrating AI requests from the extension.
// Enforces:
// 1. Authoritative entitlement verification (Basic vs Pro vs Pro Grant)
// 2. Strict usage governance & server-side monthly quotas
// 3. Privacy guard: bounds enforcement, control char sanitization, zero code logging
// 4. Safe error normalization: provider secrets & internal stack traces never exposed
// 5. Pluggable provider abstraction (MockProvider default; Gemini/OpenAI pluggable)

const crypto = require("crypto");
const defaultAppConfig = require("../config");
const PrivacyGuard = require("./privacy-guard");
const MockAIProvider = require("../providers/mock-ai-provider");
const GeminiAIProvider = require("../providers/gemini-ai-provider");
const { validate } = require("../ai/validators");

const AI_FEATURES = Object.freeze([
  "assistant",
  "analyze",
  "explain",
  "hint",
  "coach",
  "coding_intelligence",
  "intelligence",
  "readme",
  "portfolio_insight",
]);

class AIService {
  /**
   * @param {object} database - Database instance
   * @param {object} entitlementService - Entitlement authority service
   * @param {object} usageService - AI usage governance service
   * @param {object} [options]
   * @param {object} [options.provider] - Pluggable AIProvider instance
   * @param {object} [options.config] - AI configuration override
   */
  constructor(database, entitlementService, usageService, options = {}) {
    this.db = database;
    this.entitlementService = entitlementService;
    this.usageService = usageService;
    this.config = (options.config && options.config.ai) || (defaultAppConfig && defaultAppConfig.ai) || {
      enabled: true,
      provider: "mock",
      geminiApiKey: null,
      geminiModel: "gemini-1.5-flash",
      maxInputChars: 30000,
      maxPromptChars: 5000,
      maxOutputTokens: 2048,
      monthlyBasicLimit: 5,
      monthlyProLimit: 200,
    };
    if (options.provider) {
      this.provider = options.provider;
    } else if (this.config.provider === "gemini") {
      this.provider = new GeminiAIProvider({ config: options.config || defaultAppConfig });
    } else {
      this.provider = new MockAIProvider();
    }
  }

  /**
   * Processes a normalized AI generation request.
   *
   * @param {string} userId - Authenticated user ID from session
   * @param {object} rawRequest - Client request payload
   * @returns {Promise<object>} Normalized AI response
   */
  async generate(userId, rawRequest) {
    // 1. Check AI service availability
    if (!this.config.enabled) {
      const err = new Error("AI service is currently disabled on this instance");
      err.code = "AI_DISABLED";
      err.statusCode = 503;
      throw err;
    }

    // 2. Validate authenticated user
    if (!userId || typeof userId !== "string") {
      const err = new Error("Authentication required for AI operations");
      err.code = "AI_UNAUTHORIZED";
      err.statusCode = 401;
      throw err;
    }

    // 3. Authoritative Entitlement Verification
    let ent;
    try {
      ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    } catch (_) {
      const err = new Error("Malformed or inaccessible user entitlement");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    if (!ent || typeof ent !== "object") {
      const err = new Error("Entitlement record missing");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    // Check expiration: fail closed
    const now = Date.now();
    if (ent.status === "expired" || (typeof ent.expiresAt === "number" && now > ent.expiresAt)) {
      const err = new Error("User entitlement has expired. Renew or activate subscription to use AI.");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    // Check validity of plan and signature (fail closed if malformed)
    if (ent.plan !== "pro" && ent.plan !== "basic") {
      const err = new Error("Malformed user entitlement record: invalid plan");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    if (this.entitlementService && typeof this.entitlementService.verifySignature === "function" && ent.signature) {
      const validSig = this.entitlementService.verifySignature(ent);
      if (!validSig) {
        const err = new Error("Malformed or tampered entitlement signature");
        err.code = "AI_FORBIDDEN";
        err.statusCode = 403;
        throw err;
      }
    }

    const plan = ent.plan;

    // 4. Validate AI Feature
    const requestedFeature = (rawRequest && typeof rawRequest.feature === "string")
      ? rawRequest.feature.trim().toLowerCase()
      : "";

    if (!AI_FEATURES.includes(requestedFeature)) {
      const err = new Error(
        `Unknown AI feature '${requestedFeature}'. Supported features: ${AI_FEATURES.join(", ")}`
      );
      err.code = "AI_INVALID_REQUEST";
      err.statusCode = 400;
      throw err;
    }

    // 5. Enforce Server-Side Usage Quotas
    const quotaCheck = this.usageService.checkQuota(userId, plan, this.config);
    if (!quotaCheck.allowed) {
      const err = new Error(quotaCheck.reason || "AI usage limit reached for current billing cycle.");
      err.code = "AI_LIMIT_REACHED";
      err.statusCode = 429;
      err.quota = { current: quotaCheck.current, limit: quotaCheck.limit, monthKey: quotaCheck.monthKey };
      throw err;
    }

    // 6. Privacy Guard: Input sanitization & size checks
    const sanitized = PrivacyGuard.sanitizeRequest(rawRequest, this.config);

    // 7. Request ID generation
    const requestId = `ai_${crypto.randomBytes(8).toString("hex")}`;

    // 8. Invoke Provider Abstraction with isolated request
    let providerResult;
    try {
      providerResult = await this.provider.generate({
        ...sanitized,
        requestId,
        userId,
      });
    } catch (provErr) {
      // Record failure metadata without raw source code
      this.usageService.recordUsage({
        userId,
        feature: sanitized.feature,
        requestId,
        status: "error",
      });

      const err = new Error("AI provider currently unavailable. Please retry shortly.");
      err.code = "AI_PROVIDER_UNAVAILABLE";
      err.statusCode = 502;
      err.requestId = requestId;
      throw err;
    }

    // 9. Validate and Enforce Feature Contract Schema
    let validatedAnswer;
    try {
      validatedAnswer = validate(sanitized.feature, providerResult.answer, sanitized);
    } catch (valErr) {
      // Record failure metadata on invalid output
      this.usageService.recordUsage({
        userId,
        feature: sanitized.feature,
        requestId,
        status: "error",
      });

      const err = new Error(valErr.message || "AI provider returned an invalid or malformed response");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      err.requestId = requestId;
      throw err;
    }

    // 10. Record Usage Metadata (Strictly Metadata — NEVER Source Code)
    const usage = providerResult.usage || {};
    this.usageService.recordUsage({
      userId,
      feature: sanitized.feature,
      requestId,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      totalTokens: usage.totalTokens || 0,
      status: "success",
    });

    // 11. Audit event logging (Safe metadata only)
    if (this.db.auditEvents && Array.isArray(this.db.auditEvents)) {
      this.db.auditEvents.push({
        id: `audit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        type: "ai_generation_success",
        ...PrivacyGuard.createSafeAuditLog({ ...sanitized, requestId, userId }),
      });
    }

    // 12. Normalized Response (Never exposes provider secrets, raw tokens, or internal credentials)
    return {
      success: true,
      requestId,
      feature: sanitized.feature,
      answer: validatedAnswer,
      provider: providerResult.provider,
      model: providerResult.model,
      usage: {
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        totalTokens: usage.totalTokens || 0,
      },
    };
  }
}

module.exports = {
  AIService,
  AI_FEATURES,
};
