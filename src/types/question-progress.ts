import type {
  QuestionAttemptRecord,
  QuestionProgressInput,
  QuestionProgressRecord,
  QuestionSimulationRecord,
} from "./question-bank.js";

export type { QuestionAttemptRecord, QuestionProgressInput, QuestionProgressRecord, QuestionSimulationRecord };

/** Persisted progress limits used by question-bank normalization and merge. */
export const QUESTION_PROGRESS_LIMITS = {
  attempts: 500,
  saved: 1000,
  simulations: 100,
} as const;

/** Stable local-storage namespace for per-user question progress. */
export function questionProgressStorageKey(userId: string | null | undefined): string {
  return `er-question-progress:${userId || "visitor"}`;
}

/** Empty normalized value is shared as a factory to avoid mutable singleton arrays. */
export function createEmptyQuestionProgress(): QuestionProgressRecord {
  return { attempts: [], saved: [], simulations: [] };
}

/** Narrow input at the persisted-data boundary without assuming a valid object. */
export function isQuestionProgressInput(value: unknown): value is QuestionProgressInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
