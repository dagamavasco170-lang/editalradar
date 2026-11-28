/** Deterministic question-bank analytics; no model training or source ingestion. */
const clean = (value) => typeof value === "string" ? value.trim() : "";
const keyOf = (value) => clean(value).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const finite = (value) => Number.isFinite(value) ? value : null;

export function validateQuestionRecord(question) {
  const errors = [];
  if (!question || typeof question !== "object" || Array.isArray(question)) return { valid: false, errors: ["question-must-be-object"] };
  if (!clean(question.id)) errors.push("missing-id");
  if (!clean(question.subject)) errors.push("missing-subject");
  if (!clean(question.topic)) errors.push("missing-topic");
  if (!clean(question.statement) || clean(question.statement).length < 20) errors.push("statement-too-short");
  if (!Array.isArray(question.options) || question.options.length < 2) errors.push("options-required");
  else if (question.options.some((option) => typeof option !== "string" || !option.trim())) errors.push("invalid-option");
  if (!Number.isInteger(question.answerIndex) || !Array.isArray(question.options) || question.answerIndex < 0 || question.answerIndex >= question.options.length) errors.push("invalid-answer-index");
  if (question.difficulty !== undefined && !["easy", "medium", "hard"].includes(question.difficulty)) errors.push("invalid-difficulty");
  if (question.sourceUrl !== undefined && question.sourceUrl !== null && !/^https:\\/\\//i.test(question.sourceUrl)) errors.push("source-url-must-be-https");
  return { valid: errors.length === 0, errors };
}

export function normalizeQuestionRecord(question) {
  const validation = validateQuestionRecord(question);
  if (!validation.valid) return { valid: false, errors: validation.errors };
  return { valid: true, question: {
    id: clean(question.id), subject: clean(question.subject), subjectKey: keyOf(question.subject),
    topic: clean(question.topic), topicKey: keyOf(question.topic), statement: clean(question.statement),
    options: question.options.map((option) => option.trim()), answerIndex: question.answerIndex,
    difficulty: question.difficulty ?? "unrated", board: clean(question.board) || "unspecified",
    boardKey: keyOf(question.board) || "unspecified", sourceUrl: question.sourceUrl ?? null,
    explanation: clean(question.explanation), tags: Array.isArray(question.tags) ? question.tags.map(clean).filter(Boolean) : [],
  }};
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = item[key] || "unspecified";
    groups.set(value, (groups.get(value) || 0) + 1);
  }
  return groups;
}
const rows = (map, total) => [...map.entries()].map(([key, count]) => ({ key, count, share: total ? Number((count / total).toFixed(4)) : 0 })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

/** Produces bank/topic/bank-profile statistics using only supplied question records. */
export function analyzeQuestionBank(records = []) {
  const normalized = [];
  const rejected = [];
  const ids = new Set();
  for (const record of records) {
    const result = normalizeQuestionRecord(record);
    if (!result.valid) { rejected.push({ id: record?.id ?? null, errors: result.errors }); continue; }
    if (ids.has(result.question.id)) { rejected.push({ id: result.question.id, errors: ["duplicate-id"] }); continue; }
    ids.add(result.question.id);
    normalized.push(result.question);
  }
  const total = normalized.length;
  const subjects = rows(groupBy(normalized, "subjectKey"), total);
  const topics = rows(groupBy(normalized, "topicKey"), total).map((row) => {
    const matching = normalized.filter((question) => question.topicKey === row.key);
    const subjectCounts = groupBy(matching, "subjectKey");
    return { ...row, subjects: rows(subjectCounts, matching.length), difficulty: rows(groupBy(matching, "difficulty"), matching.length), boards: rows(groupBy(matching, "boardKey"), matching.length) };
  });
  const boards = rows(groupBy(normalized, "boardKey"), total).map((row) => {
    const matching = normalized.filter((question) => question.boardKey === row.key);
    return { ...row, subjects: rows(groupBy(matching, "subjectKey"), matching.length), topics: rows(groupBy(matching, "topicKey"), matching.length), difficulty: rows(groupBy(matching, "difficulty"), matching.length) };
  });
  return { total, rejectedCount: rejected.length, subjects, topics, boards, rejected };
}

/** Prioritizes weak topics using accuracy, question availability, and explicit edital weight. */
export function recommendPracticeTopics({ questionAnalysis, learningProfile, topicWeights = {}, limit = 10 } = {}) {
  const available = new Map((questionAnalysis?.topics || []).map((topic) => [topic.key, topic]));
  const learnerTopics = learningProfile?.topics || [];
  const recommendations = learnerTopics.filter((topic) => available.has(topic.topicKey)).map((topic) => {
    const bank = available.get(topic.topicKey);
    const weight = Math.min(2, Math.max(0.5, Number(topicWeights[topic.topicKey] ?? 1)));
    const uncertainty = topic.mastery === "insufficient-data" ? 0.3 : 0;
    const weakness = 1 - Math.max(0, Math.min(1, Number(topic.weightedAccuracy ?? 0)));
    const priority = Number(((weakness + uncertainty) * weight * Math.log1p(bank.count)).toFixed(4));
    return { topicKey: topic.topicKey, questionCount: bank.count, weightedAccuracy: topic.weightedAccuracy ?? null, mastery: topic.mastery ?? "insufficient-data", priority, rationale: topic.mastery === "insufficient-data" ? "Há questões disponíveis, mas ainda faltam tentativas para estimar domínio." : "Prioridade combina desempenho recente, peso do edital e disponibilidade de questões." };
  }).sort((a, b) => b.priority - a.priority).slice(0, Math.max(1, Math.min(50, Math.floor(limit) || 10)));
  return recommendations;
}

/** Checks generated items before they enter a practice session. */
export function validateGeneratedQuestion(question) {
  const errors = validateQuestionRecord(question).errors;
  if (question && typeof question === "object") {
    if (question.explanation !== undefined && (typeof question.explanation !== "string" || question.explanation.trim().length < 20)) errors.push("explanation-too-short");
    if (question.sourceUrl === undefined || question.sourceUrl === null || !String(question.sourceUrl).trim()) errors.push("source-reference-required");
    if (Array.isArray(question.options) && new Set(question.options.map((option) => clean(option).toLowerCase())).size !== question.options.length) errors.push("duplicate-options");
  }
  return { valid: errors.length === 0, errors };
}
