// Fly2Git Backend — AI Analyze Response Validator (Phase 15B)
// Enforces schema compliance, type safety, confidence bounds, and prevents
// the model from silently replacing user code with full solutions.

const ALLOWED_CONFIDENCE = ["high", "medium", "low"];

class AnalyzeValidator {
  /**
   * Validates and normalizes AI Analyze model output.
   *
   * @param {any} raw - Parsed JSON candidate
   * @param {object} [requestContext] - Original request for invariant checks
   * @returns {object} Validated structured analyze object
   * @throws {Error} With code AI_INVALID_RESPONSE if schema is violated
   */
  static validate(raw, requestContext = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const err = new Error("AI Analyze response must be a JSON object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 1. Validate String Fields
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    const approach = typeof raw.approach === "string" ? raw.approach.trim() : "";
    const correctness = typeof raw.correctness === "string" ? raw.correctness.trim() : "";

    if (!summary || summary.length > 5000) {
      const err = new Error("AI Analyze response missing or oversized 'summary'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    if (!approach || approach.length > 1000) {
      const err = new Error("AI Analyze response missing or oversized 'approach'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    if (!correctness || correctness.length > 2000) {
      const err = new Error("AI Analyze response missing or oversized 'correctness'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 2. Validate Complexity Object
    if (!raw.complexity || typeof raw.complexity !== "object" || Array.isArray(raw.complexity)) {
      const err = new Error("AI Analyze response missing 'complexity' object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    const time = typeof raw.complexity.time === "string" ? raw.complexity.time.trim() : "";
    const space = typeof raw.complexity.space === "string" ? raw.complexity.space.trim() : "";
    const explanation =
      typeof raw.complexity.explanation === "string" ? raw.complexity.explanation.trim() : "";

    if (!time || time.length > 100) {
      const err = new Error("AI Analyze complexity missing or oversized 'time'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    if (!space || space.length > 100) {
      const err = new Error("AI Analyze complexity missing or oversized 'space'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 3. Validate Array Fields
    const validateArray = (arr, fieldName) => {
      if (!Array.isArray(arr)) {
        const err = new Error(`AI Analyze response field '${fieldName}' must be an array`);
        err.code = "AI_INVALID_RESPONSE";
        err.statusCode = 502;
        throw err;
      }
      return arr
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .slice(0, 20)
        .map((s) => s.trim().slice(0, 1000));
    };

    const strengths = validateArray(raw.strengths, "strengths");
    const concerns = validateArray(raw.concerns, "concerns");
    const improvements = validateArray(raw.improvements, "improvements");
    const edgeCases = validateArray(raw.edgeCases, "edgeCases");
    const learningPoints = validateArray(raw.learningPoints, "learningPoints");

    // 4. Validate Confidence Bound
    const confidence =
      typeof raw.confidence === "string" ? raw.confidence.trim().toLowerCase() : "";
    if (!ALLOWED_CONFIDENCE.includes(confidence)) {
      const err = new Error(
        `AI Analyze invalid confidence '${raw.confidence}'. Must be one of: ${ALLOWED_CONFIDENCE.join(", ")}`
      );
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 5. Invariant: AI Analyze must not automatically output full replacement code blocks
    // Detect large verbatim code replacement blocks in summary or improvements
    const fullCodeBlockRegex = /```[a-z0-9_-]*\n([\s\S]{400,})```/i;
    if (fullCodeBlockRegex.test(summary) || improvements.some((imp) => fullCodeBlockRegex.test(imp))) {
      const err = new Error(
        "AI Analyze must evaluate the user approach without replacing it with full code blocks"
      );
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    return {
      summary,
      approach,
      correctness,
      complexity: {
        time,
        space,
        explanation: explanation.slice(0, 2000),
      },
      strengths,
      concerns,
      improvements,
      edgeCases,
      learningPoints,
      confidence,
    };
  }
}

module.exports = AnalyzeValidator;
