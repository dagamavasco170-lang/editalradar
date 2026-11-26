import {buildAdaptiveQuestionPlan} from "./tutor-intelligence.js";
export function buildAdaptiveQuestionQueue({questions=[],latestAttempts={},now=Date.now()}={}) {
 return buildAdaptiveQuestionPlan({questions,latestAttempts,now})
  .filter(row=>!latestAttempts[row.id]||latestAttempts[row.id]?.correct===false)
  .map(row=>row.id);
}
