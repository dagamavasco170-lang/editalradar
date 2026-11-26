import {describe,expect,it} from "vitest";
import {buildStudySessions} from "./study-plan";
describe("planejamento de estudos",()=>{
 it("distribui todos os minutos entre os dias escolhidos",()=>{
  const sessions=buildStudySessions(8,["Seg","Qua","Sex"]);
  expect(sessions.reduce((n,s)=>n+s.minutes,0)).toBe(480);
  expect(sessions).toHaveLength(3);
 });
 it("prioriza matérias relacionadas a cargos policiais",()=>{
  expect(buildStudySessions(10,["Seg","Ter"],"Soldado da Polícia Militar")[0].subject).toBe("Direito Constitucional");
 });
 it("rejeita plano sem dias de estudo",()=>{
  expect(()=>buildStudySessions(10,[])).toThrow("Selecione ao menos um dia");
 });
});
