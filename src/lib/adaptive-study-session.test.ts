import {describe,expect,it} from "vitest";
import {buildAdaptiveStudySessionPlan} from "./adaptive-study-session.ts";
describe("plano de sessão adaptativa",()=>{
 const diagnostics=[{discipline:"Português",topic:"Crase",priority:88,status:"urgent" as const,accuracy:30,attempts:4,wrong:3,unanswered:2,due:true,nextAction:"Revisar a teoria",reasons:["Erros recentes"]}];
 const questions=[{id:1,discipline:"Português",topic:"Crase",difficulty:"Fácil"},{id:2,discipline:"Português",topic:"Crase",difficulty:"Médio"},{id:3,discipline:"Português",topic:"Crase",difficulty:"Difícil"}];
 it("gera sessão urgente e seleciona questões erradas ou não respondidas",()=>{const plans=buildAdaptiveStudySessionPlan({diagnostics,questions,latestAttempts:{"1":{correct:false},"2":{correct:true}}});expect(plans[0]).toMatchObject({topic:"Crase",status:"urgent",durationMinutes:25,targetDifficulty:"Fácil",questionIds:["1","3"]});});
 it("não cria plano vazio e respeita limite",()=>{expect(buildAdaptiveStudySessionPlan({diagnostics,questions,latestAttempts:{"1":{correct:true},"2":{correct:true},"3":{correct:true}}})).toEqual([]);expect(buildAdaptiveStudySessionPlan({diagnostics,questions,limit:0})).toEqual([]);});
 it("prioriza plano com maior prioridade",()=>{const rows=[...diagnostics,{...diagnostics[0],topic:"Concordância",priority:50}];expect(buildAdaptiveStudySessionPlan({diagnostics:rows,questions:[...questions,{id:4,discipline:"Português",topic:"Concordância"}]} )[0].topic).toBe("Crase");});
});
