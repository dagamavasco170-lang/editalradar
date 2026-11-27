import {describe,expect,it} from "vitest";
import {buildStudyDiagnostics,buildStudyDiagnosticSummary} from "./study-diagnostics.ts";
const questions=[{id:"1",discipline:"Português",topic:"Crase"},{id:"2",discipline:"Português",topic:"Crase"},{id:"3",discipline:"Direito",topic:"Constitucional"}];
describe("diagnóstico explicável de estudos",()=>{
 it("prioriza assuntos com erros e revisão vencida e explica os motivos",()=>{
  const rows=buildStudyDiagnostics({questions,attempts:[{questionId:"1",correct:false,at:"2026-11-20"},{questionId:"2",correct:false,at:"2026-11-21"}],mastery:[{discipline:"Português",topic:"Crase",due:true}]});
  expect(rows[0]).toMatchObject({topic:"Crase",accuracy:0,status:"urgent",due:true});
  expect(rows[0].reasons).toContain("Revisão espaçada vencida");
  expect(rows[0].nextAction).toContain("Revisar teoria");
 });
 it("usa a tentativa mais recente por questão e não muta os dados",()=>{
  const attempts=[{questionId:"1",correct:false,at:"2026-11-20"},{questionId:"1",correct:true,at:"2026-11-21"}];
  const snapshot=structuredClone(attempts);
  const rows=buildStudyDiagnostics({questions:questions.slice(0,1),attempts});
  expect(rows[0]).toMatchObject({attempts:1,correct:1,wrong:0,accuracy:100});
  expect(attempts).toEqual(snapshot);
 });
 it("resumo agrega métricas e limita prioridades",()=>{
  const rows=buildStudyDiagnostics({questions,attempts:[{questionId:"1",correct:true},{questionId:"2",correct:true},{questionId:"3",correct:false}],limit:1});
  const summary=buildStudyDiagnosticSummary(rows);
  expect(summary).toMatchObject({topics:1,totalQuestions:2,totalAttempts:2,accuracy:100});
  expect(summary.topPriorities).toHaveLength(0);
 });
 it("respeita limite e retorna array vazio sem questões",()=>{
  expect(buildStudyDiagnostics()).toEqual([]);
  expect(buildStudyDiagnostics({questions,limit:0})).toEqual([]);
 });
});
