// Fly2Git Backend — Mock AI Provider (Phase 15A & 15B)
// Development & testing provider implementation.
// Makes ZERO real network calls and requires ZERO API keys.
// Provides deterministic structured outputs for AI Analyze, AI Explain, and AI Hint.

const AIProvider = require("./ai-provider");

class MockAIProvider extends AIProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.model] - Model name identifier
   * @param {boolean} [options.failNext] - Simulates provider failure when true
   * @param {any} [options.customAnswer] - Custom response override
   * @param {number} [options.simulatedDelayMs] - Simulated network latency
   * @param {boolean} [options.returnMalformed] - Simulates malformed output when true
   * @param {boolean} [options.revealSolutionInHint] - Simulates illegal solution leak in hint when true
   */
  constructor(options = {}) {
    super("mock");
    this.model = options.model || "mock-gemini-pro";
    this.failNext = Boolean(options.failNext);
    this.customAnswer = options.customAnswer || null;
    this.simulatedDelayMs = typeof options.simulatedDelayMs === "number" ? options.simulatedDelayMs : 0;
    this.returnMalformed = Boolean(options.returnMalformed);
    this.revealSolutionInHint = Boolean(options.revealSolutionInHint);
    this.inventEvidenceInCoach = Boolean(options.inventEvidenceInCoach);
    this.returnScoreInCoach = Boolean(options.returnScoreInCoach);
    this.inventEvidenceInIntelligence = Boolean(options.inventEvidenceInIntelligence);
    this.returnScoreInIntelligence = Boolean(options.returnScoreInIntelligence);
  }

  async generate(request = {}) {
    if (this.failNext) {
      this.failNext = false;
      const err = new Error("Upstream mock provider network timeout");
      err.code = "PROVIDER_TIMEOUT";
      throw err;
    }

    if (this.simulatedDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulatedDelayMs));
    }

    const feature = (request.feature || "assistant").toLowerCase().trim();

    // 1. Simulating Malformed Model Output for Validation Testing
    if (this.returnMalformed) {
      return {
        success: true,
        feature,
        answer: { invalidField: true, missingRequired: 123 },
        provider: this.name,
        model: this.model,
        usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        requestId: request.requestId,
      };
    }

    // 2. Simulating Illegal Solution Leak in Hint for Validator Testing
    if (this.revealSolutionInHint && feature === "hint") {
      return {
        success: true,
        feature,
        answer: {
          hintLevel: 1,
          hint: "```python\ndef fullSolution(nums, target):\n    lookup = {}\n    for i, num in enumerate(nums):\n        if target - num in lookup:\n            return [lookup[target - num], i]\n        lookup[num] = i\n    return []\n```",
          nextQuestion: "Does this solution work?",
        },
        provider: this.name,
        model: this.model,
        usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
        requestId: request.requestId,
      };
    }

    // 3. Custom answer override
    if (this.customAnswer !== null) {
      const ans = this.customAnswer;
      const ansLen = typeof ans === "string" ? ans.length : JSON.stringify(ans).length;
      return {
        success: true,
        feature,
        answer: ans,
        provider: this.name,
        model: this.model,
        usage: { inputTokens: 50, outputTokens: Math.ceil(ansLen / 4), totalTokens: 50 + Math.ceil(ansLen / 4) },
        requestId: request.requestId,
      };
    }

    // 4. Default Structured Mock Responses by Feature
    let answer;
    const problemTitle = (request.problem && request.problem.title) || "the problem";

    if (feature === "analyze") {
      answer = {
        summary: `Evaluated ${problemTitle} solution in ${request.language || "specified language"}. The code implements an active traversal approach.`,
        approach: "Hash Map / Auxiliary Lookup Pattern",
        correctness: "The approach appears correct for standard test cases and handles standard constraints.",
        complexity: {
          time: "O(N)",
          space: "O(N)",
          explanation: "Single linear pass storing seen values in an auxiliary hash map structure.",
        },
        strengths: [
          "Optimal O(N) time complexity avoids quadratic brute-force.",
          "Clear algorithmic structure with concise termination.",
        ],
        concerns: [
          "Ensure input array bounds and null checks are handled gracefully.",
        ],
        improvements: [
          "Consider pre-allocating structure capacity if collection size is known in advance.",
        ],
        edgeCases: [
          "Empty or single-element inputs",
          "Duplicate values matching the target complement",
          "Negative integers and zero values",
        ],
        learningPoints: [
          "Trading spatial complexity for time complexity via auxiliary lookup structures.",
        ],
        confidence: "high",
      };
    } else if (feature === "explain") {
      answer = {
        summary: `This solution solves ${problemTitle} by checking each element and verifying its complement.`,
        stepByStep: [
          "Step 1: Initialize an empty hash map to record values and their respective indices.",
          "Step 2: Iterate sequentially through the input collection.",
          "Step 3: For each element, compute whether the required complement has already been stored.",
          "Step 4: Return the found match immediately or persist the current element for future iterations.",
        ],
        importantLines: [
          { lines: "Lines 1-3", purpose: "Initialization and lookup table declaration" },
          { lines: "Lines 4-6", purpose: "Main loop condition and complement lookup check" },
        ],
        concepts: [
          "Hash Table Lookups",
          "Complement Invariants",
          "Linear Traversal",
        ],
        complexity: {
          time: "O(N)",
          space: "O(N)",
          explanation: "Iterates through N items once with average O(1) hash map lookups.",
        },
        takeaway: "A single-pass hash map transforms an O(N^2) pairwise search into an O(N) linear scan.",
      };
    } else if (feature === "hint") {
      let level = 1;
      if (request.metadata && typeof request.metadata.hintLevel === "number") {
        level = Math.min(4, Math.max(1, Math.floor(request.metadata.hintLevel)));
      } else if (typeof request.hintLevel === "number") {
        level = Math.min(4, Math.max(1, Math.floor(request.hintLevel)));
      }

      const hintsByLevel = {
        1: "Instead of comparing every element with every other element, can you remember elements you have already seen?",
        2: "What data structure allows you to query whether an item was previously encountered in O(1) average time?",
        3: "As you traverse the array, calculate the exact complement needed (target - current). Check if it is in your map.",
        4: "If map.has(complement), you have your pair! Otherwise, insert map.set(current, index) and proceed.",
      };

      answer = {
        hintLevel: level,
        hint: hintsByLevel[level] || hintsByLevel[1],
        nextQuestion: "What is the complement value you need to search for on each iteration?",
      };
    } else if (feature === "coach") {
      if (this.returnScoreInCoach) {
        answer = {
          summary: "Your skill score is 85/100 and developer score is superior.",
          observations: ["High score observed."],
          suggestedDirection: "Improve score further.",
          suggestedActions: ["Solve more problems."],
          reflectionQuestion: "Why is your score 85?",
          evidence: { score: 85 },
          confidence: "high",
        };
      } else if (this.inventEvidenceInCoach) {
        answer = {
          summary: "Fabricated history not in metadata.",
          observations: ["User solved 900 hidden graph problems."],
          suggestedDirection: "Keep inventing.",
          suggestedActions: ["Do something."],
          reflectionQuestion: "Did you invent this?",
          evidence: { invented: true },
          confidence: "SUPER_CERTAIN", // invalid confidence string
        };
      } else {
        const mode = (request.mode || "daily").toLowerCase();
        const ctx = request.coachContext || {};
        const obs = Array.isArray(request.observations) ? request.observations : [];
        const streak = typeof ctx.streak === "number" ? ctx.streak : 0;
        const totalSynced = typeof ctx.totalSynced === "number" ? ctx.totalSynced : 0;
        const dominantPlat = (ctx.platforms && ctx.platforms[0] && ctx.platforms[0].platform) || "LeetCode";
        const dominantLang = (ctx.languages && ctx.languages[0] && ctx.languages[0].language) || "Python";

        answer = {
          summary: `Your recent practice has been consistent and centered around ${dominantLang} on ${dominantPlat}.`,
          observations: obs.length > 0 ? obs.map((o) => o.statement) : [
            `Activity recorded across ${totalSynced} synced problems.`,
            `Current streak is ${streak} days.`,
          ],
          suggestedDirection: mode === "balance"
            ? "Explore another platform or language to diversify your coding practice."
            : mode === "weekly"
            ? "Maintain your current problem solving cadence while focusing on problem decomposition."
            : "Practice one Medium problem today at a comfortable pace.",
          suggestedActions: [
            "Practice one problem today at your current comfort level.",
            "Reflect on time spent before looking at hints or edge cases.",
          ],
          reflectionQuestion: "Which pattern or technique felt most natural in your recent practice sessions?",
          evidence: {
            streak,
            totalSynced,
            dominantPlatform: dominantPlat,
            dominantLanguage: dominantLang,
          },
          confidence: "high",
        };
      }
    } else if (feature === "coding_intelligence" || feature === "intelligence") {
      if (this.returnScoreInIntelligence) {
        answer = {
          summary: "Your skill score is 92/100 and developer rating is superior.",
          observations: ["High score observed."],
          relatedPatterns: ["arrays"],
          recentChanges: ["None"],
          suggestedExploration: ["Improve score."],
          confidence: "high",
        };
      } else if (this.inventEvidenceInIntelligence) {
        answer = {
          summary: "Fabricated history not in metadata.",
          observations: ["User solved 800 quantum algorithms."],
          relatedPatterns: ["quantum"],
          recentChanges: ["Shifts unknown"],
          suggestedExploration: ["Invent more."],
          confidence: "SUPER_CERTAIN",
        };
      } else {
        const dCtx = request.derivedContext || {};
        const topPats = Array.isArray(dCtx.topPatterns) ? dCtx.topPatterns : [];
        const dominantPattern = topPats[0]?.pattern || "arrays";
        const shifts = Array.isArray(dCtx.recentShifts) ? dCtx.recentShifts : [];
        const recentShiftText = shifts.length > 0
          ? `Recent activity shifted toward ${shifts[0].pattern} (${shifts[0].direction}).`
          : "Practice patterns have remained steady over recent sessions.";

        answer = {
          summary: `Observed coding practice history shows focused activity in ${dominantPattern} with diversified problem exposure.`,
          observations: topPats.length > 0
            ? topPats.slice(0, 3).map((p) => `${p.pattern}: ${p.count} observed problems across ${(p.platforms || []).join(", ") || "multiple platforms"}.`)
            : ["No specific pattern concentration observed in the selected period."],
          relatedPatterns: dCtx.relationships && dCtx.relationships.length > 0
            ? [dCtx.relationships[0].patternA, dCtx.relationships[0].patternB]
            : ["hashing", "two-pointers"],
          recentChanges: [recentShiftText],
          suggestedExploration: [
            "Your recent history contains fewer observed problems involving dynamic-programming. Exploring introductory problems could broaden pattern exposure.",
          ],
          confidence: "high",
        };
      }
    } else {
      // Default string answer for "assistant", "readme", "portfolio_insight"
      answer = `[Fly2Git AI (${this.name})] Analysis complete for feature '${feature}'. Code structure verified.`;
    }

    const codeChars = (request.code || "").length;
    const promptChars = (request.userQuestion || "").length;
    const ansLen = typeof answer === "string" ? answer.length : JSON.stringify(answer).length;
    const inputTokens = Math.max(1, Math.ceil((codeChars + promptChars + 100) / 4));
    const outputTokens = Math.max(1, Math.ceil(ansLen / 4));

    return {
      success: true,
      feature,
      answer,
      provider: this.name,
      model: this.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      requestId: request.requestId,
    };
  }
}

module.exports = MockAIProvider;
