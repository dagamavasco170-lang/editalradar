import { describe, expect, it } from "vitest";
import { questionBank } from "./question-bank.js";
import { activeSimulationStorageKey, clearActiveSimulation, loadActiveSimulation, remainingSimulationSeconds, saveActiveSimulation } from "./simulator-progress.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    has: key => values.has(key)
  };
}

function sampleRun() {
  const questions = questionBank.slice(0, 20);
  return {
    id: "sim-test-1", questions, answers: { [questions[0].id]: questions[0].options[0][1] },
    currentIndex: 1, startedAt: "2026-11-21T20:00:00.000Z",
    deadlineAt: "2026-11-21T21:00:00.000Z", durationMinutes: 60, finished: false
  };
}

describe("persistência de simulados", () => {
  it("restaura questões, respostas, posição e prazo após recarregar", () => {
    const storage = createStorage();
    const run = sampleRun();
    expect(saveActiveSimulation("user-1", run, storage)).toBe(true);
    const restored = loadActiveSimulation("user-1", questionBank, storage, Date.parse("2026-11-21T20:12:00.000Z"));
    expect(restored?.id).toBe(run.id);
    expect(restored?.questions.map(item => item.id)).toEqual(run.questions.map(item => item.id));
    expect(restored?.answers).toEqual(run.answers);
    expect(restored?.currentIndex).toBe(1);
    expect(restored?.deadlineAt).toBe(run.deadlineAt);
  });

  it("separa sessões por conta e por visitante", () => {
    const storage = createStorage();
    const run = sampleRun();
    saveActiveSimulation("user-1", run, storage);
    expect(loadActiveSimulation("user-2", questionBank, storage)).toBeNull();
    expect(loadActiveSimulation(null, questionBank, storage)).toBeNull();
    expect(storage.has(activeSimulationStorageKey("user-1"))).toBe(true);
  });

  it("não aumenta o tempo restante depois de atualizar a página", () => {
    const deadline = "2026-11-21T21:00:00.000Z";
    expect(remainingSimulationSeconds(deadline, Date.parse("2026-11-21T20:59:58.100Z"))).toBe(2);
    expect(remainingSimulationSeconds(deadline, Date.parse("2026-11-21T21:00:02.000Z"))).toBe(0);
  });

  it("rejeita estado corrompido, IDs desconhecidos e remove o registro inválido", () => {
    const storage = createStorage();
    const key = activeSimulationStorageKey("user-1");
    storage.setItem(key, "{json inválido");
    expect(loadActiveSimulation("user-1", questionBank, storage)).toBeNull();
    expect(storage.has(key)).toBe(false);
    const invalidQuestions = Array.from({ length: 20 }, (_, i) => ({ id: "unknown-" + i, options: [["A", "a"]] }));
    saveActiveSimulation("user-1", { ...sampleRun(), questions: invalidQuestions }, storage);
    expect(loadActiveSimulation("user-1", questionBank, storage)).toBeNull();
  });

  it("filtra respostas que não pertencem às alternativas da questão", () => {
    const storage = createStorage();
    const run = sampleRun();
    run.answers = { [run.questions[0].id]: "invalid", [run.questions[1].id]: run.questions[1].options[0][1] };
    saveActiveSimulation("user-1", run, storage);
    const restored = loadActiveSimulation("user-1", questionBank, storage);
    expect(restored?.answers).toEqual({ [run.questions[1].id]: run.questions[1].options[0][1] });
  });

  it("remove a sessão ao finalizar ou reiniciar o simulado", () => {
    const storage = createStorage();
    const run = sampleRun();
    saveActiveSimulation("user-1", run, storage);
    clearActiveSimulation("user-1", storage);
    expect(loadActiveSimulation("user-1", questionBank, storage)).toBeNull();
    saveActiveSimulation("user-1", run, storage);
    saveActiveSimulation("user-1", { ...run, finished: true }, storage);
    expect(storage.has(activeSimulationStorageKey("user-1"))).toBe(false);
  });
});