const DAY_MS = 24 * 60 * 60 * 1000;

export interface StudyQuestion {
  id: string | number;
  discipline?: string | null;
  topic?: string | null;
}

export interface StudyAttempt {
  questionId?: string | number | null;
  correct?: boolean;
  at?: string | null;
}

export interface TopicMasteryInput {
  questions?: StudyQuestion[];
  attempts?: Array<StudyAttempt | null>;
  now?: number;
}

export interface TopicMasteryRow {
  discipline: string;
  topic: string;
  attempts: number;
  correct: number;
  wrong: number;
  unanswered: number;
  lastActivity: number | null;
  questionCount: number;
  questionIds: string[];
  accuracy: number;
  mastery: "starting" | "developing" | "strong";
  streak: number;
  unlockedLevel: "Fácil" | "Médio" | "Difícil";
  nextLevel: "Médio" | "Difícil";
  intervalDays: number;
  dueAt: number;
  due: boolean;
}

export interface WeeklyStudyDay {
  date: string;
  attempts: number;
  correct: number;
}

function toTimestamp(value: string | null | undefined): number | null {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildTopicMastery({
  questions = [],
  attempts = [],
  now = Date.now()
}: TopicMasteryInput = {}): TopicMasteryRow[] {
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const latest = new Map<string, StudyAttempt>();

  for (const attempt of attempts) {
    if (!attempt?.questionId) continue;
    const id = String(attempt.questionId);
    const previous = latest.get(id);
    const at = toTimestamp(attempt.at);
    const previousAt = toTimestamp(previous?.at);
    if (!previous || (at !== null && (previousAt === null || at >= previousAt))) latest.set(id, attempt);
  }

  const topics = new Map<string, {
    discipline: string;
    topic: string;
    attempts: number;
    correct: number;
    wrong: number;
    unanswered: number;
    lastActivity: number | null;
    questionCount: number;
    questionIds: string[];
  }>();

  const rowFor = (question: StudyQuestion) => {
    const discipline = question.discipline || "Outras";
    const topic = String(question.topic || discipline).trim() || discipline;
    const key = discipline + "::" + topic;
    if (!topics.has(key)) {
      topics.set(key, {
        discipline,
        topic,
        attempts: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        lastActivity: null,
        questionCount: 0,
        questionIds: []
      });
    }
    return topics.get(key)!;
  };

  for (const question of questions) {
    const row = rowFor(question);
    row.questionCount++;
    row.questionIds.push(String(question.id));
    const attempt = latest.get(String(question.id));
    if (!attempt) {
      row.unanswered++;
      continue;
    }
    row.attempts++;
    if (attempt.correct === true) row.correct++;
    else row.wrong++;
    const at = toTimestamp(attempt.at);
    if (at !== null && (row.lastActivity === null || at > row.lastActivity)) row.lastActivity = at;
  }

  return [...topics.values()].map(row => {
    const history = attempts
      .filter((attempt): attempt is StudyAttempt =>
        Boolean(attempt?.questionId)
        && row.questionIds.includes(String(attempt.questionId))
        && toTimestamp(attempt.at) !== null
      )
      .sort((a, b) => (toTimestamp(a.at) ?? 0) - (toTimestamp(b.at) ?? 0));

    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].correct === true) streak++;
      else break;
    }

    const accuracy = row.attempts ? Math.round(row.correct / row.attempts * 100) : 0;
    const mastery = row.attempts < 2 ? "starting" : accuracy >= 80 ? "strong" : "developing";
    const intervalDays = row.attempts === 0 ? 0
      : streak >= 5 && accuracy >= 85 ? 14
      : streak >= 3 && accuracy >= 80 ? 7
      : accuracy >= 85 ? 7
      : accuracy >= 65 ? 3
      : 1;
    const unlockedLevel = streak >= 5 && accuracy >= 85 ? "Difícil"
      : streak >= 3 && accuracy >= 70 ? "Médio"
      : "Fácil";
    const nextLevel = unlockedLevel === "Fácil" ? "Médio" : "Difícil";
    const dueAt = row.lastActivity === null ? now : row.lastActivity + intervalDays * DAY_MS;

    return {
      ...row,
      accuracy,
      mastery,
      streak,
      unlockedLevel,
      nextLevel,
      intervalDays,
      dueAt,
      due: dueAt <= now
    };
  }).sort((a, b) =>
    (Number(b.due) - Number(a.due))
    || (b.wrong - a.wrong)
    || (a.accuracy - b.accuracy)
    || a.topic.localeCompare(b.topic, "pt-BR")
  );
}

export interface WeeklyStudyProgressInput {
  attempts?: Array<StudyAttempt | null>;
  now?: number;
}

export function buildWeeklyStudyProgress({
  attempts = [],
  now = Date.now()
}: WeeklyStudyProgressInput = {}): WeeklyStudyDay[] {
  const start = now - 6 * DAY_MS;
  const byDay: WeeklyStudyDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start + index * DAY_MS);
    return { date: date.toISOString().slice(0, 10), attempts: 0, correct: 0 };
  });
  const days = new Map(byDay.map(day => [day.date, day]));

  for (const attempt of attempts) {
    const at = toTimestamp(attempt?.at);
    if (at === null || at < start || at > now) continue;
    const day = days.get(new Date(at).toISOString().slice(0, 10));
    if (day) {
      day.attempts++;
      if (attempt?.correct === true) day.correct++;
    }
  }
  return byDay;
}
