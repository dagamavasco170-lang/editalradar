import {describe,it,expect} from "vitest";
import {buildAdaptiveStudySessions,buildDailyAdaptiveGoals} from "./adaptive-study-plan.js";
const questions=[{id:"q1",discipline:"Português"},{id:"q2",discipline:"Direito"}];
describe("plano adaptativo",()=>{
 it("redistribui minutos para matéria com desempenho fraco e preserva carga",()=>{
  const result=buildAdaptiveStudySessions({subjects:["Português","Direito"],questions,hours:5,days:["Seg","Ter"],attempts:[{questionId:"q1",correct:false,at:"2026-11-26"},{questionId:"q2",correct:true,at:"2026-11-26"}]});
  const sumFor=subject=>result.filter(row=>row.subject===subject).reduce((sum,row)=>sum+row.minutes,0);
  expect(result.reduce((sum,row)=>sum+row.minutes,0)).toBe(300);
  expect(sumFor("Português")).toBeGreaterThan(sumFor("Direito"));
 });
 it("calculates daily goals from the redistributed sessions",()=>{
  const sessions=[{day:"Seg",minutes:60,subject:"A"},{day:"Seg",minutes:30,subject:"B"},{day:"Ter",minutes:45,subject:"A"}];
  expect(buildDailyAdaptiveGoals({sessions,days:["Seg","Ter"]})).toEqual([{day:"Seg",minutes:90,subjects:["A","B"],sessions:2},{day:"Ter",minutes:45,subjects:["A"],sessions:1}]);
 });
});
