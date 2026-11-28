import { describe, expect, it } from "vitest";
import { buildAdaptiveTutorState, selectAdaptiveQuestion, evaluateAdaptiveAnswer, recordAdaptiveAnswer, buildTutorNextStep } from "./adaptive-tutor.js";

const questions = [
 { id:"q1", subject:"Direito Administrativo", topicKey:"legalidade", options:["Certo","Errado"], answerIndex:0, explanation:"Legalidade significa atuação conforme a lei." },
 { id:"q2", subject:"Direito Administrativo", topicKey:"legalidade", options:["A","B"], answerIndex:1, explanation:"Explicação suficientemente completa." },
 { id:"q3", subject:"Português", topicKey:"crase", options:["A","B"], answerIndex:0, explanation:"Explicação suficientemente completa." },
];
const attempts = Array.from({length:5}, (_,i)=>({questionId:"past"+i,topicKey:"legalidade",subject:"Direito Administrativo",correct:i===4,timestamp:new Date(Date.UTC(2026,0,i+1)).toISOString()}));

describe("Radar AI adaptive tutor core",()=>{
 it("builds topic accuracy and prioritizes weak available topics",()=>{
  const state=buildAdaptiveTutorState({questions,attempts,now:new Date("2026-01-10T00:00:00Z")});
  expect(state.topicMap.legalidade.mastery).toBe("needs-review");
  expect(selectAdaptiveQuestion(state)?.topicKey).toBe("legalidade");
  expect(buildTutorNextStep(state).topicKey).toBe("legalidade");
 });
 it("selects an unused question and respects topic filter",()=>{
  const state=buildAdaptiveTutorState({questions,attempts});
  expect(selectAdaptiveQuestion(state,{topicKey:"crase"})?.id).toBe("q3");
  expect(selectAdaptiveQuestion(state,{excludedQuestionIds:["q3"],topicKey:"crase"})).toBeNull();
 });
 it("checks answer and emits feedback with explanation and reference",()=>{
  const q={...questions[0],sourceUrl:"https://example.com/ref"};
  expect(evaluateAdaptiveAnswer(q,0).correct).toBe(true);
  const {state,result}=recordAdaptiveAnswer(buildAdaptiveTutorState({questions:[q]}),q,1,{timestamp:"2026-11-28T00:00:00Z"});
  expect(result.correct).toBe(false);
  expect(result.feedback.correctOption).toBe("Certo");
  expect(state.attempts).toHaveLength(1);
 });
 it("rejects invalid answer indexes",()=>{
  expect(evaluateAdaptiveAnswer(questions[0],99).valid).toBe(false);
 });
});
