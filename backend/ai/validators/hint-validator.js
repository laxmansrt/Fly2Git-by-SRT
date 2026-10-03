// Fly2Git Backend — AI Hint Response Validator (Phase 15B)
// Validates progressive hint depth, ensures questions prompt deduction,
// and enforces that hints do NOT reveal full code by default.

class HintValidator {
  /**
   * Validates and normalizes AI Hint model output.
   *
   * @param {any} raw - Parsed JSON candidate
   * @param {object} [requestContext] - Original request for invariant checks
   * @returns {object} Validated structured hint object
   * @throws {Error} With code AI_INVALID_RESPONSE if schema is violated
   */
  static validate(raw, requestContext = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const err = new Error("AI Hint response must be a JSON object");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 1. Hint Level
    let hintLevel = 1;
    if (typeof raw.hintLevel === "number") {
      hintLevel = Math.min(4, Math.max(1, Math.floor(raw.hintLevel)));
    } else if (typeof raw.hintLevel === "string" && !isNaN(parseInt(raw.hintLevel, 10))) {
      hintLevel = Math.min(4, Math.max(1, parseInt(raw.hintLevel, 10)));
    }

    // 2. Hint text
    const hint = typeof raw.hint === "string" ? raw.hint.trim() : "";
    if (!hint || hint.length > 4000) {
      const err = new Error("AI Hint response missing or oversized 'hint'");
      err.code = "AI_INVALID_RESPONSE";
      err.statusCode = 502;
      throw err;
    }

    // 3. Next Question
    const nextQuestion =
      typeof raw.nextQuestion === "string" ? raw.nextQuestion.trim().slice(0, 1000) : "";

    // 4. Invariant: Do not return full verbatim solutions by default in AI_HINT
    const revealSolutionAllowed = Boolean(
      (requestContext.metadata && requestContext.metadata.revealSolution === true) ||
      (typeof requestContext.userQuestion === "string" &&
        requestContext.userQuestion.toLowerCase().includes("show full solution"))
    );

    if (!revealSolutionAllowed) {
      // Check for verbatim solution blocks (complete functions with return statements or code fences with full implementations)
      const codeFenceWithFunction =
        /```[a-z0-9_-]*\s*\n[\s\S]*?(def\s+[a-zA-Z0-9_]+|function\s+[a-zA-Z0-9_]+|class\s+Solution)[\s\S]*?return[\s\S]*?```/i;
      const directFunctionDef =
        /(def\s+[a-zA-Z0-9_]+\s*\([^)]*\)|function\s+[a-zA-Z0-9_]+\s*\([^)]*\)|class\s+Solution)[\s\S]*?return\s+/i;
      const oversizedCodeFence = /```[a-z0-9_-]*\n([\s\S]{250,})```/i;

      if (codeFenceWithFunction.test(hint) || directFunctionDef.test(hint) || oversizedCodeFence.test(hint)) {
        const err = new Error(
          "AI Hint must provide progressive guidance, not verbatim complete solutions by default"
        );
        err.code = "AI_INVALID_RESPONSE";
        err.statusCode = 502;
        throw err;
      }
    }

    return {
      hintLevel,
      hint,
      nextQuestion: nextQuestion || "What invariant or pattern could you apply here?",
    };
  }
}

module.exports = HintValidator;
