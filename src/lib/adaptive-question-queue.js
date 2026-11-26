export function buildAdaptiveQuestionQueue({ questions = [], latestAttempts = {} } = {}) {
  const disciplineScores = new Map();
  questions.forEach((question) => {
    const attempt = latestAttempts[question.id];
    if (!attempt) return;
    const discipline = question.discipline || "Outras";
    const score = disciplineScores.get(discipline) || { attempts: 0, wrong: 0 };
    score.attempts += 1;
    if (attempt.correct === false) score.wrong += 1;
    disciplineScores.set(discipline, score);
  });
  const disciplineWeakness = new Map([...disciplineScores].map(([discipline, score]) => [
    discipline, score.attempts ? score.wrong / score.attempts : 0
  ]));
  return questions.filter((question) => {
    const attempt = latestAttempts[question.id];
    return !attempt || attempt.correct === false;
  }).sort((a, b) => {
    const aAttempt = latestAttempts[a.id], bAttempt = latestAttempts[b.id];
    const aWrong = aAttempt?.correct === false ? 0 : 1;
    const bWrong = bAttempt?.correct === false ? 0 : 1;
    if (aWrong !== bWrong) return aWrong - bWrong;
    const aWeak = disciplineWeakness.get(a.discipline || "Outras") || 0;
    const bWeak = disciplineWeakness.get(b.discipline || "Outras") || 0;
    if (aWeak !== bWeak) return bWeak - aWeak;
    return questions.indexOf(a) - questions.indexOf(b);
  }).map((question) => question.id);
}
