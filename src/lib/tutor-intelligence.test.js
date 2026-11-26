import {describe,it,expect} from "vitest";
import {buildTutorSignals,buildAdaptiveQuestionPlan} from "./tutor-intelligence.js";
describe("inteligência do tutor adaptativo",()=>{
 it("identifica temas frágeis e sugere dificuldade inicial",()=>{
  const result=buildTutorSignals({topics:[
   {topic:"Crase",discipline:"Português",attempts:2,accuracy:50,unanswered:3,questionCount:8,due:true},
   {topic:"Concordância",discipline:"Português",attempts:6,accuracy:90,unanswered:0,questionCount:8,due:false}
  ]});
  expect(result.topics[0]).toMatchObject({topic:"Crase",suggestedDifficulty:"Fácil",status:"Atenção"});
  expect(result.topics[1].suggestedDifficulty).toBe("Difícil");
 });
 it("calcula indicador de prontidão com métricas de cobertura e consistência",()=>{
  const result=buildTutorSignals({topics:[{topic:"A",attempts:5,accuracy:80,questionCount:10,unanswered:5,due:false}],weeklyProgress:[{attempts:1},{attempts:0}]});
  expect(result).toMatchObject({overallAccuracy:80,coverage:50,consistency:50,readiness:62});
 });
});

 it("monta plano de recuperação por assunto, revisão vencida e nível recomendado",()=>{
  const questions=[{id:"wrong",discipline:"Português",topic:"Crase",difficulty:"Médio"},{id:"new",discipline:"Português",topic:"Crase",difficulty:"Fácil"},{id:"strong",discipline:"Direito",topic:"Princípios",difficulty:"Difícil"}];
  const plan=buildAdaptiveQuestionPlan({questions,latestAttempts:{wrong:{correct:false,at:"2026-11-24T12:00:00Z"},strong:{correct:true,at:"2026-11-25T12:00:00Z"}},now:Date.parse("2026-11-26T12:00:00Z")});
  expect(plan[0]).toMatchObject({id:"wrong",due:true,level:"Fácil"});
  expect(plan.find(row=>row.id==="new")).toMatchObject({level:"Fácil",due:true});
 });
