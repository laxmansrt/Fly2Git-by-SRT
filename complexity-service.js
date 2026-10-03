/**
 * Fly2Git by SRT — Post-Acceptance Complexity Intelligence (Phase 16.4)
 *
 * Provides normalized data models, source attribution, confidence indicators,
 * human-readable complexity labels, measured metric distinction, and safe rendering.
 *
 * Rules:
 * - Distinguish ANALYZED (Big-O) from MEASURED (Runtime/Memory)
 * - Sources: PLATFORM, AI ANALYSIS, STATIC ANALYSIS, USER PROVIDED
 * - Confidence: HIGH, MEDIUM, LOW (no numeric scores)
 * - Zero source code, prompts, or AI token dumps persisted
 * - Non-blocking failure isolation
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitComplexity = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMPLEXITY_SOURCES = Object.freeze({
    PLATFORM: "PLATFORM",
    AI_ANALYSIS: "AI ANALYSIS",
    STATIC_ANALYSIS: "STATIC ANALYSIS",
    USER_PROVIDED: "USER PROVIDED",
  });

  const CONFIDENCE_LEVELS = Object.freeze({
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
  });

  const BIG_O_LABELS = Object.freeze({
    "o(1)": "Constant",
    "o(logn)": "Logarithmic",
    "o(log n)": "Logarithmic",
    "o(n)": "Linear",
    "o(nlogn)": "Linearithmic",
    "o(n log n)": "Linearithmic",
    "o(n^2)": "Quadratic",
    "o(n2)": "Quadratic",
    "o(n^3)": "Cubic",
    "o(n3)": "Cubic",
    "o(2^n)": "Exponential",
    "o(2n)": "Exponential",
    "o(n!)": "Factorial",
  });

  /**
   * Derives friendly human-readable label only when confidence is high or medium.
   *
   * @param {string} bigO
   * @param {string} confidence
   * @returns {string|null}
   */
  function getHumanLabel(bigO, confidence) {
    if (!bigO || typeof bigO !== "string") return null;
    if (confidence === CONFIDENCE_LEVELS.LOW) return null;

    const normalized = bigO.toLowerCase().replace(/\s+/g, " ").trim();
    if (BIG_O_LABELS[normalized]) return BIG_O_LABELS[normalized];

    const compact = normalized.replace(/\s+/g, "");
    if (BIG_O_LABELS[compact]) return BIG_O_LABELS[compact];

    return null;
  }

  /**
   * Normalizes source string to standardized format.
   *
   * @param {string} src
   * @param {string} [platformName]
   * @returns {string}
   */
  function normalizeSource(src, platformName) {
    if (!src) return COMPLEXITY_SOURCES.AI_ANALYSIS;
    const s = String(src).toLowerCase();
    if (s.includes("platform") || s.includes("leetcode") || s.includes("gfg") || s.includes("codeforces") || s.includes("hackerrank") || s.includes("codechef") || s.includes("atcoder") || s.includes("spoj")) {
      return platformName ? platformName.toUpperCase() : COMPLEXITY_SOURCES.PLATFORM;
    }
    if (s.includes("static")) return COMPLEXITY_SOURCES.STATIC_ANALYSIS;
    if (s.includes("user")) return COMPLEXITY_SOURCES.USER_PROVIDED;
    return COMPLEXITY_SOURCES.AI_ANALYSIS;
  }

  /**
   * Formats measured platform value (e.g. runtime or memory).
   *
   * @param {any} val
   * @param {string} unit
   * @returns {{ value: string|null, available: boolean }}
   */
  function formatMeasuredValue(val, unit) {
    if (val === undefined || val === null || val === "" || val === false) {
      return { value: null, available: false };
    }
    const str = String(val).trim();
    if (str === "0" || str === "0 ms" || str === "0 MB" || str === "N/A" || str === "unavailable") {
      // Do not show fake zeros or placeholder measurements
      return { value: null, available: false };
    }
    // If unit missing, attach default
    if (unit && !str.toLowerCase().includes(unit.toLowerCase())) {
      return { value: `${str} ${unit}`, available: true };
    }
    return { value: str, available: true };
  }

  /**
   * Extracts concise explanation for WHY section (max 280 chars, single thought).
   *
   * @param {string} explanation
   * @returns {string}
   */
  function formatWhyExplanation(explanation) {
    if (!explanation || typeof explanation !== "string") {
      return "The algorithmic complexity is determined by solution iteration bounds and data structure allocations.";
    }
    const clean = explanation.replace(/```[\s\S]*?```/g, "").replace(/[#*`_]/g, "").trim();
    if (clean.length <= 280) return clean;
    const sentences = clean.split(/(?<=[.!?])\s+/);
    if (sentences.length > 0 && sentences[0].length >= 30) {
      let combined = sentences[0];
      if (sentences.length > 1 && combined.length + sentences[1].length < 240) {
        combined += " " + sentences[1];
      }
      return combined;
    }
    return clean.slice(0, 277) + "...";
  }

  /**
   * Formats personal coding intelligence history anchor without assigning skill.
   *
   * @param {object} [historyData]
   * @returns {{ relevant: boolean, text: string|null }}
   */
  function formatHistoryComparison(historyData) {
    if (!historyData || typeof historyData !== "object") {
      return { relevant: false, text: null };
    }
    const pattern = historyData.pattern || historyData.dataStructure || null;
    const count = typeof historyData.count === "number" ? historyData.count : 0;

    if (!pattern || count <= 0) {
      return { relevant: false, text: null };
    }

    // Never say "You are advanced at HashMap" or assign skill
    return {
      relevant: true,
      pattern: pattern,
      count: count,
      text: `You've used ${pattern} in ${count} observed solution${count === 1 ? "" : "s"}.`,
    };
  }

  /**
   * Normalizes raw complexity and platform metrics into canonical schema.
   *
   * @param {object} input
   * @param {object} [options]
   * @returns {object} Normalized complexity data model
   */
  function normalizeComplexity(input = {}, options = {}) {
    const raw = input || {};
    const platform = options.platform || raw.platform || "Platform";
    const confidence = [CONFIDENCE_LEVELS.HIGH, CONFIDENCE_LEVELS.MEDIUM, CONFIDENCE_LEVELS.LOW].includes(
      String(raw.confidence || "").toLowerCase()
    )
      ? String(raw.confidence).toLowerCase()
      : CONFIDENCE_LEVELS.MEDIUM;

    // Time Big-O
    const rawTime = (raw.time && typeof raw.time === "object" ? raw.time.value : raw.time) ||
                    (raw.complexity && raw.complexity.time) || "O(n)";
    const timeSource = normalizeSource(
      (raw.time && raw.time.source) || raw.source || "ai_analysis",
      platform
    );
    const timeLabel = getHumanLabel(rawTime, confidence);

    // Space Big-O
    const rawSpace = (raw.space && typeof raw.space === "object" ? raw.space.value : raw.space) ||
                     (raw.complexity && raw.complexity.space) || "O(1)";
    const spaceSource = normalizeSource(
      (raw.space && raw.space.source) || raw.source || "ai_analysis",
      platform
    );
    const spaceLabel = getHumanLabel(rawSpace, confidence);

    // Measured Platform Metrics (Runtime / Memory)
    const rawMeasured = raw.measured || {};
    const runtimeRaw = (rawMeasured.runtime !== undefined && rawMeasured.runtime !== null)
      ? (typeof rawMeasured.runtime === "object" ? rawMeasured.runtime.value : rawMeasured.runtime)
      : (raw.runtime !== undefined ? raw.runtime : null);
    const memoryRaw = (rawMeasured.memory !== undefined && rawMeasured.memory !== null)
      ? (typeof rawMeasured.memory === "object" ? rawMeasured.memory.value : rawMeasured.memory)
      : (raw.memory !== undefined ? raw.memory : null);

    const runtimeFormatted = formatMeasuredValue(runtimeRaw, "ms");
    const memoryFormatted = formatMeasuredValue(memoryRaw, "MB");

    // Why section
    const rawExp = raw.explanation || (raw.complexity && raw.complexity.explanation) || "";
    const whyText = formatWhyExplanation(rawExp);

    // History comparison
    const historyInfo = formatHistoryComparison(raw.userHistory || options.userHistory);

    const model = {
      time: {
        value: rawTime,
        label: timeLabel,
        source: timeSource,
        confidence: confidence,
        explanation: rawExp,
      },
      space: {
        value: rawSpace,
        label: spaceLabel,
        source: spaceSource,
        confidence: confidence,
        explanation: rawExp,
      },
      measured: {
        runtime: {
          value: runtimeFormatted.value,
          source: runtimeFormatted.available ? normalizeSource("platform", platform) : null,
          available: runtimeFormatted.available,
        },
        memory: {
          value: memoryFormatted.value,
          source: memoryFormatted.available ? normalizeSource("platform", platform) : null,
          available: memoryFormatted.available,
        },
      },
      why: whyText,
      confidenceMessage: confidence === CONFIDENCE_LEVELS.LOW
        ? "Complexity could not be confidently determined."
        : null,
      userHistory: historyInfo,
      timestamp: Date.now(),
    };

    // Strict privacy assurance: delete any accidental source code or sensitive tokens
    delete model.code;
    delete model.sourceCode;
    delete model.prompt;
    delete model.token;
    delete model.cookie;

    return Object.freeze(model);
  }

  return {
    COMPLEXITY_SOURCES,
    CONFIDENCE_LEVELS,
    BIG_O_LABELS,
    getHumanLabel,
    normalizeSource,
    formatMeasuredValue,
    formatWhyExplanation,
    formatHistoryComparison,
    normalizeComplexity,
  };
});
