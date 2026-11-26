import {describe,it,expect} from "vitest";
import {buildTutorSignals,buildAdaptiveQuestionPlan,buildConfusionPatterns,buildPersonalizedRecoveryAdvice} from "./tutor-intelligence.js";
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

import {buildAdaptiveTutorFeedback} from "./tutor-intelligence.js";
it("feedback reduz nível após erro e sobe após sequência de três acertos",()=>{
 const error=buildAdaptiveTutorFeedback({correct:false,currentLevel:"Médio"});
 expect(error).toMatchObject({progression:"recover",nextLevel:"Fácil"});
 const success=buildAdaptiveTutorFeedback({correct:true,recentTopicAttempts:[{correct:true},{correct:true}],currentLevel:"Médio"});
 expect(success).toMatchObject({progression:"progress",streak:3,nextLevel:"Difícil"});
});

it("detecta padrões de erro repetido e recomenda recuperação baseada no histórico",()=>{
 const questions=[{id:"a",topic:"Crase",discipline:"Português"},{id:"b",topic:"Crase",discipline:"Português"},{id:"c",topic:"Crase",discipline:"Português"}];
 const attempts=[{questionId:"a",correct:false},{questionId:"b",correct:false},{questionId:"c",correct:false}];
 const pattern=buildConfusionPatterns({questions,attempts,topic:"Crase",discipline:"Português"});
 expect(pattern).toMatchObject({attempts:3,wrong:3,accuracy:0,recentWrong:3});
 expect(pattern.patterns.map(item=>item.id)).toContain("error-streak");
 expect(buildPersonalizedRecoveryAdvice({pattern}).join(" ")).toContain("questão Fácil");
});
