const STORAGE_VERSION = 1;

export const activeSimulationStorageKey = (userId) =>
  "er-active-simulator:" + (userId || "visitor");

export function remainingSimulationSeconds(deadlineAt, now = Date.now()) {
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return 0;
  const current = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(current)) return 0;
  return Math.max(0, Math.ceil((deadline - current) / 1000));
}

function getStorage(storage) {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadActiveSimulation(userId, questionBank = [], storage, now = Date.now()) {
  const target = getStorage(storage);
  if (!target) return null;
  const key = activeSimulationStorageKey(userId);
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const source = saved?.version === STORAGE_VERSION ? saved.run : null;
    if (!source || source.finished || typeof source.id !== "string") throw new Error("Estado inválido.");
    if (!Array.isArray(source.questionIds) || ![20, 40, 80].includes(source.questionIds.length)) throw new Error("Quantidade de questões inválida.");
    const ids = source.questionIds.map(String);
    if (new Set(ids).size !== ids.length) throw new Error("Questões repetidas no estado salvo.");
    const questionsById = new Map(questionBank.map(question => [String(question.id), question]));
    const questions = ids.map(id => questionsById.get(id));
    if (questions.some(question => !question || !Array.isArray(question.options))) throw new Error("O banco de questões mudou.");
    const startedAt = Date.parse(source.startedAt);
    const deadline = Date.parse(source.deadlineAt);
    const durationMinutes = Number(source.durationMinutes);
    if (!Number.isFinite(startedAt) || !Number.isFinite(deadline) || deadline <= startedAt) throw new Error("Cronômetro inválido.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < ids.length || durationMinutes > 480) throw new Error("Duração inválida.");
    if (!Number.isInteger(source.currentIndex) || source.currentIndex < 0 || source.currentIndex >= questions.length) throw new Error("Posição inválida.");
    const rawAnswers = source.answers && typeof source.answers === "object" && !Array.isArray(source.answers) ? source.answers : {};
    const answers = {};
    for (const [questionId, selected] of Object.entries(rawAnswers)) {
      const question = questionsById.get(String(questionId));
      const validOptions = question?.options.map(option => Array.isArray(option) ? String(option[1]) : "").filter(Boolean) || [];
      if (ids.includes(String(questionId)) && validOptions.includes(String(selected))) answers[String(questionId)] = String(selected);
    }
    return {
      id: source.id, questions, answers, currentIndex: source.currentIndex,
      startedAt: new Date(startedAt).toISOString(),
      deadlineAt: new Date(deadline).toISOString(),
      durationMinutes, finished: false
    };
  } catch {
    try { target.removeItem(key); } catch { /* armazenamento pode estar indisponível */ }
    return null;
  }
}

export function saveActiveSimulation(userId, run, storage) {
  const target = getStorage(storage);
  if (!target) return false;
  const key = activeSimulationStorageKey(userId);
  if (!run || run.finished) {
    try { target.removeItem(key); return true; } catch { return false; }
  }
  try {
    const payload = {
      version: STORAGE_VERSION,
      run: {
        id: run.id,
        questionIds: run.questions.map(question => String(question.id)),
        answers: run.answers,
        currentIndex: run.currentIndex,
        startedAt: run.startedAt,
        deadlineAt: run.deadlineAt,
        durationMinutes: run.durationMinutes,
        finished: false
      }
    };
    target.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearActiveSimulation(userId, storage) {
  const target = getStorage(storage);
  if (!target) return false;
  try { target.removeItem(activeSimulationStorageKey(userId)); return true; }
  catch { return false; }
}