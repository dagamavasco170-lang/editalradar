/** Curates training/evaluation examples; it does not train model weights. */
export const TRAINING_TASKS = Object.freeze([
  "tutor-explanation",
  "question-analysis",
  "error-diagnosis",
  "question-generation",
  "study-planning",
]);
export const APPROVED_RIGHTS = new Set([
  "authorized", "permission_granted", "public_domain", "official_publication", "cc_by", "cc_by_sa",
]);
const looksLikePersonalData = (text) => {
  const value = String(text ?? "");
  return /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(value)
    || /\b\d{3}[.]?\d{3}[.]?\d{3}[-]?\d{2}\b/.test(value)
    || /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[- ]?\d{4}\b/.test(value);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validates an example for human-reviewed, rights-cleared training or evaluation. */
export function validateTrainingExample(example) {
  const errors = [];
  if (!isObject(example)) return { valid: false, errors: ["example-must-be-object"] };
  if (typeof example.id !== "string" || !example.id.trim()) errors.push("missing-example-id");
  if (!TRAINING_TASKS.includes(example.task)) errors.push("unsupported-task");
  if (!isObject(example.input)) errors.push("input-must-be-object");
  if (typeof example.target !== "string" || example.target.trim().length < 20) errors.push("target-too-short");
  if (!Array.isArray(example.rubric) || !example.rubric.some((item) => typeof item === "string" && item.trim())) errors.push("missing-rubric");
  if (!Array.isArray(example.references) || !example.references.length) errors.push("missing-references");
  else if (example.references.some((ref) => !ref || typeof ref.title !== "string" || typeof ref.url !== "string" || !/^https:\/\//i.test(ref.url))) errors.push("invalid-reference");
  if (example.reviewStatus !== "approved") errors.push("not-human-approved");
  if (!APPROVED_RIGHTS.has(example.rightsStatus)) errors.push("rights-not-cleared");
  if (looksLikePersonalData(JSON.stringify({ input: example.input, target: example.target }))) errors.push("possible-personal-data");
  if (example.metadata !== undefined && !isObject(example.metadata)) errors.push("metadata-must-be-object");
  return { valid: errors.length === 0, errors };
}

/** Exports only explicitly approved, rights-cleared examples; preserves no student identifiers. */
export function buildApprovedTrainingDataset(examples = []) {
  const included = [];
  const rejected = [];
  for (const example of examples) {
    const result = validateTrainingExample(example);
    if (result.valid) included.push(example);
    else rejected.push({ id: example?.id ?? null, errors: result.errors });
  }
  return { examples: included, rejected, counts: { input: examples.length, approved: included.length, rejected: rejected.length } };
}

export function summarizeTrainingDataset(examples = []) {
  const summary = {};
  for (const task of TRAINING_TASKS) summary[task] = 0;
  for (const example of examples) {
    if (TRAINING_TASKS.includes(example?.task)) summary[example.task] += 1;
  }
  return summary;
}
