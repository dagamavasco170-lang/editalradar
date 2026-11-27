export interface StudyDiagnosticQuestion { id: string | number; discipline?: string | null; topic?: string | null }
export interface StudyDiagnosticAttempt { questionId?: string | number | null; correct?: boolean; at?: string | null }
export interface StudyDiagnosticMastery { discipline?: string; topic?: string; accuracy?: number; attempts?: number; due?: boolean; priority?: number; intervalDays?: number }
export interface StudyDiagnosticInput { questions?: StudyDiagnosticQuestion[]; attempts?: Array<StudyDiagnosticAttempt | null>; mastery?: StudyDiagnosticMastery[]; limit?: number; now?: number }
export interface StudyDiagnostic {
 discipline: string; topic: string; attempts: number; correct: number; wrong: number; unanswered: number; accuracy: number; questionCount: number;
 priority: number; status: "urgent" | "reinforce" | "maintain"; reasons: string[]; nextAction: string; due: boolean;
}
const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function latestAttempts(attempts: Array<StudyDiagnosticAttempt | null>) {
 const result = new Map<string, StudyDiagnosticAttempt>();
 for (const attempt of attempts) {
  if (!attempt?.questionId) continue;
  const id = String(attempt.questionId), previous = result.get(id);
  const at = Date.parse(attempt.at || ""), old = Date.parse(previous?.at || "");
  if (!previous || (Number.isFinite(at) && (!Number.isFinite(old) || at >= old))) result.set(id, attempt);
 }
 return result;
}
/** Produces explainable topic-level study priorities; input collections are never mutated. */
export function buildStudyDiagnostics({questions=[], attempts=[], mastery=[], limit=10, now=Date.now()}: StudyDiagnosticInput = {}): StudyDiagnostic[] {
 const latest = latestAttempts(attempts);
 const groups = new Map<string, {discipline:string;topic:string;attempts:number;correct:number;wrong:number;unanswered:number;questionCount:number}>();
 for (const question of questions) {
  const discipline=String(question.discipline || "Outras").trim() || "Outras";
  const topic=String(question.topic || discipline).trim() || discipline;
  const key=normalize(discipline)+"::"+normalize(topic);
  const row=groups.get(key)||{discipline,topic,attempts:0,correct:0,wrong:0,unanswered:0,questionCount:0};
  row.questionCount++;
  const attempt=latest.get(String(question.id));
  if (!attempt) row.unanswered++;
  else {row.attempts++; if(attempt.correct===true){row.correct++;}else row.wrong++;}
  groups.set(key,row);
 }
 const masteryByKey=new Map(mastery.map(item=>[normalize(item.discipline)+"::"+normalize(item.topic),item]));
 return [...groups.entries()].map(([key,row])=>{
  const accuracy=row.attempts?Math.round(row.correct/row.attempts*100):0;
  const master=masteryByKey.get(key);
  const due=master?.due===true;
  const errorRate=row.attempts?row.wrong/row.attempts:0;
  const priority=clamp(Math.round((row.attempts?errorRate*60:35)+(due?20:0)+(row.attempts<3?15:0)+(row.unanswered?Math.min(10,row.unanswered):0)+(master?.priority||0)*0.15),0,100);
  const reasons:string[]=[];
  if(!row.attempts) reasons.push("Ainda sem tentativas registradas");
  else if(accuracy<50) reasons.push("Aproveitamento abaixo de 50%");
  else if(accuracy<70) reasons.push("Aproveitamento abaixo de 70%");
  if(row.wrong>0) reasons.push(`${row.wrong} questão(ões) errada(s) no histórico mais recente`);
  if(due) reasons.push("Revisão espaçada vencida");
  if(row.unanswered>0) reasons.push(`${row.unanswered} questão(ões) ainda não respondida(s)`);
  if(!reasons.length) reasons.push("Desempenho consistente; manter prática");
  const status:StudyDiagnostic["status"]=priority>=65?"urgent":priority>=35?"reinforce":"maintain";
  const nextAction=status==="urgent"?"Revisar teoria e resolver questões fáceis antes de avançar":status==="reinforce"?"Resolver uma bateria de questões e revisar os erros":"Avançar para questões de nível médio/difícil e manter revisão";
  return {...row,accuracy,priority,status,reasons,nextAction,due};
 }).sort((a,b)=>b.priority-a.priority||a.accuracy-b.accuracy||a.topic.localeCompare(b.topic,"pt-BR")).slice(0,Math.max(0,Math.floor(limit)));
}
export function buildStudyDiagnosticSummary(rows: StudyDiagnostic[]) {
 const totalQuestions=rows.reduce((sum,row)=>sum+row.questionCount,0);
 const totalAttempts=rows.reduce((sum,row)=>sum+row.attempts,0);
 const correct=rows.reduce((sum,row)=>sum+row.correct,0);
 const urgent=rows.filter(row=>row.status==="urgent").length;
 const due=rows.filter(row=>row.due).length;
 return {topics:rows.length,totalQuestions,totalAttempts,accuracy:totalAttempts?Math.round(correct/totalAttempts*100):0,urgentTopics:urgent,dueTopics:due,topPriorities:rows.filter(row=>row.status!=="maintain").slice(0,3)};
}
