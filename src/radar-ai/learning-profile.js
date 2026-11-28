/** Privacy-conscious, deterministic learner analytics; never labels a student from sparse evidence. */
export const ERROR_TYPES = Object.freeze([
  "content-gap", "misinterpretation", "concept-confusion", "carelessness", "guess", "unknown",
]);
const DAY_MS = 86_400_000;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const safeDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

export function validateLearningAttempt(attempt) {
  const errors = [];
  if (!attempt || typeof attempt !== "object") return { valid: false, errors: ["attempt-must-be-object"] };
  if (typeof attempt.topicKey !== "string" || !attempt.topicKey.trim()) errors.push("missing-topic-key");
  if (typeof attempt.subject !== "string" || !attempt.subject.trim()) errors.push("missing-subject");
  if (typeof attempt.correct !== "boolean") errors.push("correct-must-be-boolean");
  const date = safeDate(attempt.timestamp);
  if (!date) errors.push("invalid-timestamp");
  if (attempt.errorType !== undefined && !ERROR_TYPES.includes(attempt.errorType)) errors.push("invalid-error-type");
  if (attempt.responseTimeMs !== undefined && (!Number.isFinite(attempt.responseTimeMs) || attempt.responseTimeMs < 0)) errors.push("invalid-response-time");
  return { valid: errors.length === 0, errors };
}

function summarizeTopic(attempts, now) {
  const ordered = [...attempts].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const recent = ordered.slice(-20);
  const weighted = recent.reduce((acc, item, index) => {
    const weight = 1 + index / Math.max(1, recent.length - 1);
    return { score: acc.score + (item.correct ? weight : 0), weight: acc.weight + weight };
  }, { score: 0, weight: 0 });
  const accuracy = weighted.weight ? weighted.score / weighted.weight : 0;
  const latest = safeDate(ordered.at(-1)?.timestamp);
  const daysSinceLastAttempt = latest ? Math.max(0, Math.floor((now - latest) / DAY_MS)) : null;
  const totalAttempts = ordered.length;
  const confidence = totalAttempts < 5 ? "low" : totalAttempts < 12 ? "medium" : "high";
  const mastery = totalAttempts < 5 ? "insufficient-data" : accuracy >= 0.85 ? "mastered" : accuracy >= 0.65 ? "developing" : "needs-review";
  const errors = {};
  for (const attempt of ordered) if (!attempt.correct) {
    const type = ERROR_TYPES.includes(attempt.errorType) ? attempt.errorType : "unknown";
    errors[type] = (errors[type] ?? 0) + 1;
  }
  return { topicKey: ordered[0].topicKey, subject: ordered[0].subject, totalAttempts, recentAttempts: recent.length, weightedAccuracy: Number(accuracy.toFixed(4)), confidence, mastery, daysSinceLastAttempt, errorCounts: errors };
}

export function buildLearningProfile(attempts = [], { now = new Date(), topicImportance = {} } = {}) {
  const accepted = [];
  const rejected = [];
  for (const attempt of attempts) {
    const result = validateLearningAttempt(attempt);
    if (result.valid) accepted.push(attempt);
    else rejected.push({ errors: result.errors });
  }
  const groups = new Map();
  for (const attempt of accepted) {
    const group = groups.get(attempt.topicKey) ?? [];
    group.push(attempt);
    groups.set(attempt.topicKey, group);
  }
  const topics = [...groups.values()].map((items) => summarizeTopic(items, now.getTime()));
  const recommendations = topics.map((topic) => {
    const importance = clamp(Number(topicImportance[topic.topicKey] ?? 1), 0.5, 2);
    const weakness = 1 - topic.weightedAccuracy;
    const uncertaintyBoost = topic.totalAttempts < 5 ? 0.25 : 0;
    const recencyBoost = topic.daysSinceLastAttempt === null ? 0 : clamp(topic.daysSinceLastAttempt / 30, 0, 0.3);
    const priority = Number(clamp((weakness + uncertaintyBoost + recencyBoost) * importance, 0, 2).toFixed(4));
    const action = topic.mastery === "insufficient-data" ? "diagnostic-practice" : topic.mastery === "needs-review" ? "targeted-review" : topic.mastery === "developing" ? "mixed-practice" : "maintenance-review";
    return { topicKey: topic.topicKey, subject: topic.subject, priority, action, rationale: topic.mastery === "insufficient-data" ? "Poucos dados: aplicar um bloco diagnóstico antes de concluir sobre domínio." : topic.mastery === "needs-review" ? "Baixo desempenho recente: revisar o conceito e praticar questões direcionadas." : topic.mastery === "developing" ? "Consolidar com prática variada e revisão espaçada." : "Manter o domínio com revisão espaçada." };
  }).sort((a, b) => b.priority - a.priority);
  return { topics: topics.sort((a, b) => a.topicKey.localeCompare(b.topicKey)), recommendations, rejectedAttempts: rejected, limitations: ["Indicadores são estimativas de estudo, não notas, rankings ou previsões de aprovação.", "Dados insuficientes são explicitamente sinalizados; não inferir habilidade com poucos registros."] };
}
