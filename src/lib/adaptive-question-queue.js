import {buildAdaptiveQuestionPlan} from "./tutor-intelligence.js";
import {buildTopicMastery} from "./topic-mastery.js";
export function buildAdaptiveQuestionQueue({questions=[],latestAttempts={},attempts=[],now=Date.now()}={}) {
 const plan=buildAdaptiveQuestionPlan({questions,latestAttempts,now});
 const order=new Map(questions.map((question,index)=>[question.id,index]));
 const latestHistory=Object.entries(latestAttempts).map(([questionId,attempt])=>({...attempt,questionId}));
 const topicMastery=buildTopicMastery({questions,attempts:[...attempts,...latestHistory],now});
 const topicPriority=new Map(topicMastery.map(topic=>[topic.discipline+"::"+topic.topic,topic]));
 const priorityFor=id=>{
  const question=questions.find(item=>item.id===id);
  const topic=question&&topicPriority.get((question.discipline||"Outras")+"::"+(String(question.topic||question.discipline||"Outras").trim()));
  return topic?{due:topic.due?1:0,accuracy:topic.accuracy,wrong:topic.wrong}:{due:0,accuracy:100,wrong:0};
 };
 return plan
  .filter(row=>{
   const latest=latestAttempts[row.id];
   const topic=priorityFor(row.id);
   return latest?.correct===false||(!latest&&topic.due);
  })
  .sort((a,b)=>{
   const aWrong=latestAttempts[a.id]?.correct===false?1:0;
   const bWrong=latestAttempts[b.id]?.correct===false?1:0;
   const pa=priorityFor(a.id),pb=priorityFor(b.id);
   if(bWrong!==aWrong)return bWrong-aWrong;
   if(aWrong&&bWrong)return order.get(a.id)-order.get(b.id);
   return pb.due-pa.due||pa.accuracy-pb.accuracy||pb.wrong-pa.wrong||b.score-a.score||order.get(a.id)-order.get(b.id);
  })
  .map(row=>row.id);
}
