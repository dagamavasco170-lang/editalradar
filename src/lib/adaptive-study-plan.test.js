import {describe,it,expect} from "vitest";
import {buildAdaptiveStudySessions} from "./adaptive-study-plan.js";
describe("plano adaptativo semanal",()=>{
 it("prioriza disciplina com baixo desempenho",()=>{
  const result=buildAdaptiveStudySessions({subjects:["Português","Direito"],hours:5,days:["Seg","Ter"],attempts:[{questionId:"1",discipline:"Português",correct:false,at:"2026-11-26"},{questionId:"2",discipline:"Direito",correct:true,at:"2026-11-26"}]});
  const sumFor=subject=>result.filter(row=>row.subject===subject).reduce((sum,row)=>sum+row.minutes,0);
  expect(result.reduce((sum,row)=>sum+row.minutes,0)).toBe(300);
  expect(sumFor("Português")).toBeGreaterThan(sumFor("Direito"));
 });
 it("preserva o total e usa os dias escolhidos",()=>{
  const result=buildAdaptiveStudySessions({subjects:["A","B","C"],hours:8,days:["Seg","Qua","Sex"]});
  expect(result.reduce((sum,row)=>sum+row.minutes,0)).toBe(480);
  expect(new Set(result.map(row=>row.day))).toEqual(new Set(["Seg","Qua","Sex"]));
 });
});
