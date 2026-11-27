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
    }})).toEqual(["q3", "q1", "q4", "q5"]);
  });
  it("retorna lista vazia quando tudo foi acertado", () => {
    expect(buildAdaptiveQuestionQueue({ questions, latestAttempts: {
      q1: { correct: true }, q2: { correct: true }, q3: { correct: true }, q4: { correct: true }, q5: { correct: true }
    }})).toEqual([]);
  });
});

 it("prioriza revisão de assuntos com erro recente e dificuldade recomendada não altera questões",()=>{
  const rows=[{id:"q1",discipline:"Português",topic:"Crase",difficulty:"Médio"},{id:"q2",discipline:"Direito",topic:"Constituição",difficulty:"Difícil"}];
  expect(buildAdaptiveQuestionQueue({questions:rows,latestAttempts:{q1:{correct:false,at:"2026-11-25"}}})).toEqual(["q1","q2"]);
 });

// Prioridade da fila: questões erradas, assuntos vencidos e menor precisão.
it("prioriza assuntos vencidos e com baixo desempenho",()=>{
 const questions=[{id:"weak",discipline:"Português",topic:"Crase"},{id:"strong",discipline:"Direito",topic:"Constituição"}];
 const now=Date.parse("2026-11-26T12:00:00Z");
 const attempts=Array.from({length:5},(_,i)=>({questionId:"strong",correct:true,at:new Date(now-(4-i)*86400000).toISOString()}));
 expect(buildAdaptiveQuestionQueue({questions,attempts,now})).toEqual(["weak"]);
});
