import { describe, expect, it } from "vitest";
import { buildQuestionProgressMetrics } from "./question-progress-metrics.ts";
const questions=[{id:"q1",discipline:"Português"},{id:"q2",discipline:"Direito"},{id:"q3",discipline:"Português"}];
describe("métricas do progresso em questões",()=>{
 it("calcula acertos, tentativas, taxa e questões únicas",()=>{
  const metrics=buildQuestionProgressMetrics({questions,attempts:[{questionId:"q1",correct:true},{questionId:"q2",correct:false},{questionId:"q1",correct:false}]});
  expect(metrics).toEqual({totalAttempts:3,totalCorrect:1,accuracy:33,uniqueAnswered:2,byDiscipline:[{discipline:"Português",attempts:2,correct:1,uniqueAnswered:1,accuracy:50},{discipline:"Direito",attempts:1,correct:0,uniqueAnswered:1,accuracy:0}]});
 });
 it("ordena disciplinas por volume de tentativas e depois nome",()=>{
  const metrics=buildQuestionProgressMetrics({questions,attempts:[{questionId:"q2",correct:true},{questionId:"q3",correct:false},{questionId:"q1",correct:true}]});
  expect(metrics.byDiscipline.map(row=>row.discipline)).toEqual(["Português","Direito"]);
 });
 it("ignora tentativas sem identificador e tolera disciplina desconhecida",()=>{
  const metrics=buildQuestionProgressMetrics({attempts:[null,{correct:true},{questionId:"missing",correct:false}]});
  expect(metrics.totalAttempts).toBe(1);
  expect(metrics.byDiscipline).toEqual([{discipline:"Outras",attempts:1,correct:0,uniqueAnswered:1,accuracy:0}]);
 });
 it("retorna métricas zeradas quando não há tentativas",()=>{
  expect(buildQuestionProgressMetrics()).toEqual({totalAttempts:0,totalCorrect:0,accuracy:0,uniqueAnswered:0,byDiscipline:[]});
 });
});
