import { beforeEach, describe, expect, it } from "vitest";
import {
  loadQuestionProgress,
  normalizeQuestionProgress,
  questionBank,
  questionProgressStorageKey
} from "./question-bank.js";

describe("banco de questões", () => {
  beforeEach(() => localStorage.clear());

  it("oferece questões autorais em cinco disciplinas com metadados de dificuldade", () => {
    expect(questionBank.length).toBeGreaterThanOrEqual(25);
    expect(new Set(questionBank.map((question) => question.discipline))).toEqual(new Set([
      "Língua Portuguesa",
      "Raciocínio lógico",
      "Direito Constitucional",
      "Direito Administrativo",
      "Informática"
    ]));
    expect(questionBank.every((question) => question.topic && question.board && question.difficulty)).toBe(true);
    expect(new Set(questionBank.map((question) => question.id)).size).toBe(questionBank.length);
  });

  it("separa o histórico de questões por conta e por visitante", () => {
    expect(questionProgressStorageKey(null)).toBe("er-question-progress:visitor");
    expect(questionProgressStorageKey("user-1")).toBe("er-question-progress:user-1");
    localStorage.setItem(questionProgressStorageKey("user-1"), JSON.stringify({
      attempts: [{ questionId: "p1", answer: "certo", correct: true }],
      saved: ["p1"]
    }));

    expect(loadQuestionProgress("user-1").saved).toEqual(["p1"]);
    expect(loadQuestionProgress("user-2")).toEqual({ attempts: [], saved: [] });
  });

  it("normaliza dados corrompidos, duplicidades e limita o histórico armazenado", () => {
    const normalized = normalizeQuestionProgress({
      attempts: [
        null,
        { questionId: "p1", answer: "certo", correct: true },
        { questionId: 2, answer: "a", correct: true },
        { questionId: "p2", answer: "b", correct: "sim" }
      ],
      saved: ["p1", "p1", 3, "p2"]
    });

    expect(normalized.attempts).toHaveLength(1);
    expect(normalized.saved).toEqual(["p1", "p2"]);
    expect(normalizeQuestionProgress(null)).toEqual({ attempts: [], saved: [] });
    expect(normalizeQuestionProgress({
      attempts: Array.from({ length: 520 }, (_, i) => ({
        questionId: "q" + i, answer: "a", correct: true
      }))
    }).attempts).toHaveLength(500);
  });

  it("recupera com segurança um armazenamento JSON inválido", () => {
    localStorage.setItem(questionProgressStorageKey("broken"), "{");
    expect(loadQuestionProgress("broken")).toEqual({ attempts: [], saved: [] });
  });
});
