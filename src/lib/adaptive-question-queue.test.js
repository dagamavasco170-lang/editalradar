import { describe, expect, it } from "vitest";
import { buildAdaptiveQuestionQueue } from "./adaptive-question-queue.js";

describe("fila adaptativa de questões", () => {
  const questions = [
    { id: "q1", discipline: "Português" },
    { id: "q2", discipline: "Português" },
    { id: "q3", discipline: "Direito" },
    { id: "q4", discipline: "Direito" },
    { id: "q5", discipline: "Direito" },
  ];
  it("prioriza questões erradas e deixa acertadas fora da fila", () => {
    expect(buildAdaptiveQuestionQueue({ questions, latestAttempts: {
      q1: { correct: false }, q2: { correct: true }, q3: { correct: false }
    }})).toEqual(["q1", "q3", "q4", "q5"]);
  });
  it("retorna lista vazia quando tudo foi acertado", () => {
    expect(buildAdaptiveQuestionQueue({ questions, latestAttempts: {
      q1: { correct: true }, q2: { correct: true }, q3: { correct: true }, q4: { correct: true }, q5: { correct: true }
    }})).toEqual([]);
  });
});
