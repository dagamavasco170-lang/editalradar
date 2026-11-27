import { buildAdaptiveQuestionPlan } from "./tutor-intelligence.js";
import { buildTopicMastery } from "./topic-mastery.ts";

export function buildAdaptiveQuestionQueue({ questions = [], latestAttempts = {}, attempts = [], now = Date.now() } = {}) {
  const plan = buildAdaptiveQuestionPlan({ questions, latestAttempts, now });
  const order = new Map(questions.map((question, index) => [String(question.id), index]));
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const latestHistory = Object.entries(latestAttempts).map(([questionId, attempt]) => ({ ...attempt, questionId }));
  const topicMastery = buildTopicMastery({ questions, attempts: [...attempts, ...latestHistory], now });
  const topicPriority = new Map(topicMastery.map(topic => [
    topic.discipline + "::" + topic.topic,
    topic
  ]));
  const priorityById = new Map();
  for (const question of questions) {
    const id = String(question.id);
    const key = (question.discipline || "Outras") + "::" + String(question.topic || question.discipline || "Outras").trim();
    const topic = topicPriority.get(key);
    priorityById.set(id, topic
      ? { due: topic.due ? 1 : 0, accuracy: topic.accuracy, wrong: topic.wrong }
      : { due: 0, accuracy: 100, wrong: 0 });
  }

  return plan
    .filter(row => {
      const latest = latestAttempts[row.id];
      const topic = priorityById.get(String(row.id));
      return latest?.correct === false || (!latest && topic?.due);
    })
    .sort((a, b) => {
      const aLatest = latestAttempts[a.id];
      const bLatest = latestAttempts[b.id];
      const aWrong = aLatest?.correct === false ? 1 : 0;
      const bWrong = bLatest?.correct === false ? 1 : 0;
      if (bWrong !== aWrong) return bWrong - aWrong;
      const aPriority = priorityById.get(String(a.id)) || { due: 0, accuracy: 100, wrong: 0 };
      const bPriority = priorityById.get(String(b.id)) || { due: 0, accuracy: 100, wrong: 0 };
      if (aWrong && bWrong) {
        const aAt = Date.parse(aLatest?.at || "");
        const bAt = Date.parse(bLatest?.at || "");
        if (Number.isFinite(aAt) && Number.isFinite(bAt) && aAt !== bAt) return bAt - aAt;
      }
      return bPriority.due - aPriority.due
        || aPriority.accuracy - bPriority.accuracy
        || bPriority.wrong - aPriority.wrong
        || b.score - a.score
        || (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0);
    })
    .map(row => row.id);
}
