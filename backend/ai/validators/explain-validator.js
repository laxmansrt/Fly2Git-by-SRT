// Fly2Git Backend — AI Explain Response Validator (Phase 15B)
// Validates schema, step-by-step breakdown, line-level explanations, and complexity.

class ExplainValidator {
  /**
   * Validates and normalizes AI Explain model output.
   *
   * @param {any} raw - Parsed JSON candidate
   * @returns {object} Validated structured explain object
   * @throws {Error} With code AI_INVALID_RESPONSE if schema is violated
   */
  static validate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const err = new Error("AI Explain response must be a JSON object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 1. Summary
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (!summary || summary.length > 5000) {
      const err = new Error("AI Explain response missing or oversized 'summary'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 2. StepByStep array
    if (!Array.isArray(raw.stepByStep) || raw.stepByStep.length === 0) {
      const err = new Error("AI Explain response must contain a non-empty 'stepByStep' array");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }
    const stepByStep = raw.stepByStep
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .slice(0, 30)
      .map((s) => s.trim().slice(0, 1500));

    if (stepByStep.length === 0) {
      const err = new Error("AI Explain response contains no valid step descriptions");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 3. ImportantLines
    let importantLines = [];
    if (Array.isArray(raw.importantLines)) {
      importantLines = raw.importantLines
        .filter((item) => item && (typeof item === "object" || typeof item === "string"))
        .slice(0, 20)
        .map((item) => {
          if (typeof item === "string") {
            return { lines: item.slice(0, 100), purpose: item.slice(0, 500) };
          }
          return {
            lines: typeof item.lines === "string" ? item.lines.trim().slice(0, 100) : "Key section",
            purpose: typeof item.purpose === "string" ? item.purpose.trim().slice(0, 500) : "",
          };
        });
    }

    // 4. Concepts
    let concepts = [];
    if (Array.isArray(raw.concepts)) {
      concepts = raw.concepts
        .filter((c) => typeof c === "string" && c.trim().length > 0)
        .slice(0, 20)
        .map((c) => c.trim().slice(0, 200));
    }

    // 5. Complexity
    let complexity = { time: "O(N)", space: "O(1)", explanation: "" };
    if (raw.complexity && typeof raw.complexity === "object" && !Array.isArray(raw.complexity)) {
      complexity = {
        time: typeof raw.complexity.time === "string" ? raw.complexity.time.trim().slice(0, 100) : "O(N)",
        space: typeof raw.complexity.space === "string" ? raw.complexity.space.trim().slice(0, 100) : "O(1)",
        explanation:
          typeof raw.complexity.explanation === "string"
            ? raw.complexity.explanation.trim().slice(0, 1000)
            : "",
      };
    } else if (typeof raw.complexity === "string") {
      complexity = { time: raw.complexity.slice(0, 100), space: "O(1)", explanation: "" };
    }

    // 6. Takeaway
    const takeaway = typeof raw.takeaway === "string" ? raw.takeaway.trim().slice(0, 2000) : "";
    if (!takeaway) {
      const err = new Error("AI Explain response missing 'takeaway'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    return {
      summary,
      stepByStep,
      importantLines,
      concepts,
      complexity,
      takeaway,
    };
  }
}

module.exports = ExplainValidator;
