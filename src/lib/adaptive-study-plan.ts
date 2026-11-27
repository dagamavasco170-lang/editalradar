export type StudyDay = "Seg" | "Ter" | "Qua" | "Qui" | "Sex" | "Sáb" | "Dom";

export interface AdaptiveStudyQuestion {
  id: string | number;
  discipline?: string | null;
  subject?: string | null;
}

export interface AdaptiveStudyAttempt {
  questionId?: string | number | null;
  correct?: boolean;
  at?: string | null;
  discipline?: string | null;
  subject?: string | null;
}

export interface AdaptiveStudyMastery {
  discipline?: string | null;
}

export interface AdaptiveStudySession {
  id: string;
  day: StudyDay;
  subject: string;
  minutes: number;
  accuracy: number;
  attempts: number;
  dueReviews: number;
  knowledgeGap: number;
}

export interface BuildAdaptiveStudySessionsInput {
  subjects?: string[];
  questions?: AdaptiveStudyQuestion[];
  attempts?: Array<AdaptiveStudyAttempt | null>;
  mastery?: AdaptiveStudyMastery[];
  hours?: number;
  days?: string[];
}

const normalize = (value: unknown): string =>
  String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function buildAdaptiveStudySessions({
  subjects = [],
  questions = [],
  attempts = [],
  mastery = [],
  hours = 10,
  days = []
}: BuildAdaptiveStudySessionsInput = {}): AdaptiveStudySession[] {
  const validDays: StudyDay[] = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const chosen = days.filter((day): day is StudyDay => validDays.includes(day as StudyDay));
  if (!chosen.length || !subjects.length) return [];

  const questionMap = new Map<string, AdaptiveStudyQuestion>(questions.map(q => [String(q.id), q]));
  const latest = new Map<string, AdaptiveStudyAttempt>();
  for (const attempt of attempts) {
    if (!attempt?.questionId) continue;
    const key = String(attempt.questionId);
    const previous = latest.get(key);
    const at = Date.parse(attempt.at || "");
    const old = Date.parse(previous?.at || "");
    if (!previous || (!Number.isNaN(at) && (Number.isNaN(old) || at >= old))) latest.set(key, attempt);
  }

  const stats = new Map<string, { attempts: number; correct: number; wrong: number }>();
  for (const attempt of latest.values()) {
    const question = questionMap.get(String(attempt.questionId));
    const subject = question?.discipline || question?.subject || attempt.discipline || attempt.subject;
    if (!subject) continue;
    const key = normalize(subject);
    const row = stats.get(key) || { attempts: 0, correct: 0, wrong: 0 };
    row.attempts++;
    if (attempt.correct === true) row.correct++;
    else row.wrong++;
    stats.set(key, row);
  }

  const weighted = subjects.map(subject => {
    const key = normalize(subject);
    const stat = [...stats.entries()].find(([name]) => name === key || name.includes(key) || key.includes(name))?.[1];
    const accuracy = stat?.attempts ? stat.correct / stat.attempts : 0.5;
    const attemptsCount = stat?.attempts || 0;
    const due = mastery.filter(item => {
      const discipline = normalize(item.discipline);
      return discipline === key || discipline.includes(key) || key.includes(discipline);
    }).length;
    const gap = stat ? stat.wrong / Math.max(stat.attempts, 1) : 0.5;
    const weight = 1 + (1 - accuracy) * 1.7 + Math.min(due, 5) * 0.3 + (attemptsCount < 3 ? 0.5 : 0);
    return { subject, weight, accuracy, attempts: attemptsCount, due, wrong: stat?.wrong || 0, knowledgeGap: gap };
  });

  const total = Math.max(0, Number(hours) || 0) * 60;
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
  const allocations = weighted.map(item => ({ ...item, minutes: Math.floor(total * item.weight / weightTotal) }));
  let remainder = total - allocations.reduce((sum, item) => sum + item.minutes, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % allocations.length) {
    allocations[i].minutes++;
    remainder--;
  }

  const sessions: AdaptiveStudySession[] = [];
  let dayIndex = 0;
  for (const item of [...allocations].sort((a, b) => b.minutes - a.minutes)) {
    let remaining = item.minutes;
    while (remaining > 0) {
      const day = chosen[dayIndex % chosen.length];
      const minutes = Math.min(remaining, Math.ceil(item.minutes / chosen.length));
      const slug = normalize(item.subject).replace(/[^a-z0-9]+/g, "-");
      sessions.push({
        id: day + "-" + slug,
        day,
        subject: item.subject,
        minutes,
        accuracy: Math.round(item.accuracy * 100),
        attempts: item.attempts,
        dueReviews: item.due,
        knowledgeGap: Math.round(item.knowledgeGap * 100)
      });
      remaining -= minutes;
      dayIndex++;
    }
  }
  return sessions.sort((a, b) => chosen.indexOf(a.day) - chosen.indexOf(b.day));
}

export interface DailyAdaptiveGoal {
  day: string;
  minutes: number;
  subjects: string[];
  sessions: number;
}

export function buildDailyAdaptiveGoals({
  sessions = [],
  days = []
}: {
  sessions?: Array<Pick<AdaptiveStudySession, "day" | "minutes" | "subject">>;
  days?: string[];
} = {}): DailyAdaptiveGoal[] {
  return days.map(day => {
    const items = sessions.filter(session => session.day === day);
    return {
      day,
      minutes: items.reduce((sum, session) => sum + session.minutes, 0),
      subjects: items.map(session => session.subject),
      sessions: items.length
    };
  });
}
