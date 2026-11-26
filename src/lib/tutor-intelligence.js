const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function buildTutorSignals({topics=[],simulations=[],weeklyProgress=[]}={}) {
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

const difficultyRank=value=>({"Fácil":1,"Easy":1,"Médio":2,"Intermediária":2,"Intermediate":2,"Difícil":3,"Avançada":3,"Hard":3}[String(value||"")]||2);
const normalizeTopic=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
export function buildAdaptiveQuestionPlan({questions=[],latestAttempts={},now=Date.now()}={}) {
 const groups=new Map();
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
 const signalFor=question=>groups.get(normalizeTopic(question.discipline)+"::"+normalizeTopic(question.topic||question.discipline||"Geral"))||{attempts:0,correct:0,wrong:0,lastAt:null,latestDifficulty:2};
 const scored=questions.map((question,index)=>{
  const group=signalFor(question),accuracy=group.attempts?group.correct/group.attempts:0;
  const due=group.lastAt===null||group.lastAt+((accuracy>=.85?7:accuracy>=.65?3:1)*86400000)<=now;
  const targetDifficulty=group.attempts<3||accuracy<.5?1:accuracy<.75?2:3;
  const score=(question.id in latestAttempts&&latestAttempts[question.id]?.correct===false?45:question.id in latestAttempts?0:20)+(1-accuracy)*25+(due?20:0)+(group.attempts<3?10:0);
  return {id:question.id,topic:question.topic||question.discipline||"Geral",discipline:question.discipline||"Outras",score,targetDifficulty,level:["Fácil","Médio","Difícil"][targetDifficulty-1],due,accuracy:Math.round(accuracy*100),attempts:group.attempts,wrong:group.wrong,index};
 });
 return scored.sort((a,b)=>b.score-a.score||a.index-b.index).map(({index,...plan})=>plan);
}

const tutorLevelRank=value=>({"Fácil":1,"Easy":1,"Médio":2,"Intermediária":2,"Intermediate":2,"Difícil":3,"Avançada":3,"Hard":3}[String(value||"")]||2);
const tutorLevelName=rank=>["Fácil","Médio","Difícil"][Math.max(1,Math.min(3,rank))-1];
export function buildAdaptiveTutorFeedback({correct=false,recentTopicAttempts=[],currentLevel="Médio"}={}){
 const streak=correct?recentTopicAttempts.slice().reverse().reduce((state,item)=>item.correct&&!state.stopped?{count:state.count+1,stopped:false}:{count:state.count,stopped:true},{count:0,stopped:false}).count+1:0;
 const current=tutorLevelRank(currentLevel);
 const nextRank=correct?(streak>=3?Math.min(3,current+1):current):Math.max(1,current-1);
 return {correct,streak,nextLevel:tutorLevelName(nextRank),progression:correct?(streak>=3?"progress":"consolidate"):"recover",recoverySteps:correct?[]:["Releia a explicação e identifique a regra central","Revise o conceito do assunto","Resolva outra questão em nível recomendado "+tutorLevelName(nextRank)]};
}
