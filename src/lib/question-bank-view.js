import { buildAdaptiveQuestionQueue } from "./adaptive-question-queue.js";
import { buildTopicMastery } from "./topic-mastery.js";

const normalizeSearch = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/\s+/g, " ")
  .trim();

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
  latestAttempts = {},
  savedQuestions = new Set(),
  attempts = []
} = {}) {
  const search = normalizeSearch(questionSearch);
  const base = questions.filter((question) => {
    const searchableText = normalizeSearch([
      question.prompt,
      question.topic,
      question.discipline,
      question.board,
      question.examName,
      question.examYear
    ].join(" "));
    return (discipline === "Todas" || question.discipline === discipline)
      && (board === "Todas" || question.board === board)
      && (topic === "Todos os assuntos" || question.topic === topic)
      && (examYear === "Todos" || String(question.examYear || "") === String(examYear))
      && (difficulty === "Todas" || question.difficulty === difficulty)
      && (originFilter === "Todas"
        || (originFilter === "EditalRadar" && question.origin !== "licensed" && question.origin !== "exam_import")
        || (originFilter === "Provas oficiais e licenciadas" && (question.origin === "licensed" || question.origin === "exam_import")))
      && (!search || searchableText.includes(search));
  });

  const adaptiveIds = new Set(buildAdaptiveQuestionQueue({ questions: base, latestAttempts }));
  const dueTopicIds = new Set(buildTopicMastery({ questions: base, attempts }).filter((topicRow) => topicRow.due).flatMap((topicRow) => topicRow.questionIds));
  const counts = {
    adaptive: adaptiveIds.size,
    all: base.length,
    unanswered: base.filter((question) => !latestAttempts[question.id]).length,
    wrong: base.filter((question) => latestAttempts[question.id]?.correct === false).length,
    saved: base.filter((question) => savedQuestions.has(question.id)).length,
    due: base.filter((question) => dueTopicIds.has(String(question.id))).length,
  };
  const filtered = base.filter((question) => {
    if (collection === "adaptive") return adaptiveIds.has(question.id);
    if (collection === "unanswered") return !latestAttempts[question.id];
    if (collection === "wrong") return latestAttempts[question.id]?.correct === false;
    if (collection === "saved") return savedQuestions.has(question.id);
    if (collection === "due") return dueTopicIds.has(String(question.id));
    return true;
  });
  return { base, counts, filtered };
}
