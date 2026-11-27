export interface AdaptiveStudyDiagnostic { discipline: string; topic: string; priority: number; status: "urgent" | "reinforce" | "maintain"; accuracy: number; attempts: number; wrong: number; unanswered: number; due: boolean; reasons?: string[]; nextAction?: string }
export interface AdaptiveStudyQuestion { id: string | number; discipline?: string | null; topic?: string | null; difficulty?: string | null }
export interface AdaptiveStudySessionPlan { discipline: string; topic: string; priority: number; status: AdaptiveStudyDiagnostic["status"]; accuracy: number; durationMinutes: number; targetDifficulty: "Fácil" | "Médio" | "Difícil"; questionIds: string[]; reasons: string[]; action: string }
/** Converts diagnostic topics into an executable practice session, favoring unanswered and incorrect questions. */
export function buildAdaptiveStudySessionPlan({diagnostics=[],questions=[],latestAttempts={},limit=5}:{diagnostics?:AdaptiveStudyDiagnostic[];questions?:AdaptiveStudyQuestion[];latestAttempts?:Record<string,{correct?:boolean}|undefined>;limit?:number}={}):AdaptiveStudySessionPlan[] {
 const plans=diagnostics.filter(row=>row.status!=="maintain").map(row=>{
  const candidates=questions.filter(q=>(q.discipline||"Outras").trim().toLowerCase()===(row.discipline||"Outras").trim().toLowerCase()&&(q.topic||q.discipline||"").trim().toLowerCase()===row.topic.trim().toLowerCase());
  const ids=candidates.filter(q=>!latestAttempts[String(q.id)]||latestAttempts[String(q.id)]?.correct===false).sort((a,b)=>{
   const aWrong=latestAttempts[String(a.id)]?.correct===false?1:0,bWrong=latestAttempts[String(b.id)]?.correct===false?1:0;
   return bWrong-aWrong || (a.difficulty==="Fácil"? -1:0)-(b.difficulty==="Fácil"? -1:0);
  }).map(q=>String(q.id));
  const targetDifficulty:AdaptiveStudySessionPlan["targetDifficulty"]=row.status==="urgent"?"Fácil":row.accuracy>=80?"Difícil":"Médio";
  return {discipline:row.discipline,topic:row.topic,priority:row.priority,status:row.status,accuracy:row.accuracy,durationMinutes:row.status==="urgent"?25:20,targetDifficulty,questionIds:ids.slice(0,10),reasons:row.reasons||[],action:row.nextAction||"Praticar questões e reavaliar o domínio"};
 }).filter(p=>p.questionIds.length>0).sort((a,b)=>b.priority-a.priority||a.accuracy-b.accuracy).slice(0,Math.max(0,limit));
 return plans;
}
