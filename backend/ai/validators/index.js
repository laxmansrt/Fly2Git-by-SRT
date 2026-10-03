// Fly2Git Backend — Central AI Response Validator Index (Phase 15B & 15C)
const AnalyzeValidator = require("./analyze-validator");
const ExplainValidator = require("./explain-validator");
const HintValidator = require("./hint-validator");
const CoachValidator = require("./coach-validator");
const CodingIntelligenceValidator = require("./coding-intelligence-validator");

/**
 * Validates model output for a given feature.
 *
 * @param {string} feature - "analyze" | "explain" | "hint" | "coach" | "coding_intelligence" | "assistant"
 * @param {any} rawOutput - Output returned by provider
 * @param {object} [requestContext] - Request context for invariant checks
 * @returns {object|string} Validated data
 * @throws {Error} With code AI_INVALID_RESPONSE if schema is violated
 */
function validate(feature, rawOutput, requestContext = {}) {
  const norm = (feature || "").toLowerCase().trim();

  // If rawOutput is a string that represents JSON, parse it
  let parsed = rawOutput;
  if (typeof rawOutput === "string") {
    const trimmed = rawOutput.trim();
    // Handle ```json ... ``` wrapper if present
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        const err = new Error(`Failed to parse AI model response as JSON: ${parseErr.message}`);
        err.code = "AI_INVALID_RESPONSE";
        err.statusCode = 502;
        throw err;
      }
    }
  }

  switch (norm) {
    case "analyze":
      return AnalyzeValidator.validate(parsed, requestContext);
    case "explain":
      return ExplainValidator.validate(parsed, requestContext);
    case "hint":
      return HintValidator.validate(parsed, requestContext);
    case "coach":
      return CoachValidator.validate(parsed, requestContext);
    case "coding_intelligence":
    case "intelligence":
      return CodingIntelligenceValidator.validate(parsed, requestContext);
    case "assistant":
    default:
      // Assistant responses may be string or object
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object") return parsed;
      return String(rawOutput || "");
  }
}

module.exports = {
  AnalyzeValidator,
  ExplainValidator,
  HintValidator,
  CoachValidator,
  CodingIntelligenceValidator,
  validate,
};
