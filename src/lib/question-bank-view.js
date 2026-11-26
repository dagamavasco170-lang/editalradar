const normalizeSearch = (value) => String(value || "").trim().toLocaleLowerCase("pt-BR");

export function buildQuestionBankView({ questions = [], discipline = "Todas", board = "Todas", difficulty = "Todas", originFilter = "Todas", questionSearch = "", collection = "all", latestAttempts = {}, savedQuestions = new Set() } = {}) {
  const search = normalizeSearch(questionSearch);
  const base = questions.filter((question) =>
    (discipline === "Todas" || question.discipline === discipline)
    && (board === "Todas" || question.board === board)
    && (difficulty === "Todas" || question.difficulty === difficulty)
    && (originFilter === "Todas"
      || (originFilter === "EditalRadar" && question.origin !== "licensed" && question.origin !== "exam_import")
      || (originFilter === "Provas oficiais e licenciadas" && (question.origin === "licensed" || question.origin === "exam_import")))
    && (!search || normalizeSearch([question.prompt, question.topic, question.discipline, question.examName].join(" ")).includes(search))
  );

  const counts = {
    all: base.length,
    unanswered: base.filter((question) => !latestAttempts[question.id]).length,
    wrong: base.filter((question) => latestAttempts[question.id]?.correct === false).length,
    saved: base.filter((question) => savedQuestions.has(question.id)).length,
  };
  const filtered = base.filter((question) => {
    if (collection === "unanswered") return !latestAttempts[question.id];
    if (collection === "wrong") return latestAttempts[question.id]?.correct === false;
    if (collection === "saved") return savedQuestions.has(question.id);
    return true;
  });
  return { base, counts, filtered };
}
