import { describe, expect, it } from "vitest";
import { buildAdaptiveQuestionQueue } from "./adaptive-question-queue.ts";

describe("fila adaptativa TypeScript", () => {
  const questions = [
    { id: "q1", discipline: "Português", topic: "Crase" },
    { id: "q2", discipline: "Português", topic: "Crase" },
    { id: "q3", discipline: "Direito", topic: "Constituição" },
    { id: "q4", discipline: "Direito", topic: "Constituição" },
  ];

  it("inclui questões erradas e não inclui as acertadas", () => {
    const result = buildAdaptiveQuestionQueue({
      questions,
      latestAttempts: { q1: { correct: false }, q2: { correct: true }, q3: { correct: false } },
    });
    expect(result).toContain("q1");
    expect(result).toContain("q3");
    expect(result).not.toContain("q2");
  });

  it("deixa fila vazia quando todas as questões foram acertadas recentemente", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const latestAttempts = Object.fromEntries(questions.map((q) => [q.id, { correct: true, at: new Date(now).toISOString() }]));
    expect(buildAdaptiveQuestionQueue({ questions, latestAttempts, now })).toEqual([]);
  });

  it("mantém questões sem resposta na fila de revisão inicial", () => {
    expect(buildAdaptiveQuestionQueue({ questions, now: Date.parse("2026-11-27T12:00:00Z") })).toHaveLength(4);
  });

  it("não altera questões nem histórico recebidos", () => {
    const inputQuestions = questions.map((q) => ({ ...q }));
    const attempts = [{ questionId: "q1", correct: false, at: "2026-11-26T12:00:00Z" }];
    const originalQuestions = structuredClone(inputQuestions);
    const originalAttempts = structuredClone(attempts);
    buildAdaptiveQuestionQueue({ questions: inputQuestions, attempts, now: Date.parse("2026-11-27T12:00:00Z") });
    expect(inputQuestions).toEqual(originalQuestions);
    expect(attempts).toEqual(originalAttempts);
  });
});
