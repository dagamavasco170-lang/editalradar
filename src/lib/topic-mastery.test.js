import { describe, expect, it } from "vitest";
import { buildTopicMastery, buildWeeklyStudyProgress } from "./topic-mastery.js";

const questions=[
 {id:"a",discipline:"Português",topic:"Crase"},
 {id:"b",discipline:"Português",topic:"Crase"},
 {id:"c",discipline:"Direito",topic:"Princípios"}
];
describe("domínio por assunto e revisão espaçada",()=>{
 it("classifica assuntos e agenda revisões conforme desempenho",()=>{
  const now=Date.parse("2026-11-26T12:00:00Z");
  const result=buildTopicMastery({questions,now,attempts:[
   {questionId:"a",correct:true,at:"2026-11-25T12:00:00Z"},
   {questionId:"b",correct:false,at:"2026-11-25T12:00:00Z"}
  ]});
  expect(result.find(row=>row.topic==="Crase")).toMatchObject({attempts:2,accuracy:50,mastery:"developing",intervalDays:1,due:true});
  expect(result.find(row=>row.topic==="Princípios")).toMatchObject({mastery:"starting",unanswered:1,due:true});
 });
 it("usa a tentativa mais recente por questão",()=>{
  const result=buildTopicMastery({questions:questions.slice(0,1),now:Date.parse("2026-11-26T12:00:00Z"),attempts:[
   {questionId:"a",correct:false,at:"2026-11-20T12:00:00Z"},
   {questionId:"a",correct:true,at:"2026-11-25T12:00:00Z"}
  ]});
  expect(result[0]).toMatchObject({attempts:1,correct:1,wrong:0,accuracy:100,intervalDays:7,mastery:"starting"});
 });
 it("resume os últimos sete dias por data",()=>{
  const now=Date.parse("2026-11-26T12:00:00Z");
  const result=buildWeeklyStudyProgress({now,attempts:[{questionId:"a",correct:true,at:"2026-11-26T10:00:00Z"}]});
  expect(result).toHaveLength(7);
  expect(result[6]).toMatchObject({date:"2026-11-26",attempts:1,correct:1});
 });
});
