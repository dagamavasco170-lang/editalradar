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
