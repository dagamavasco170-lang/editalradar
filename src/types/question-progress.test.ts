import { describe, expect, it } from "vitest";
import {
  createEmptyQuestionProgress,
  isQuestionProgressInput,
  QUESTION_PROGRESS_LIMITS,
  questionProgressStorageKey,
} from "./question-progress.js";

describe("question progress contracts", () => {
  it("keeps per-user and visitor storage namespaces stable", () => {
    expect(questionProgressStorageKey(undefined)).toBe("er-question-progress:visitor");
    expect(questionProgressStorageKey("user-42")).toBe("er-question-progress:user-42");
  });

  it("creates fresh empty collections for every progress record", () => {
    const first = createEmptyQuestionProgress();
    const second = createEmptyQuestionProgress();
    first.saved.push("q1");
    expect(second).toEqual({ attempts: [], saved: [], simulations: [] });
  });

  it("defines the same history caps used by the question bank", () => {
    expect(QUESTION_PROGRESS_LIMITS).toEqual({ attempts: 500, saved: 1000, simulations: 100 });
  });

  it("accepts object payloads and rejects arrays and primitives", () => {
    expect(isQuestionProgressInput({ attempts: [] })).toBe(true);
    expect(isQuestionProgressInput(null)).toBe(false);
    expect(isQuestionProgressInput([])).toBe(false);
    expect(isQuestionProgressInput("invalid")).toBe(false);
  });
});
