import type { JsonValue } from "../types/domain.js";
import type {
  QuestionAttemptRecord,
  QuestionProgressInput,
  QuestionProgressRecord,
  QuestionSimulationRecord,
} from "../types/question-bank.js";
import { createEmptyQuestionProgress, QUESTION_PROGRESS_LIMITS, questionProgressStorageKey } from "../types/question-progress.js";
import { safeGetItem, safeSetItem } from "./storage.js";
import { parseStoredJson, isJsonRecord, stringifyStoredJson } from "./json-storage.js";

export { questionProgressStorageKey };

/** Normalize untrusted persisted progress; invalid rows and oversized collections are discarded. */
export function normalizeQuestionProgress(value: unknown): QuestionProgressRecord {
  if (!isQuestionProgressInput(value)) return createEmptyQuestionProgress();
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isQuestionAttempt).slice(-QUESTION_PROGRESS_LIMITS.attempts)
    : [];
  const saved = Array.isArray(value.saved)
    ? [...new Set(value.saved.filter((id): id is string => typeof id === "string" && id.length > 0))]
        .slice(-QUESTION_PROGRESS_LIMITS.saved)
    : [];
  const simulations = Array.isArray(value.simulations)
    ? value.simulations.filter(isQuestionSimulation).slice(-QUESTION_PROGRESS_LIMITS.simulations)
    : [];
  return { attempts, saved, simulations };
}

function isQuestionProgressInput(value: unknown): value is QuestionProgressInput {
  return isJsonRecord(value);
}

function isQuestionAttempt(value: unknown): value is QuestionAttemptRecord {
  return isJsonRecord(value)
    && typeof value.questionId === "string"
    && value.questionId.length > 0
    && typeof value.answer === "string"
    && typeof value.correct === "boolean"
    && (value.at === undefined || typeof value.at === "string")
    && (value.id === undefined || typeof value.id === "string");
}

function isQuestionSimulation(value: unknown): value is QuestionSimulationRecord {
  return isJsonRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && Array.isArray(value.questionIds)
    && value.questionIds.every((id) => typeof id === "string")
    && Number.isFinite(value.correct)
    && Number.isFinite(value.total)
    && value.correct >= 0
    && value.total >= 0
    && value.correct <= value.total;
}

function timestampOf(record: Record<string, unknown>): string {
  for (const field of ["updatedAt", "updated_at", "at", "createdAt", "created_at"]) {
    if (typeof record[field] === "string") return record[field] as string;
  }
  return "";
}

/** Merge local and remote progress, retaining the newest attempt/simulation per identity. */
export function mergeQuestionProgress(remoteValue: unknown, localValue: unknown): QuestionProgressRecord {
  const remote = normalizeQuestionProgress(remoteValue);
  const local = normalizeQuestionProgress(localValue);
  const attempts = new Map<string, QuestionAttemptRecord>();
  [...remote.attempts, ...local.attempts].forEach((attempt) => {
    const key = attempt.id || [attempt.questionId, attempt.at, attempt.answer].join("|");
    const previous = attempts.get(key);
    if (!previous || String(attempt.at || "") >= String(previous.at || "")) attempts.set(key, attempt);
  });
  const simulations = new Map<string, QuestionSimulationRecord>();
  [...remote.simulations, ...local.simulations].forEach((simulation) => {
    const previous = simulations.get(simulation.id);
    if (!previous || timestampOf(simulation) >= timestampOf(previous)) simulations.set(simulation.id, simulation);
  });
  return {
    attempts: [...attempts.values()].sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-QUESTION_PROGRESS_LIMITS.attempts),
    saved: [...new Set([...remote.saved, ...local.saved])].slice(-QUESTION_PROGRESS_LIMITS.saved),
    simulations: [...simulations.values()].slice(-QUESTION_PROGRESS_LIMITS.simulations),
  };
}

/** Read per-user progress defensively from local storage. */
export function loadQuestionProgress(userId: string | null | undefined): QuestionProgressRecord {
  const raw = safeGetItem(questionProgressStorageKey(userId));
  const parsed = parseStoredJson<JsonValue>(raw, null);
  return normalizeQuestionProgress(parsed);
}

/** Persist progress using best-effort storage semantics. */
export function saveQuestionProgress(userId: string | null | undefined, value: unknown): boolean {
  const normalized = normalizeQuestionProgress(value);
  const serialized = stringifyStoredJson(normalized);
  if (serialized === null) return false;
  return safeSetItem(questionProgressStorageKey(userId), serialized);
}
