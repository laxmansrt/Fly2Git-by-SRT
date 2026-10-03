// Fly2Git Backend — Central AI Prompt Index (Phase 15B)
const AnalyzePrompt = require("./analyze-prompt");
const ExplainPrompt = require("./explain-prompt");
const HintPrompt = require("./hint-prompt");
const CoachPrompt = require("./coach-prompt");
const CodingIntelligencePrompt = require("./coding-intelligence-prompt");

/**
 * Returns the prompt builder pair { systemInstruction, userPrompt } for a feature.
 *
 * @param {string} feature
 * @param {object} request
 * @returns {{ systemInstruction: string, userPrompt: string }}
 */
function getPrompt(feature, request) {
  const norm = (feature || "").toLowerCase().trim();
  switch (norm) {
    case "analyze":
      return AnalyzePrompt.build(request);
    case "explain":
      return ExplainPrompt.build(request);
    case "hint":
      return HintPrompt.build(request);
    case "coach":
      return CoachPrompt.build(request);
    case "coding_intelligence":
    case "intelligence":
      return CodingIntelligencePrompt.build(request);
    case "assistant":
    default:
      // Fallback for assistant or unknown prompt
      return AnalyzePrompt.build(request);
  }
}

module.exports = {
  AnalyzePrompt,
  ExplainPrompt,
  HintPrompt,
  CoachPrompt,
  CodingIntelligencePrompt,
  getPrompt,
};
