// Fly2Git Backend — AI Coding Intelligence Validator (Phase 15D)
// Validates structured coding intelligence responses, enforces confidence bounds,
// and strictly blocks forbidden evaluative scoring, ranking, or degrading language.

class CodingIntelligenceValidator {
  /**
   * Validates and normalizes Coding Intelligence model output.
   *
   * @param {any} raw - Parsed candidate object
   * @param {object} [requestContext] - Request context for invariant checks
   * @returns {object} Validated structured intelligence object
   * @throws {Error} With code AI_INVALID_RESPONSE if schema or invariants are violated
   */
  static validate(raw, requestContext = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const err = new Error("AI Coding Intelligence response must be a JSON object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 1. Summary
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (!summary || summary.length > 2000) {
      const err = new Error("AI Coding Intelligence response missing or oversized 'summary'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 2. Observations Array
    if (!Array.isArray(raw.observations) || raw.observations.length === 0) {
      const err = new Error("AI Coding Intelligence response must contain a non-empty 'observations' array");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }
    const observations = raw.observations
      .slice(0, 10)
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
      .filter(Boolean);
    if (observations.length === 0) {
      const err = new Error("AI Coding Intelligence observations array contained no valid string items");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 3. Related Patterns Array
    const relatedPatterns = Array.isArray(raw.relatedPatterns)
      ? raw.relatedPatterns
          .slice(0, 10)
          .map((item) => (typeof item === "string" ? item.trim().slice(0, 100) : ""))
          .filter(Boolean)
      : [];

    // 4. Recent Changes Array
    const recentChanges = Array.isArray(raw.recentChanges)
      ? raw.recentChanges
          .slice(0, 10)
          .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
          .filter(Boolean)
      : [];

    // 5. Suggested Exploration Array
    const suggestedExploration = Array.isArray(raw.suggestedExploration)
      ? raw.suggestedExploration
          .slice(0, 10)
          .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
          .filter(Boolean)
      : [];

    // 6. Confidence Bounds
    const validConfidences = ["high", "medium", "low"];
    const confidence = typeof raw.confidence === "string" ? raw.confidence.toLowerCase().trim() : "";
    if (!validConfidences.includes(confidence)) {
      const err = new Error(
        `AI Coding Intelligence confidence must be one of [${validConfidences.join(", ")}], received '${confidence}'`
      );
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 7. Invariant Defenses: Prohibit skill scores, rankings, IQ, and degrading weakness claims
    const combinedText = `${summary} ${observations.join(" ")} ${recentChanges.join(" ")} ${suggestedExploration.join(" ")}`.toLowerCase();
    const forbiddenPatterns = [
      /skill\s*score/i,
      /developer\s*score/i,
      /developer\s*rating/i,
      /intelligence\s*score/i,
      /employability\s*(score|rating)/i,
      /coding\s*score/i,
      /interview\s*probability/i,
      /hireability/i,
      /iq\s*score/i,
      /ranking\s+against/i,
      /percentile/i,
      /you('re|\s+are)\s+(bad|weak|inferior)/i,
      /weak\s+at\s+[a-z]/i,
      /bad\s+coder/i,
    ];

    for (const pat of forbiddenPatterns) {
      if (pat.test(combinedText)) {
        const err = new Error(
          "AI Coding Intelligence response violated non-evaluative policy by including scores, rankings, or judgment"
        );
        err.code = "AI_INVALID_RESPONSE";
        err.statusCode = 502;
        throw err;
      }
    }

    return {
      summary,
      observations,
      relatedPatterns,
      recentChanges,
      suggestedExploration,
      confidence,
    };
  }
}

module.exports = CodingIntelligenceValidator;
