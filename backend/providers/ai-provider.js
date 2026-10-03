// Fly2Git Backend — AI Provider Base Class / Interface (Phase 15A)
// Provider-agnostic abstraction for backend AI operations.
// The extension never communicates directly with AI providers.
// Concrete implementations (Mock, Gemini, OpenAI, Anthropic) extend this class.

class AIProvider {
  /**
   * @param {string} name - Canonical provider name (e.g. "mock", "gemini", "openai")
   */
  constructor(name) {
    if (!name || typeof name !== "string") {
      throw new Error("AIProvider requires a valid provider name string");
    }
    this.name = name;
  }

  /**
   * Generates a normalized AI response for a request.
   * Must be implemented by concrete provider subclasses.
   *
   * @param {object} request
   * @param {string} request.feature - AI feature (e.g. "assistant", "analyze", "coach", "readme", "portfolio_insight")
   * @param {string} [request.platform] - Platform ID (e.g. "leetcode")
   * @param {object} [request.problem] - { slug, title, difficulty, url }
   * @param {string} [request.code] - Sanitized solution code
   * @param {string} [request.language] - Programming language
   * @param {string} [request.errorContext] - Optional error context
   * @param {string} [request.userQuestion] - User prompt / question
   * @param {string} request.requestId - Unique audit request ID
   * @param {object} [request.metadata] - Extra metadata
   * @returns {Promise<{ success: boolean, feature: string, answer: string, provider: string, model: string, usage: { inputTokens: number, outputTokens: number, totalTokens: number }, requestId: string }>}
   */
  async generate(request) {
    throw new Error(`generate() must be implemented by ${this.name} provider`);
  }
}

module.exports = AIProvider;
