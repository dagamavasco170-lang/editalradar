import { describe, expect, it } from "vitest";
import { buildQuestionBankView } from "./question-bank-view.ts";
import type { QuestionBankItem } from "../types/question-bank.js";

const questions: QuestionBankItem[] = [
  { id: "q1", discipline: "Português", topic: "Crase", board: "FGV", difficulty: "Fácil", prompt: "Crase ocorre aqui?", options: [["Certo", "certo"], ["Errado", "errado"]], answer: "certo", explanation: "Explicação", origin: "authorial" },
  { id: "q2", discipline: "Direito", topic: "Constituição", board: "Cebraspe", difficulty: "Avançada", prompt: "Julgue o item.", options: [["Certo", "certo"], ["Errado", "errado"]], answer: "errado", explanation: "Explicação", origin: "authorial", examYear: 2024 },
];

describe("question bank view", () => {
  it("applies search and filters while returning count metadata", () => {
    const view = buildQuestionBankView({ questions, questionSearch: "crase", discipline: "Todas" });
    expect(view.base.map((q) => q.id)).toEqual(["q1"]);
    expect(view.filtered.map((q) => q.id)).toEqual(["q1"]);
    expect(view.counts.all).toBe(1);
  });

  it("supports unanswered, saved and origin collections", () => {
    const attempts = { q1: { correct: true } };
    expect(buildQuestionBankView({ questions, latestAttempts: attempts, collection: "unanswered" }).filtered.map(q => q.id)).toEqual(["q2"]);
    expect(buildQuestionBankView({ questions, savedQuestions: new Set(["q2"]), collection: "saved" }).filtered.map(q => q.id)).toEqual(["q2"]);
    expect(buildQuestionBankView({ questions, originFilter: "EditalRadar" }).base).toHaveLength(2);
  });

  it("sorts by year and difficulty with stable fallback order", () => {
    expect(buildQuestionBankView({ questions, sortBy: "recent" }).filtered.map(q => q.id)).toEqual(["q2", "q1"]);
    expect(buildQuestionBankView({ questions, sortBy: "difficulty" }).filtered.map(q => q.id)).toEqual(["q2", "q1"]);
  });
});
