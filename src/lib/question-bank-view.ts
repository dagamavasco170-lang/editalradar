import { buildAdaptiveQuestionQueue } from "./adaptive-question-queue.js";
import { buildTopicMastery } from "./topic-mastery.ts";
import type { QuestionBankItem } from "../types/question-bank.js";

type Collection = "all" | "adaptive" | "unanswered" | "wrong" | "saved" | "due" | string;
type AttemptLike = { correct?: boolean; at?: string; questionId?: string; [key: string]: unknown };
export interface QuestionBankViewOptions {
  questions?: QuestionBankItem[];
  discipline?: string;
  board?: string;
  topic?: string;
  examYear?: string | number;
  difficulty?: string;
  originFilter?: string;
  questionSearch?: string;
  collection?: Collection;
  sortBy?: string;
  latestAttempts?: Record<string, AttemptLike | undefined>;
  savedQuestions?: Set<string | number>;
  attempts?: AttemptLike[];
}

const normalizeSearch = (value: unknown): string => String(value || "")
  .normalize("NFD")
  .replace(/[\\u0300-\\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/\\s+/g, " ")
  .trim();

const difficultyRank = (value: unknown): number => {
  const normalized = normalizeSearch(value);
  if (normalized.includes("avanc") || normalized.includes("dific")) return 3;
  if (normalized.includes("intermedi") || normalized.includes("medio")) return 2;
  if (normalized.includes("fac")) return 1;
  return 0;
};

export function buildQuestionBankView({
  questions = [],
  discipline = "Todas",
  board = "Todas",
  topic = "Todos os assuntos",
  examYear = "Todos",
  difficulty = "Todas",
  originFilter = "Todas",
  questionSearch = "",
  collection = "all",
  sortBy = "original",
  latestAttempts = {},
  savedQuestions = new Set(),
  attempts = [],
}: QuestionBankViewOptions = {}) {
  const searchTerms = normalizeSearch(questionSearch).split(" ").filter(Boolean);
  const base = questions.filter((question) => {
    const searchableText = normalizeSearch([
      question.prompt, question.topic, question.discipline, question.board,
      (question as QuestionBankItem & { examName?: string }).examName, question.examYear,
    ].join(" "));
    return (discipline === "Todas" || question.discipline === discipline)
      && (board === "Todas" || question.board === board)
      && (topic === "Todos os assuntos" || question.topic === topic)
      && (examYear === "Todos" || String(question.examYear || "") === String(examYear))
      && (difficulty === "Todas" || question.difficulty === difficulty)
      && (originFilter === "Todas"
        || (originFilter === "EditalRadar" && question.origin !== "licensed" && question.origin !== "exam_import")
        || (originFilter === "Provas oficiais e licenciadas" && (question.origin === "licensed" || question.origin === "exam_import")))
      && searchTerms.every((term) => searchableText.includes(term));
  });
  const adaptiveQueue = buildAdaptiveQuestionQueue({ questions: base, latestAttempts, attempts });
  const adaptiveIds = new Set(adaptiveQueue.map(String));
  const adaptiveRank = new Map(adaptiveQueue.map((id, index) => [String(id), index]));
  const dueTopicIds = new Set(buildTopicMastery({ questions: base, attempts })
    .filter((topicRow) => topicRow.due)
    .flatMap((topicRow) => topicRow.questionIds ?? [])
    .map(String));
  const counts = {
    adaptive: adaptiveIds.size,
    all: base.length,
    unanswered: base.filter((question) => !latestAttempts[String(question.id)]).length,
    wrong: base.filter((question) => latestAttempts[String(question.id)]?.correct === false).length,
    saved: base.filter((question) => savedQuestions.has(question.id)).length,
    due: base.filter((question) => dueTopicIds.has(String(question.id))).length,
  };
  const filtered = base.filter((question) => {
    const id = String(question.id);
    if (collection === "adaptive") return adaptiveIds.has(id);
    if (collection === "unanswered") return !latestAttempts[id];
    if (collection === "wrong") return latestAttempts[id]?.correct === false;
    if (collection === "saved") return savedQuestions.has(question.id);
    if (collection === "due") return dueTopicIds.has(id);
    return true;
  });
  const originalOrder = new Map(filtered.map((question, index) => [String(question.id), index]));
  const compareOriginal = (a: QuestionBankItem, b: QuestionBankItem) =>
    (originalOrder.get(String(a.id)) ?? 0) - (originalOrder.get(String(b.id)) ?? 0);
  if (sortBy === "recent") {
    filtered.sort((a, b) => (Number(b.examYear) || 0) - (Number(a.examYear) || 0) || compareOriginal(a, b));
  } else if (sortBy === "difficulty") {
    filtered.sort((a, b) => difficultyRank(b.difficulty) - difficultyRank(a.difficulty) || compareOriginal(a, b));
  } else if (sortBy === "alphabetical") {
    filtered.sort((a, b) => String(a.topic || a.prompt || "").localeCompare(String(b.topic || b.prompt || ""), "pt-BR") || compareOriginal(a, b));
  } else if (sortBy === "least-mastered") {
    filtered.sort((a, b) => {
      const aRank = adaptiveRank.get(String(a.id));
      const bRank = adaptiveRank.get(String(b.id));
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      const aWrong = latestAttempts[String(a.id)]?.correct === false ? 1 : 0;
      const bWrong = latestAttempts[String(b.id)]?.correct === false ? 1 : 0;
      if (aWrong !== bWrong) return bWrong - aWrong;
      const aDue = dueTopicIds.has(String(a.id)) ? 1 : 0;
      const bDue = dueTopicIds.has(String(b.id)) ? 1 : 0;
      return bDue - aDue || compareOriginal(a, b);
    });
  }
  return { base, counts, filtered };
}
