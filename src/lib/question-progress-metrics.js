export function buildQuestionProgressMetrics({ attempts = [], questions = [] } = {}) {
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const disciplines = new Map();
  const answeredIds = new Set();
  let correct = 0;
  for (const attempt of attempts) {
    if (!attempt || !attempt.questionId) continue;
    const questionId = String(attempt.questionId);
    answeredIds.add(questionId);
    if (attempt.correct) correct += 1;
    const question = questionById.get(questionId);
    const discipline = question?.discipline || "Outras";
    const row = disciplines.get(discipline) || { discipline, attempts: 0, correct: 0, answeredIds: new Set() };
    row.attempts += 1;
    if (attempt.correct) row.correct += 1;
    row.answeredIds.add(questionId);
    disciplines.set(discipline, row);
  }
  const totalAttempts = attempts.filter(attempt => attempt && attempt.questionId).length;
  const byDiscipline = [...disciplines.values()].map(row => ({
    discipline: row.discipline,
    attempts: row.attempts,
    correct: row.correct,
    uniqueAnswered: row.answeredIds.size,
    accuracy: row.attempts ? Math.round(row.correct / row.attempts * 100) : 0
  })).sort((a, b) => b.attempts - a.attempts || a.discipline.localeCompare(b.discipline, "pt-BR"));
  return {
    totalAttempts,
    totalCorrect: correct,
    accuracy: totalAttempts ? Math.round(correct / totalAttempts * 100) : 0,
    uniqueAnswered: answeredIds.size,
    byDiscipline
  };
}
