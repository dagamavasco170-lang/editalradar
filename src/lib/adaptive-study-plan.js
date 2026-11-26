const DAY_MS=24*60*60*1000;
const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function buildAdaptiveStudySessions({subjects=[],attempts=[],mastery=[],hours=10,days=[]}={}) {
 const chosen=days.filter(day=>["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].includes(day));
 if(!chosen.length||!subjects.length)return [];
 const latest=new Map();
 for(const attempt of attempts) {
  if(!attempt?.questionId)continue;
  const key=String(attempt.questionId),previous=latest.get(key);
  if(!previous||Date.parse(attempt.at||"")>=Date.parse(previous.at||""))latest.set(key,attempt);
 }
 const performance=new Map();
 for(const attempt of latest.values()){
  const question=attempt.discipline||attempt.subject;
  if(!question)continue;
  const key=normalize(question),row=performance.get(key)||{attempts:0,correct:0};
  row.attempts++;if(attempt.correct===true)row.correct++;performance.set(key,row);
 }
 const weights=subjects.map(subject=>{
  const key=normalize(subject),stats=[...performance.entries()].find(([name])=>name.includes(key)||key.includes(name))?.[1];
  const accuracy=stats?.attempts?stats.correct/stats.attempts:0.5;
  const due=mastery.filter(item=>normalize(item.discipline).includes(key)||key.includes(normalize(item.discipline))).length;
  return {subject,weight:1+(1-accuracy)*1.5+Math.min(due,4)*0.25};
 });
 const total=hours*60,weightTotal=weights.reduce((sum,item)=>sum+item.weight,0);
 let allocations=weights.map(item=>({subject:item.subject,minutes:Math.floor(total*item.weight/weightTotal)}));
 let remainder=total-allocations.reduce((sum,item)=>sum+item.minutes,0);
 for(let i=0;remainder>0;i=(i+1)%allocations.length){allocations[i].minutes++;remainder--;}
 const sessions=[];
 allocations.sort((a,b)=>b.minutes-a.minutes);
 let dayIndex=0;
 for(const item of allocations){
  let remaining=item.minutes;
  while(remaining>0){
   const day=chosen[dayIndex%chosen.length];
   const minutes=Math.min(remaining,Math.ceil(item.minutes/chosen.length));
   const slug=normalize(item.subject).replace(/[^a-z0-9]+/g,"-");
   sessions.push({id:day+"-"+slug,day,subject:item.subject,minutes});
   remaining-=minutes;dayIndex++;
  }
 }
 return sessions.sort((a,b)=>chosen.indexOf(a.day)-chosen.indexOf(b.day));
}
