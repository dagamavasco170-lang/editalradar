import { describe, expect, it } from "vitest";
import { evaluateAdaptiveStudySession } from "./adaptive-study-session-evaluation.ts";

describe("avaliação de sessão adaptativa", () => {
 const session={discipline:"Português",topic:"Crase",questionIds:["1","2","3"]};
 it("ignora respostas fora da sessão e usa a tentativa mais recente",()=>{
  const result=evaluateAdaptiveStudySession({session,attempts:[
   {questionId:"1",correct:false,at:"2026-01-01"},
   {questionId:"1",correct:true,at:"2026-01-02"},
   {questionId:"2",correct:false,at:"2026-01-03"},
   {questionId:"99",correct:true,at:"2026-01-04"}
  ]});
  expect(result).toMatchObject({planned:3,answered:2,correct:1,wrong:1,unanswered:1,accuracy:50,completion:67,status:"partial"});
 });
 it("classifica sessão completa e recomenda revisão quando acerto é baixo",()=>{
  expect(evaluateAdaptiveStudySession({session,attempts:[{questionId:"1",correct:false},{questionId:"2",correct:true},{questionId:"3",correct:false}]})).toMatchObject({status:"completed",accuracy:33,nextAction:"Revise a teoria e refaça as questões erradas"});
 });
 it("ignora tentativas anteriores ao início da sessão",()=>{
  const result=evaluateAdaptiveStudySession({session:{...session,startedAt:"2026-01-02"},attempts:[{questionId:"1",correct:true,at:"2026-01-01"},{questionId:"2",correct:false,at:"2026-01-03"}]});
  expect(result).toMatchObject({answered:1,correct:0,wrong:1,unanswered:2,accuracy:0});
 });
 it("não divide por zero em sessão vazia",()=>{
  expect(evaluateAdaptiveStudySession({session:{questionIds:[]}})).toMatchObject({planned:0,answered:0,accuracy:0,completion:0,status:"not_started"});
 });
});
