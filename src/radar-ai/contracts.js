/** Provider-neutral contracts and enums for the Radar AI foundation. */
export const RADAR_AI_VERSION = "0.1.0";

export const TASKS = Object.freeze({
  TUTOR: "tutor",
  EXPLAIN_QUESTION: "explain-question",
  GENERATE_QUESTION: "generate-question",
  STUDY_PLAN: "study-plan",
  EXAM_ANALYSIS: "exam-analysis",
});

export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard", "very-hard"]);

export function createAiAnswer({
  text,
  references = [],
  confidence = "unknown",
  limitations = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    version: RADAR_AI_VERSION,
    text: String(text ?? "").trim(),
    references: Array.isArray(references) ? references : [],
    confidence: ["low", "medium", "high", "unknown"].includes(confidence) ? confidence : "unknown",
    limitations: Array.isArray(limitations) ? limitations : [],
    generatedAt,
  };
}
