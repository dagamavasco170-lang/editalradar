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

  it("normalizes malformed attempts, saved ids and simulations", () => {
    const result = normalizeQuestionProgress({
      attempts: [null, { questionId: "q1", answer: "a", correct: true }, { questionId: 1, answer: "b", correct: true }],
      saved: ["q1", "q1", "", 9],
      simulations: [{ id: "s1", questionIds: ["q1"], correct: 1, total: 1 }, { id: 4 }, { id: "invalid", questionIds: [], correct: 3, total: 2 }],
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

  it("prefers the newest simulation version and caps saved ids", () => {
    const merged = mergeQuestionProgress(
      { simulations: [{ id: "sim-1", questionIds: ["q1"], correct: 1, total: 1, updatedAt: "2026-01-01" }] },
      { simulations: [{ id: "sim-1", questionIds: ["q2"], correct: 0, total: 1, updatedAt: "2026-01-02" }] },
    );
    expect(merged.simulations[0].questionIds).toEqual(["q2"]);
    const oversized = normalizeQuestionProgress({ saved: Array.from({ length: 1200 }, (_, i) => `q${i}`) });
    expect(oversized.saved).toHaveLength(1000);
    expect(oversized.saved[0]).toBe("q200");
  });

  it("handles invalid storage JSON safely", () => {
    localStorage.setItem(questionProgressStorageKey("broken"), "{");
    expect(loadQuestionProgress("broken")).toEqual({ attempts: [], saved: [], simulations: [] });
  });
});
