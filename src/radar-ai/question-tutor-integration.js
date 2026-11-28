import { buildLearningProfile } from "./learning-profile.js";

const normalizeTopic = (value) => String(value ?? "Geral").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Converts existing question-bank history into the learning engine's topic-level events. */
export function toRadarLearningAttempts({ attempts = [], questions = [] } = {}) {
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  return attempts.flatMap(attempt => {
    if (!attempt || typeof attempt.questionId === "undefined" || typeof attempt.correct !== "boolean") return [];
    const question = questionById.get(String(attempt.questionId));
    const topic = normalizeTopic(question?.topic || question?.discipline);
    const subject = normalizeTopic(question?.discipline || "Outras");
    const timestamp = attempt.at || attempt.timestamp;
    return [{
      topicKey: subject + "::" + topic,
      subject,
      correct: attempt.correct,
      timestamp,
      errorType: attempt.correct ? undefined : "unknown",
      responseTimeMs: attempt.responseTimeMs,
    }];
  });
}

/** Derives a bounded importance signal from how often a topic occurs in the active bank. */
export function deriveTopicImportance(questions = []) {
  const counts = new Map();
  for (const question of questions) {
    const key = (question.discipline || "Outras") + "::" + normalizeTopic(question.topic || question.discipline);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return Object.fromEntries([...counts].map(([key, count]) => [key, clamp(0.75 + (count / max) * 1.25, 0.75, 2)]));
}

export function buildRadarLearningInsights({ attempts = [], questions = [], now = new Date() } = {}) {
  const learningAttempts = toRadarLearningAttempts({ attempts, questions });
  return buildLearningProfile(learningAttempts, { now, topicImportance: deriveTopicImportance(questions) });
}

/** Selects the next existing question using tutor plan scores and learning-profile priorities. */
export function selectQuestionWithLearningProfile({ currentQuestionId, plan = [], filteredQuestions = [], learningProfile = {} } = {}) {
  const filteredIds = new Set(filteredQuestions.map(question => String(question.id)));
  const topicPriority = new Map((learningProfile.recommendations || []).map(item => [item.topicKey, item.priority]));
  const candidatePlan = plan.filter(item => String(item.id) !== String(currentQuestionId) && filteredIds.has(String(item.id)));
  if (!candidatePlan.length) return null;
  const byId = new Map(filteredQuestions.map(question => [String(question.id), question]));
  return candidatePlan.sort((a, b) => {
    const topicA = byId.get(String(a.id));
    const topicB = byId.get(String(b.id));
    const keyA = (topicA?.discipline || "Outras") + "::" + normalizeTopic(topicA?.topic || topicA?.discipline);
    const keyB = (topicB?.discipline || "Outras") + "::" + normalizeTopic(topicB?.topic || topicB?.discipline);
    return (topicPriority.get(keyB) || 0) - (topicPriority.get(keyA) || 0)
      || (Number(b.score) || 0) - (Number(a.score) || 0);
  })[0]?.id ?? null;
}
