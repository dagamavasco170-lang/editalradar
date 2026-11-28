/**
 * Integrated, deterministic adaptive tutor core for Radar AI.
 * Consumes normalized question records and privacy-minimal learning attempts.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const keyOf = (value) => String(value ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const validQuestion = (q) => q && typeof q === "object" && q.id && q.topicKey && Array.isArray(q.options) && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length;

export function buildAdaptiveTutorState({ questions = [], attempts = [], now = new Date(), topicWeights = {} } = {}) {
  const validQuestions = questions.filter(validQuestion);
  const normalizedAttempts = attempts.filter((a) => a && typeof a.topicKey === "string" && typeof a.correct === "boolean" && a.timestamp && Number.isFinite(new Date(a.timestamp).getTime()));
  const groups = new Map();
  for (const attempt of normalizedAttempts) {
    const group = groups.get(attempt.topicKey) ?? [];
    group.push(attempt);
    groups.set(attempt.topicKey, group);
  }
  const topics = [...groups.entries()].map(([topicKey, group]) => {
    const ordered = [...group].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(-20);
    const weights = ordered.map((_, i) => 1 + i / Math.max(1, ordered.length - 1));
    const denom = weights.reduce((sum, w) => sum + w, 0);
    const accuracy = denom ? ordered.reduce((sum, a, i) => sum + (a.correct ? weights[i] : 0), 0) / denom : 0;
    const latest = ordered.at(-1)?.timestamp;
    const days = latest ? Math.max(0, (new Date(now).getTime() - new Date(latest).getTime()) / 86400000) : null;
    return { topicKey, attempts: group.length, accuracy, mastery: group.length < 5 ? "insufficient-data" : accuracy >= .85 ? "mastered" : accuracy >= .65 ? "developing" : "needs-review", daysSince: days };
  });
  const topicMap = Object.fromEntries(topics.map((t) => [t.topicKey, t]));
  const questionCounts = {};
  for (const q of validQuestions) questionCounts[q.topicKey] = (questionCounts[q.topicKey] ?? 0) + 1;
  return { questions: validQuestions, attempts: normalizedAttempts, topics, topicMap, questionCounts, topicWeights, now: new Date(now).toISOString() };
}

export function selectAdaptiveQuestion(state, { excludedQuestionIds = [], topicKey = null } = {}) {
  const excluded = new Set([...excludedQuestionIds, ...state.attempts.map((a) => a.questionId).filter(Boolean)]);
  const candidates = state.questions.filter((q) => !excluded.has(q.id) && (!topicKey || q.topicKey === topicKey));
  if (!candidates.length) return null;
  const score = (q) => {
    const topic = state.topicMap[q.topicKey];
    const weakness = topic ? 1 - topic.accuracy : .65;
    const uncertainty = !topic || topic.attempts < 5 ? .25 : 0;
    const importance = clamp(Number(state.topicWeights[q.topicKey] ?? 1), .5, 2);
    const availability = Math.log1p(state.questionCounts[q.topicKey] ?? 1);
    return (weakness + uncertainty) * importance * availability;
  };
  candidates.sort((a,b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  return candidates[0];
}

export function evaluateAdaptiveAnswer(question, answerIndex) {
  if (!validQuestion(question)) return { valid: false, correct: false, error: "invalid-question" };
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) return { valid: false, correct: false, error: "invalid-answer" };
  const correct = answerIndex === question.answerIndex;
  return { valid: true, correct, selectedIndex: answerIndex, correctIndex: question.answerIndex, errorType: correct ? null : "content-gap" };
}

export function recordAdaptiveAnswer(state, question, answerIndex, { timestamp = new Date().toISOString(), responseTimeMs = null, errorType = null } = {}) {
  const evaluated = evaluateAdaptiveAnswer(question, answerIndex);
  if (!evaluated.valid) return { state, result: evaluated };
  const attempt = { questionId: question.id, topicKey: question.topicKey, subject: question.subject ?? "", correct: evaluated.correct, timestamp, ...(responseTimeMs === null ? {} : { responseTimeMs }), ...(evaluated.correct ? {} : { errorType: errorType ?? evaluated.errorType }) };
  const nextState = buildAdaptiveTutorState({ questions: state.questions, attempts: [...state.attempts, attempt], now: timestamp, topicWeights: state.topicWeights });
  const feedback = {
    correct: evaluated.correct,
    selectedOption: question.options[answerIndex],
    correctOption: question.options[question.answerIndex],
    explanation: question.explanation ?? "",
    sourceUrl: question.sourceUrl ?? null,
    topicKey: question.topicKey,
    nextRecommendedTopic: nextState.topics.filter((t) => t.topicKey !== question.topicKey).sort((a,b) => a.accuracy-b.accuracy)[0]?.topicKey ?? question.topicKey,
  };
  return { state: nextState, result: { ...evaluated, attempt, feedback } };
}

export function buildTutorNextStep(state) {
  const availableTopics = Object.keys(state.questionCounts);
  const ranked = availableTopics.map((topicKey) => {
    const topic = state.topicMap[topicKey];
    const accuracy = topic?.accuracy ?? 0;
    const attempts = topic?.attempts ?? 0;
    const importance = clamp(Number(state.topicWeights[topicKey] ?? 1), .5, 2);
    return { topicKey, priority: Number(((1-accuracy + (attempts < 5 ? .25 : 0))*importance*Math.log1p(state.questionCounts[topicKey])).toFixed(4)), action: attempts < 5 ? "diagnostic-practice" : accuracy < .65 ? "targeted-review" : accuracy < .85 ? "mixed-practice" : "maintenance-review", rationale: attempts < 5 ? "Poucas respostas registradas; pratique para diagnóstico." : accuracy < .65 ? "Desempenho recente indica necessidade de revisão." : accuracy < .85 ? "Consolide o assunto com questões variadas." : "Mantenha o assunto ativo com revisões espaçadas." };
  }).sort((a,b) => b.priority-a.priority);
  return ranked[0] ?? null;
}
