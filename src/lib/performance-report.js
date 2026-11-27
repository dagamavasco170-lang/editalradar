const DAY_MS=24*60*60*1000;
const timestamp=value=>{const parsed=Date.parse(value||"");return Number.isFinite(parsed)?parsed:null;};
const labelForDate=date=>new Date(date+"T12:00:00Z").toLocaleDateString("pt-BR",{weekday:"short",timeZone:"UTC"}).replace(".","");
export function buildPerformanceReport({attempts=[],questions=[],now=Date.now()}={}){
 const questionById=new Map(questions.map(question=>[String(question.id),question]));
 const latest=new Map();
 for(const attempt of attempts){
  if(!attempt?.questionId)continue;
  const id=String(attempt.questionId),at=timestamp(attempt.at),previous=latest.get(id),previousAt=timestamp(previous?.at);
  if(!previous||(at!==null&&(previousAt===null||at>=previousAt)))latest.set(id,attempt);
 }
 const topics=new Map();
 for(const question of questions){
  const discipline=question.discipline||"Outras",topic=String(question.topic||discipline).trim()||discipline,key=discipline+"::"+topic;
  if(!topics.has(key))topics.set(key,{key,discipline,topic,questionCount:0,answered:0,correct:0,wrong:0});
  topics.get(key).questionCount++;
 }
 for(const [id,attempt] of latest){
  const question=questionById.get(id);
  const discipline=question?.discipline||attempt.discipline||"Outras";
  const topic=String(question?.topic||attempt.topic||discipline).trim()||discipline;
  const key=discipline+"::"+topic;
  if(!topics.has(key))topics.set(key,{key,discipline,topic,questionCount:0,answered:0,correct:0,wrong:0});
  const row=topics.get(key);row.answered++;
  if(attempt.correct===true)row.correct++;else row.wrong++;
 }
 const byTopic=[...topics.values()].map(row=>({...row,accuracy:row.answered?Math.round(row.correct/row.answered*100):0,coverage:row.questionCount?Math.round(row.answered/row.questionCount*100):0})).sort((a,b)=>a.accuracy-b.accuracy||b.wrong-a.wrong||a.topic.localeCompare(b.topic,"pt-BR"));
 const weakTopics=byTopic.filter(row=>row.answered>0&&row.accuracy<70);
 const strongestTopics=byTopic.filter(row=>row.answered>=2&&row.accuracy>=80).sort((a,b)=>b.accuracy-a.accuracy||b.answered-a.answered);
 const answered=latest.size,correct=[...latest.values()].filter(item=>item.correct===true).length;
 const start=now-6*DAY_MS;
 const trend=Array.from({length:7},(_,index)=>{
  const date=new Date(start+index*DAY_MS).toISOString().slice(0,10);
  return {date,label:labelForDate(date),attempts:0,correct:0,accuracy:0};
 });
 const trendByDate=new Map(trend.map(day=>[day.date,day]));
 for(const attempt of attempts){
  const at=timestamp(attempt?.at);if(at===null||at<start||at>now)continue;
  const day=trendByDate.get(new Date(at).toISOString().slice(0,10));
  if(day){day.attempts++;if(attempt.correct===true)day.correct++;}
 }
 for(const day of trend)day.accuracy=day.attempts?Math.round(day.correct/day.attempts*100):0;
 const trendMax=Math.max(1,...trend.map(day=>day.attempts));
 const recommendation=weakTopics.length
  ? "Priorize "+weakTopics.slice(0,2).map(row=>row.topic).join(" e ")+"; resolva novas questões e revise as explicações dos erros."
  : answered<5
   ? "Continue resolvendo questões em diferentes assuntos. Com mais respostas, o relatório identificará seus pontos fortes e lacunas com maior confiança."
   : "Seu desempenho recente não aponta um assunto crítico. Mantenha revisões espaçadas e faça simulados para validar a consistência.";
 return {summary:{answered,accuracy:answered?Math.round(correct/answered*100):0,coverage:questions.length?Math.round(answered/questions.length*100):0,weakTopics:weakTopics.length,strongTopics:strongestTopics.length},byTopic,weakTopics,strongestTopics,trend,trendMax,recommendation};
}
