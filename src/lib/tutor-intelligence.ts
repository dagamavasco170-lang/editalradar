export interface TutorTopic {
  topic?: string;
  discipline?: string;
  accuracy?: number;
  attempts?: number;
  unanswered?: number;
  questionCount?: number;
  due?: boolean;
  [key: string]: unknown;
}
export interface TutorWeeklyDay { attempts?: number; [key: string]: unknown }
export interface TutorSimulation { accuracy?: number; score?: number; [key: string]: unknown }
export interface TutorQuestion {
  id: string;
  topic?: string;
  discipline?: string;
  difficulty?: string;
  prompt?: string;
  options?: Array<[string, string]>;
  explanation?: string;
  [key: string]: unknown;
}
export interface TutorAttempt { questionId: string; correct?: boolean; at?: string; [key: string]: unknown }
export interface TutorLatestAttempt { correct?: boolean; at?: string; [key: string]: unknown }
export interface TutorSignalsInput { topics?: TutorTopic[]; simulations?: TutorSimulation[]; weeklyProgress?: TutorWeeklyDay[] }
export interface AdaptivePlanInput { questions?: TutorQuestion[]; latestAttempts?: Record<string, TutorLatestAttempt>; now?: number }
export interface AdaptiveFeedbackInput { correct?: boolean; recentTopicAttempts?: Array<{correct?: boolean}>; currentLevel?: string }
export interface ConfusionPatternsInput { questions?: TutorQuestion[]; attempts?: TutorAttempt[]; topic?: string; discipline?: string }
export interface RecoveryAdviceInput { pattern?: {recentWrong?: number; wrong?: number; attempts?: number; accuracy?: number}; explanation?: string }
export interface MisconceptionDiagnosisInput { question?: TutorQuestion; selectedAnswer?: string; explanation?: string }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export function buildTutorSignals({topics=[],simulations=[],weeklyProgress=[]}: TutorSignalsInput = {}) {
 const normalized=topics.map(topic=>{
  const accuracy=Number(topic.accuracy)||0, attempts=Number(topic.attempts)||0, unanswered=Number(topic.unanswered)||0;
  const coverage=topic.questionCount?clamp(Math.round(attempts/topic.questionCount*100),0,100):0;
  const suggestedDifficulty=attempts<3||accuracy<50?"Fácil":accuracy<75?"Médio":"Difícil";
  const priority=Math.round((100-accuracy)*0.65+(topic.due?20:0)+(attempts<3?12:0)+(unanswered?Math.min(8,unanswered):0));
  return {...topic,coverage,suggestedDifficulty,priority:clamp(priority,0,100),status:priority>=65?"Atenção":priority>=35?"Consolidar":"Avançar"};
 }).sort((a,b)=>b.priority-a.priority);
 const attempted=topics.filter(t=>(Number(t.attempts)||0)>0), overallAccuracy=attempted.length?Math.round(attempted.reduce((sum,t)=>sum+(Number(t.accuracy)||0),0)/attempted.length):0;
 const coverage=topics.length?Math.round(topics.reduce((sum,t)=>sum+(t.questionCount?Math.min(100,(Number(t.attempts)||0)/t.questionCount*100):0),0)/topics.length):0;
 const consistency=weeklyProgress.length?Math.round(weeklyProgress.filter(day=>(day.attempts||0)>0).length/weeklyProgress.length*100):0;
 const simulationAccuracy=simulations.length?Math.round(simulations.slice(-5).reduce((sum,item)=>sum+(Number(item.accuracy)||Number(item.score)||0),0)/Math.min(5,simulations.length)):0;
 const readiness=clamp(Math.round(overallAccuracy*0.55+coverage*0.25+consistency*0.1+simulationAccuracy*0.1),0,100);
 return {topics:normalized,overallAccuracy,coverage,consistency,simulationAccuracy,readiness,weakTopics:normalized.filter(t=>t.priority>=50).slice(0,5)};
}
const difficultyRank=(value: unknown): number=>({"Fácil":1,"Easy":1,"Médio":2,"Intermediária":2,"Intermediate":2,"Difícil":3,"Avançada":3,"Hard":3}[String(value||"")]||2);
const normalizeTopic=(value: unknown): string=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
export function buildAdaptiveQuestionPlan({questions=[],latestAttempts={},now=Date.now()}:AdaptivePlanInput={}) {
 const groups=new Map<string,{attempts:number;correct:number;wrong:number;lastAt:number|null;latestDifficulty:number}>();
 for(const question of questions){
  const key=normalizeTopic(question.discipline)+"::"+normalizeTopic(question.topic||question.discipline||"Geral");
  const group=groups.get(key)||{attempts:0,correct:0,wrong:0,lastAt:null,latestDifficulty:2};
  const attempt=latestAttempts[question.id];
  if(attempt){group.attempts++;if(attempt.correct===true)group.correct++;else group.wrong++;
   const timestamp=Date.parse(attempt.at||"");if(Number.isFinite(timestamp)&&(group.lastAt===null||timestamp>group.lastAt))group.lastAt=timestamp;
   group.latestDifficulty=difficultyRank(question.difficulty);
  }
  groups.set(key,group);
 }
 const signalFor=(question:TutorQuestion)=>groups.get(normalizeTopic(question.discipline)+"::"+normalizeTopic(question.topic||question.discipline||"Geral"))||{attempts:0,correct:0,wrong:0,lastAt:null,latestDifficulty:2};
 const scored=questions.map((question,index)=>{
  const group=signalFor(question),accuracy=group.attempts?group.correct/group.attempts:0;
  const due=group.lastAt===null||group.lastAt+((accuracy>=.85?7:accuracy>=.65?3:1)*86400000)<=now;
  const targetDifficulty=group.attempts<3||accuracy<.5?1:accuracy<.75?2:3;
  const actualDifficulty=difficultyRank(question.difficulty),difficultyFit=Math.max(0,12-Math.abs(actualDifficulty-targetDifficulty)*6);
  const latest=latestAttempts[question.id];
  const score=(latest?.correct===false?45:latest?0:20)+(1-accuracy)*25+(due?20:0)+(group.attempts<3?10:0)+difficultyFit;
  return {id:question.id,topic:question.topic||question.discipline||"Geral",discipline:question.discipline||"Outras",score,targetDifficulty,level:["Fácil","Médio","Difícil"][targetDifficulty-1],due,accuracy:Math.round(accuracy*100),attempts:group.attempts,wrong:group.wrong,index};
 });
 return scored.sort((a,b)=>b.score-a.score||a.index-b.index).map(({index,...plan})=>plan);
}
const tutorLevelRank=(value:unknown):number=>({"Fácil":1,"Easy":1,"Médio":2,"Intermediária":2,"Intermediate":2,"Difícil":3,"Avançada":3,"Hard":3}[String(value||"")]||2);
const tutorLevelName=(rank:number):string=>["Fácil","Médio","Difícil"][Math.max(1,Math.min(3,rank))-1];
export function buildAdaptiveTutorFeedback({correct=false,recentTopicAttempts=[],currentLevel="Médio"}:AdaptiveFeedbackInput={}) {
 const streak=correct?recentTopicAttempts.slice().reverse().reduce((state,item)=>item.correct&&!state.stopped?{count:state.count+1,stopped:false}:{count:state.count,stopped:true},{count:0,stopped:false}).count+1:0;
 const current=tutorLevelRank(currentLevel),nextRank=correct?(streak>=3?Math.min(3,current+1):current):Math.max(1,current-1);
 return {correct,streak,nextLevel:tutorLevelName(nextRank),progression:correct?(streak>=3?"progress":"consolidate"):"recover",recoverySteps:correct?[]:["Releia a explicação e identifique a regra central","Revise o conceito do assunto","Resolva outra questão em nível recomendado "+tutorLevelName(nextRank)]};
}
const topicKey=(value:unknown):string=>normalizeTopic(value||"Geral");
export function buildConfusionPatterns({questions=[],attempts=[],topic,discipline}:ConfusionPatternsInput={}) {
 const ids=new Set(questions.filter(question=>topicKey(question.topic||question.discipline||"Geral")===topicKey(topic||"Geral")&&(!discipline||topicKey(question.discipline)===topicKey(discipline))).map(question=>String(question.id)));
 const history=attempts.filter(attempt=>ids.has(String(attempt.questionId))).slice(-12);
 const wrong=history.filter(attempt=>attempt.correct===false),correct=history.filter(attempt=>attempt.correct===true),accuracy=history.length?Math.round(correct.length/history.length*100):0;
 let recentWrong=0;for(let i=history.length-1;i>=0&&history[i].correct===false;i--)recentWrong++;
 const patterns:Array<{id:string;label:string;detail:string}>=[];
 if(wrong.length>=2)patterns.push({id:"repeat-errors",label:"Erros recorrentes no mesmo assunto",detail:`Você errou ${wrong.length} de ${history.length} tentativa(s) recente(s) neste tema.`});
 if(recentWrong>=2)patterns.push({id:"error-streak",label:"Sequência recente de erros",detail:`Foram ${recentWrong} erro(s) consecutivo(s); vale reduzir a dificuldade e revisar o conceito antes de acelerar.`});
 if(history.length>=3&&accuracy<50)patterns.push({id:"low-accuracy",label:"Acurácia baixa neste tema",detail:`A taxa recente de acerto é ${accuracy}%, indicando necessidade de reconstruir a base.`});
 if(history.length>=3&&accuracy>=80)patterns.push({id:"stable",label:"Desempenho consistente",detail:`A taxa recente de acerto é ${accuracy}%; tente uma questão de nível superior para validar o domínio.`});
 return {topic:topic||"Geral",attempts:history.length,wrong:wrong.length,accuracy,recentWrong,patterns};
}
export function buildPersonalizedRecoveryAdvice({pattern={},explanation=""}:RecoveryAdviceInput={}) {
 const advice:string[]=[];
 if(pattern.recentWrong>=2)advice.push("Faça uma pausa na tentativa de adivinhar: revise a regra e resolva um exemplo guiado.");
 else if(pattern.wrong>=2)advice.push("Compare os erros anteriores e procure a mesma regra conceitual antes de responder.");
 if(pattern.attempts>=3&&pattern.accuracy<50)advice.push("Recomece por uma questão Fácil e aumente o nível somente após acertar com justificativa.");
 else if(pattern.accuracy>=80&&pattern.attempts>=3)advice.push("Tente uma questão Médio/Difícil e explique o motivo da alternativa.");
 if(explanation)advice.push("Use a explicação da questão como referência; a recomendação não substitui o conteúdo oficial.");
 if(!advice.length)advice.push("Identifique a regra central no enunciado e explique o raciocínio com suas palavras antes da próxima tentativa.");
 return advice;
}
export function buildMisconceptionDiagnosis({question={},selectedAnswer,explanation=""}:MisconceptionDiagnosisInput={}) {
 const options=Array.isArray(question.options)?question.options:[];
 const chosen=options.find(option=>String(option[1])===String(selectedAnswer)),chosenText=chosen?.[0]||"Alternativa selecionada";
 const normalized=String(chosenText).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const clueTerms=String(question.prompt||"").match(/[\p{L}]{4,}/gu)||[],clues=[...new Set(clueTerms.map(term=>term.toLowerCase()))].slice(0,4);
 const explanationText=String(explanation||question.explanation||"").trim();
 return {selectedLabel:chosenText,observed:true,topic:question.topic||question.discipline||"assunto",clue:clues.length?clues.join(", "):question.topic||question.discipline||"o conceito central do enunciado",explanation:explanationText,lesson:explanationText||"A questão ainda não possui uma explicação validada. Releia o enunciado, localize a regra central no material oficial e compare com a alternativa escolhida.",reflection:normalized.length>0?"Por que a alternativa escolhida parecia correta? Qual palavra do enunciado mudaria sua decisão?":"Qual regra central sustenta a resposta e como ela se aplica ao enunciado?",verification:"Resolva uma nova questão do mesmo assunto sem consultar a explicação. Se conseguir justificar a resposta, avance; se não, retome a fonte."};
}
