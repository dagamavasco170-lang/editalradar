export interface AdaptiveSessionAttempt { questionId: string | number; correct: boolean; at?: string }
export interface AdaptiveSessionPlan { questionIds: Array<string | number>; topic?: string; discipline?: string; priority?: number; startedAt?: string; baselineAccuracy?: number }
export interface AdaptiveSessionEvaluation {
 topic: string;
 discipline: string;
 planned: number;
 answered: number;
 correct: number;
 wrong: number;
 unanswered: number;
 accuracy: number;
 completion: number;
 status: "completed" | "partial" | "not_started";
 nextAction: string;
}
/** Evaluate only attempts belonging to the session's planned question IDs. */
export function evaluateAdaptiveStudySession({session, attempts=[]}:{session:AdaptiveSessionPlan;attempts?:AdaptiveSessionAttempt[]}):AdaptiveSessionEvaluation {
 const ids=[...new Set(session.questionIds.map(String))];
 const latest=new Map<string,AdaptiveSessionAttempt>();
 for(const attempt of attempts){
  const id=String(attempt.questionId);
  if(!ids.includes(id) || (session.startedAt && (!attempt.at || attempt.at < session.startedAt))) continue;
  const previous=latest.get(id);
  if(!previous||String(attempt.at||"")>=String(previous.at||"")) latest.set(id,attempt);
 }
 const correct=[...latest.values()].filter(a=>a.correct).length;
 const answered=latest.size;
 const wrong=answered-correct;
 const planned=ids.length;
 const completion=planned?Math.round(answered/planned*100):0;
 const accuracy=answered?Math.round(correct/answered*100):0;
 const status:AdaptiveSessionEvaluation["status"]=planned>0&&answered===planned?"completed":answered>0?"partial":"not_started";
 const nextAction=status==="not_started"?"Comece a sessão pelas questões selecionadas":accuracy<60?"Revise a teoria e refaça as questões erradas":completion<100?"Continue até concluir as questões planejadas":"Faça uma revisão curta e reavalie o domínio";
 return {topic:session.topic||"Assunto",discipline:session.discipline||"Disciplina",planned,answered,correct,wrong,unanswered:planned-answered,accuracy,completion,status,nextAction};
}
