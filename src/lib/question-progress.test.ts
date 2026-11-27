import { beforeEach, describe, expect, it } from "vitest";
import {
  loadQuestionProgress,
  mergeQuestionProgress,
  normalizeQuestionProgress,
  questionProgressStorageKey,
  saveQuestionProgress,
} from "./question-progress.js";

describe("typed question progress service", () => {
  beforeEach(() => localStorage.clear());

  it("isolates progress by user and visitor", () => {
    expect(questionProgressStorageKey(null)).toBe("er-question-progress:visitor");
    saveQuestionProgress("u1", { saved: ["q1"] });
    expect(loadQuestionProgress("u1").saved).toEqual(["q1"]);
    expect(loadQuestionProgress("u2")).toEqual({ attempts: [], saved: [], simulations: [] });
  });

  it("normalizes malformed attempts and simulations", () => {
    const result = normalizeQuestionProgress({
      attempts: [null, { questionId: "q1", answer: "a", correct: true }, { questionId: 1, answer: "b", correct: true }],
      saved: ["q1", "q1", 9],
      simulations: [{ id: "s1", questionIds: ["q1"], correct: 1, total: 1 }, { id: 4 }],
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.saved).toEqual(["q1"]);
    expect(result.simulations).toHaveLength(1);
  });

  it("merges saved questions and preserves distinct attempts while deduplicating", () => {
    const result = mergeQuestionProgress(
      { attempts: [{ id: "attempt-1", questionId: "q1", answer: "a", correct: false, at: "2026-01-01" }], saved: ["q1"] },
      { attempts: [{ id: "attempt-1", questionId: "q1", answer: "b", correct: true, at: "2026-01-02" }, { questionId: "q2", answer: "c", correct: true, at: "2026-01-03" }], saved: ["q2"] },
    );
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.find((attempt) => attempt.id === "attempt-1")?.correct).toBe(true);
    expect(result.saved).toEqual(["q1", "q2"]);
  });

  it("handles invalid storage JSON safely", () => {
    localStorage.setItem(questionProgressStorageKey("broken"), "{");
    expect(loadQuestionProgress("broken")).toEqual({ attempts: [], saved: [], simulations: [] });
  });
});
