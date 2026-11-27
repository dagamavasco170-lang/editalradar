export interface RecommendationQuestion {
  id: string | number;
  discipline?: string | null;
  topic?: string | null;
}

export interface RecommendationAttempt {
  questionId?: string | number | null;
  correct?: boolean;
}

export interface StudyRecommendationsInput {
  questions?: RecommendationQuestion[];
  attempts?: Array<RecommendationAttempt | null>;
  limit?: number;
}

export interface StudyRecommendation {
  topic: string;
  discipline: string;
  attempts: number;
  wrong: number;
  unanswered: number;
  accuracy: number;
  questionCount: number;
  priority: number;
}

export function buildStudyRecommendations({
  questions = [],
  attempts = [],
  limit = 5
}: StudyRecommendationsInput = {}): StudyRecommendation[] {
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const topics = new Map<string, {
    topic: string;
    discipline: string;
    attempts: number;
    wrong: number;
    unanswered: number;
    questions: Set<string>;
  }>();
  const latestByQuestion = new Map<string, RecommendationAttempt>();

  for (const attempt of attempts) {
    if (attempt?.questionId) latestByQuestion.set(String(attempt.questionId), attempt);
  }

  const getRow = (question: RecommendationQuestion) => {
    const discipline = question.discipline || "Outras";
    const topic = String(question.topic || discipline).trim();
    const key = discipline + "::" + topic;
    const row = topics.get(key) || {
      topic,
      discipline,
      attempts: 0,
      wrong: 0,
      unanswered: 0,
      questions: new Set<string>()
    };
    topics.set(key, row);
    return row;
  };

  for (const [questionId, attempt] of latestByQuestion) {
    const question = questionById.get(questionId);
    if (!question) continue;
    const row = getRow(question);
    row.questions.add(questionId);
    row.attempts++;
    if (attempt.correct === false) row.wrong++;
  }

  for (const question of questions) {
    const id = String(question.id);
    if (latestByQuestion.has(id)) continue;
    const row = getRow(question);
    row.unanswered++;
    row.questions.add(id);
  }

  return [...topics.values()].map(row => ({
    topic: row.topic,
    discipline: row.discipline,
    attempts: row.attempts,
    wrong: row.wrong,
    unanswered: row.unanswered,
    accuracy: row.attempts ? Math.round((row.attempts - row.wrong) / row.attempts * 100) : 0,
    questionCount: row.questions.size,
    priority: row.attempts ? Math.round(row.wrong / row.attempts * 100) : 50
  })).sort((a, b) =>
    (b.wrong - a.wrong)
    || (a.accuracy - b.accuracy)
    || (b.unanswered - a.unanswered)
    || a.topic.localeCompare(b.topic, "pt-BR")
  ).slice(0, Math.max(0, limit));
}
