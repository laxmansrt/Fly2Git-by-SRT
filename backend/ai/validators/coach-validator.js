// Fly2Git Backend — AI Personal Coding Coach Validator (Phase 15C)
// Validates structured coach responses, enforces confidence bounds,
// and strictly blocks forbidden scoring, ranking, or degrading language.

class CoachValidator {
  /**
   * Validates and normalizes Personal Coding Coach model output.
   *
   * @param {any} raw - Parsed JSON candidate
   * @param {object} [requestContext] - Request context for invariant checks
   * @returns {object} Validated structured coach object
   * @throws {Error} With code AI_INVALID_RESPONSE if schema or invariants are violated
   */
  static validate(raw, requestContext = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const err = new Error("AI Coach response must be a JSON object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 1. Summary
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (!summary || summary.length > 2000) {
      const err = new Error("AI Coach response missing or oversized 'summary'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 2. Observations Array
    if (!Array.isArray(raw.observations) || raw.observations.length === 0) {
      const err = new Error("AI Coach response must contain a non-empty 'observations' array");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }
    const observations = raw.observations
      .slice(0, 10)
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
      .filter(Boolean);
    if (observations.length === 0) {
      const err = new Error("AI Coach observations array contained no valid string items");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 3. Suggested Direction
    const suggestedDirection = typeof raw.suggestedDirection === "string" ? raw.suggestedDirection.trim() : "";
    if (!suggestedDirection || suggestedDirection.length > 1500) {
      const err = new Error("AI Coach response missing or oversized 'suggestedDirection'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 4. Suggested Actions Array
    if (!Array.isArray(raw.suggestedActions) || raw.suggestedActions.length === 0) {
      const err = new Error("AI Coach response must contain a non-empty 'suggestedActions' array");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }
    const suggestedActions = raw.suggestedActions
      .slice(0, 10)
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
      .filter(Boolean);
    if (suggestedActions.length === 0) {
      const err = new Error("AI Coach suggestedActions array contained no valid string items");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 5. Reflection Question
    const reflectionQuestion = typeof raw.reflectionQuestion === "string" ? raw.reflectionQuestion.trim() : "";
    if (!reflectionQuestion || reflectionQuestion.length > 1000) {
      const err = new Error("AI Coach response missing or oversized 'reflectionQuestion'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 6. Confidence Bounds
    const validConfidences = ["high", "medium", "low"];
    const confidence = typeof raw.confidence === "string" ? raw.confidence.toLowerCase().trim() : "";
    if (!validConfidences.includes(confidence)) {
      const err = new Error(
        `AI Coach response confidence must be one of [${validConfidences.join(", ")}], received '${confidence}'`
      );
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 7. Evidence object
    const evidence = raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence) ? raw.evidence : {};

    // 8. Invariant Defense: Prohibit skill scores, IQ, ranking, or degrading language
    const combinedText = `${summary} ${observations.join(" ")} ${suggestedDirection} ${suggestedActions.join(" ")}`.toLowerCase();
    const forbiddenPatterns = [
      /skill\s*score/i,
      /developer\s*score/i,
      /intelligence\s*score/i,
      /employability\s*score/i,
      /coding\s*score/i,
      /interview\s*probability/i,
      /hireability/i,
      /you('re|\s+are)\s+(bad|weak|inferior)/i,
      /bad\s+coder/i,
      /iq\s*score/i,
    ];

    for (const pat of forbiddenPatterns) {
      if (pat.test(combinedText)) {
        const err = new Error("AI Coach response violated objective learning policy by including evaluative scoring or judgment");
        err.code = "AI_INVALID_RESPONSE";
        err.statusCode = 502;
        throw err;
      }
    }

    return {
      summary,
      observations,
      suggestedDirection,
      suggestedActions,
      reflectionQuestion,
      evidence,
      confidence,
    };
  }
}

module.exports = CoachValidator;
