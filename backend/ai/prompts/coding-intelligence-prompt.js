// Fly2Git Backend — AI Coding Intelligence Prompt Builder (Phase 15D)
// Generates grounded prompts for explaining personal coding patterns and navigation.
// Invariants:
// 1. Minimized derived context only: Only aggregated pattern statistics, shifts, and relationships.
// 2. Strict grounding: AI must never invent underlying counts or events.
// 3. Zero evaluative scoring: Prohibits skill scores, developer ratings, IQ, interview probabilities, or rankings.
// 4. Constructive exploration: Suggestions must be framed as practice opportunities (e.g., "fewer observed problems"), never "weakness" or judgment.
// 5. Zero sensitive data: Never includes source code, full problem statements, cookies, tokens, or credentials.

class CodingIntelligencePrompt {
  /**
   * Builds the systemInstruction and userPrompt pair for AI Coding Intelligence.
   *
   * @param {object} request - AI request payload
   * @returns {{ systemInstruction: string, userPrompt: string }}
   */
  static build(request = {}) {
    const systemInstruction = [
      "You are the Fly2Git Coding Intelligence Engine.",
      "Your sole purpose is to provide objective, observational explanations of the user's coding practice patterns based strictly on derived metadata.",
      "",
      "CRITICAL SAFETY & INTEGRITY INVARIANTS:",
      "1. ZERO SCORING: You must NEVER generate, calculate, or mention a skill score, developer rating, IQ score, employability score, hiring probability, interview prediction, percentile, or user ranking.",
      "2. STRICT GROUNDING: You must NEVER invent, fabricate, or assume problem counts, platforms, languages, or dates not provided in the derived context.",
      "3. OBJECTIVE OBSERVATION: Describe what was observed in the data. Use phrases such as 'Your practice has concentrated on...', 'Recent activity shifted toward...', or 'Fewer problems have been observed for...'.",
      "4. NO DEVALUING LANGUAGE: Never state 'you are weak at X', 'you are bad at X', or 'you fail at X'. Frame unexplored areas as optional exploration candidates.",
      "5. DATA MINIMIZATION: Base your response exclusively on the provided derived pattern summaries, matrices, and shifts.",
      "",
      "REQUIRED RESPONSE FORMAT:",
      "You must respond with a strictly valid JSON object matching this schema:",
      "{",
      '  "summary": "High-level objective summary of observed pattern practice (string, max 1000 chars)",',
      '  "observations": ["Array of 1 to 5 factual statements directly supported by the metadata"],',
      '  "relatedPatterns": ["Array of related canonical pattern slugs connected to user practice"],',
      '  "recentChanges": ["Array of observed shifts between recent and previous periods"],',
      '  "suggestedExploration": ["Array of 1 to 3 optional learning directions framed as opportunities"],',
      '  "confidence": "high" | "medium" | "low"',
      "}",
      "",
      "Do NOT include markdown formatting or code blocks outside the JSON object.",
    ].join("\n");

    const derivedContext = request.derivedContext || {};
    const patterns = Array.isArray(derivedContext.topPatterns) ? derivedContext.topPatterns : [];
    const shifts = Array.isArray(derivedContext.recentShifts) ? derivedContext.recentShifts : [];
    const relationships = Array.isArray(derivedContext.relationships) ? derivedContext.relationships : [];
    const languageMatrix = derivedContext.languageMatrix || {};
    const platformMatrix = derivedContext.platformMatrix || {};
    const currentProblem = request.currentProblem || null;
    const userQuestion = typeof request.userQuestion === "string" ? request.userQuestion.trim().slice(0, 1000) : "";

    const userPrompt = [
      "<SYSTEM_RULES>",
      "Adhere strictly to all system safety, zero-scoring, and grounding constraints.",
      "</SYSTEM_RULES>",
      "",
      "<INTELLIGENCE_CONTEXT>",
      `Total Observed Problems: ${derivedContext.totalObserved || 0}`,
      `Active Period: ${derivedContext.period || "all"}`,
      "",
      "Top Observed Patterns:",
      patterns.length > 0
        ? patterns
            .slice(0, 8)
            .map(
              (p) =>
                `- ${p.pattern}: ${p.count} problems (Platforms: ${(p.platforms || []).join(", ")}; Languages: ${(p.languages || []).join(", ")})`
            )
            .join("\n")
        : "None recorded yet.",
      "",
      "Recent Pattern Shifts:",
      shifts.length > 0
        ? shifts
            .slice(0, 6)
            .map(
              (s) =>
                `- ${s.pattern}: recent=${s.recentCount}, previous=${s.previousCount} (${s.direction})`
            )
            .join("\n")
        : "No comparative shift data available.",
      "",
      "Observed Pattern Co-occurrences:",
      relationships.length > 0
        ? relationships
            .slice(0, 6)
            .map((r) => `- ${r.patternA} <-> ${r.patternB}: ${r.coOccurrenceCount} co-occurrences`)
            .join("\n")
        : "None recorded yet.",
      "",
      "Language × Pattern Practice:",
      Object.keys(languageMatrix).length > 0
        ? Object.entries(languageMatrix)
            .map(
              ([lang, pats]) =>
                `- ${lang}: ${Object.entries(pats)
                  .map(([p, c]) => `${p} (${c})`)
                  .join(", ")}`
            )
            .join("\n")
        : "No language matrix data.",
      "",
      "Platform × Pattern Practice:",
      Object.keys(platformMatrix).length > 0
        ? Object.entries(platformMatrix)
            .map(
              ([plat, pats]) =>
                `- ${plat}: ${Object.entries(pats)
                  .map(([p, c]) => `${p} (${c})`)
                  .join(", ")}`
            )
            .join("\n")
        : "No platform matrix data.",
      "",
      currentProblem
        ? [
            "Current Problem Context:",
            `- Title: ${currentProblem.title || "Untitled"}`,
            `- Platform: ${currentProblem.platform || "Unknown"}`,
            `- Difficulty: ${currentProblem.difficulty || "Unknown"}`,
            `- Patterns: ${(currentProblem.patterns || []).join(", ") || "None specified"}`,
          ].join("\n")
        : "",
      "</INTELLIGENCE_CONTEXT>",
      "",
      userQuestion ? `<USER_QUESTION>\n${userQuestion}\n</USER_QUESTION>` : "",
      "",
      "Generate the JSON Coding Intelligence explanation:",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      systemInstruction,
      userPrompt,
    };
  }
}

module.exports = CodingIntelligencePrompt;
