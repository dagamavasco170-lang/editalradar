import {describe,expect,it} from "vitest";
import {buildPerformanceReport} from "./performance-report.js";
const questions=[
 {id:"q1",discipline:"Português",topic:"Crase"},
 {id:"q2",discipline:"Português",topic:"Crase"},
 {id:"q3",discipline:"Direito",topic:"Atos administrativos"},
 {id:"q4",discipline:"Direito",topic:"Poderes"}
];
describe("relatório avançado de desempenho",()=>{
 it("usa somente a tentativa mais recente por questão para medir domínio",()=>{
  const report=buildPerformanceReport({questions,now:Date.parse("2026-11-26T12:00:00Z"),attempts:[
   {questionId:"q1",correct:false,at:"2026-11-20T10:00:00Z"},
   {questionId:"q1",correct:true,at:"2026-11-21T10:00:00Z"},
   {questionId:"q2",correct:false,at:"2026-11-22T10:00:00Z"},
   {questionId:"q3",correct:true,at:"2026-11-23T10:00:00Z"}
  ]});
  const crase=report.byTopic.find(row=>row.topic==="Crase");
  expect(crase).toMatchObject({answered:2,correct:1,wrong:1,accuracy:50,questionCount:2});
  expect(report.summary).toMatchObject({answered:3,accuracy:67,coverage:75,weakTopics:1});
  expect(report.weakTopics[0].topic).toBe("Crase");
 });
 it("não classifica assunto como forte com uma única resposta",()=>{
  const report=buildPerformanceReport({questions,attempts:[{questionId:"q3",correct:true}]});
  expect(report.strongestTopics).toHaveLength(0);
 });
 it("calcula atividade diária sem fabricar tentativas",()=>{
  const now=Date.parse("2026-11-26T12:00:00Z");
  const report=buildPerformanceReport({questions,now,attempts:[
   {questionId:"q1",correct:true,at:"2026-11-26T09:00:00Z"},
   {questionId:"q2",correct:false,at:"2026-11-26T10:00:00Z"},
   {questionId:"q3",correct:true,at:"2026-11-10T10:00:00Z"}
  ]});
  const today=report.trend.find(day=>day.date==="2026-11-26");
  expect(today).toMatchObject({attempts:2,correct:1,accuracy:50});
  expect(report.trend.reduce((sum,day)=>sum+day.attempts,0)).toBe(2);
 });
 it("retorna estado vazio de forma segura",()=>{
  const report=buildPerformanceReport();
  expect(report.summary).toEqual({answered:0,accuracy:0,coverage:0,weakTopics:0,strongTopics:0});
  expect(report.trend).toHaveLength(7);
 });
});
