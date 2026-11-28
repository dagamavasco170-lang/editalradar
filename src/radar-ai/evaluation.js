/**
 * Lightweight, deterministic evaluation helpers for the Radar AI pipeline.
 * These checks measure structure and provenance, not factual correctness.
 */
export function evaluateAnswer(answer, retrievedSources = []) {
  const text = String(answer?.text ?? "").trim();
  const references = Array.isArray(answer?.references) ? answer.references : [];
  const issues = [];
  if (!text) issues.push("empty-answer");
  if (!references.length && retrievedSources.length) issues.push("missing-answer-references");
  const sourceUrls = new Set(retrievedSources.map(source => source.url).filter(Boolean));
  const unmatchedReferences = references.filter(reference => !reference?.url || (sourceUrls.size && !sourceUrls.has(reference.url)));
  if (unmatchedReferences.length) issues.push("unmatched-references");
  const evidenceCoverage = retrievedSources.length ? references.length / retrievedSources.length : 0;
  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      hasText: Boolean(text),
      referenceCount: references.length,
      retrievedSourceCount: retrievedSources.length,
      matchedReferenceCount: references.length - unmatchedReferences.length,
      evidenceCoverage: Math.min(1, evidenceCoverage),
    },
    limitations: ["This evaluation checks answer structure and source matching only; it does not determine factual accuracy or reasoning quality."],
  };
}

export function evaluateQuestion(question) {
  const errors = [];
  if (!question || typeof question !== "object") return { passed: false, issues: ["invalid-question-object"] };
  if (!String(question.statement ?? "").trim()) errors.push("missing-statement");
  if (!Array.isArray(question.options) || question.options.length !== 5) errors.push("wrong-option-count");
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 4) errors.push("invalid-answer-key");
  if (!String(question.explanation ?? "").trim()) errors.push("missing-explanation");
  if (!Array.isArray(question.references) || question.references.length === 0) errors.push("missing-sources");
  return { passed: errors.length === 0, issues: errors, limitations: ["Structural checks cannot certify originality, factual accuracy, or answer-key correctness."] };
}
