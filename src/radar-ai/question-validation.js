const ALLOWED_DIFFICULTIES = new Set(["easy", "medium", "hard", "very-hard"]);

/** Deterministic structural validation; this does not replace fact-checking or human review. */
export function validateGeneratedQuestion(question) {
  const errors = [];
  if (!question || typeof question !== "object") {
    return { valid: false, errors: ["Question must be an object."] };
  }

  for (const field of ["statement", "subject", "topic", "explanation"]) {
    if (typeof question[field] !== "string" || question[field].trim().length < 12) {
      errors.push(`Field "${field}" must contain at least 12 characters.`);
    }
  }

  if (!Array.isArray(question.options) || question.options.length !== 5) {
    errors.push("Question must contain exactly five options.");
  } else {
    const normalized = question.options.map((option) => String(option).trim().toLocaleLowerCase("pt-BR"));
    if (normalized.some((option) => option.length < 3)) errors.push("Every option must contain at least three characters.");
    if (new Set(normalized).size !== normalized.length) errors.push("Options must be unique.");
  }

  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 4) {
    errors.push("correctIndex must be an integer between 0 and 4.");
  }

  if (!ALLOWED_DIFFICULTIES.has(question.difficulty)) {
    errors.push("difficulty must be one of: easy, medium, hard, very-hard.");
  }

  if (!Array.isArray(question.references) || question.references.length === 0) {
    errors.push("At least one supporting reference is required.");
  } else if (question.references.some((reference) => !reference || typeof reference.title !== "string" || typeof reference.url !== "string")) {
    errors.push("Each reference must include a title and URL.");
  }

  if (question.examBoardStyle && typeof question.examBoardStyle !== "string") {
    errors.push("examBoardStyle must be a string when supplied; it is a style descriptor, not official affiliation.");
  }

  return { valid: errors.length === 0, errors };
}
