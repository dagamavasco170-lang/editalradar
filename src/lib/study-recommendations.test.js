import { describe, expect, it } from "vitest";
import { buildStudyRecommendations } from "./study-recommendations.ts";
const questions=[{id:"q1",discipline:"Português",topic:"Crase"},{id:"q2",discipline:"Português",topic:"Crase"},{id:"q3",discipline:"Direito",topic:"Direitos fundamentais"},{id:"q4",discipline:"Direito",topic:"Direitos fundamentais"},{id:"q5",discipline:"Direito",topic:"Direitos fundamentais"}];
describe("recomendações de estudo por assunto",()=>{
 it("identifica assuntos com erros, domínio e pendências",()=>{
  const result=buildStudyRecommendations({questions,attempts:[{questionId:"q1",correct:false},{questionId:"q2",correct:false},{questionId:"q3",correct:true}]});
  expect(result[0]).toMatchObject({topic:"Crase",discipline:"Português",attempts:2,wrong:2,accuracy:0,unanswered:0});
  expect(result[1]).toMatchObject({topic:"Direitos fundamentais",attempts:1,wrong:0,accuracy:100,unanswered:2});
 });
 it("usa o resultado mais recente por questão e respeita limite",()=>{
  const result=buildStudyRecommendations({questions,attempts:[{questionId:"q1",correct:false},{questionId:"q1",correct:true},{questionId:"q3",correct:false}],limit:1});
  expect(result).toHaveLength(1); expect(result[0].topic).toBe("Direitos fundamentais"); expect(result[0].wrong).toBe(1);
 });
 it("retorna vazio sem questões",()=>expect(buildStudyRecommendations()).toEqual([]));
});
