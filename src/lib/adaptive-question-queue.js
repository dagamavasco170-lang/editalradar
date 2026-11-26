import {buildAdaptiveQuestionPlan} from "./tutor-intelligence.js";
export function buildAdaptiveQuestionQueue({questions=[],latestAttempts={},now=Date.now()}={}) {
 const plan=buildAdaptiveQuestionPlan({questions,latestAttempts,now});
 const order=new Map(questions.map((question,index)=>[question.id,index]));
 return plan
  .filter(row=>!latestAttempts[row.id]||latestAttempts[row.id]?.correct===false)
  .sort((a,b)=>{
   const aWrong=latestAttempts[a.id]?.correct===false?1:0;
   const bWrong=latestAttempts[b.id]?.correct===false?1:0;
   return bWrong-aWrong||(aWrong&&bWrong?order.get(a.id)-order.get(b.id):b.score-a.score||order.get(a.id)-order.get(b.id));
  })
  .map(row=>row.id);
}