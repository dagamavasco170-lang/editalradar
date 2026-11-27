import { describe, expect, it } from "vitest";
import { buildQuestionBankView } from "./question-bank-view.js";

const questions = [
  { id: "q1", discipline: "Português", board: "FCC", difficulty: "Fácil", origin: "authored", prompt: "Concordância", topic: "Verbos" },
  { id: "q2", discipline: "Direito", board: "CESPE", difficulty: "Avançada", origin: "licensed", prompt: "Constituição", topic: "Direitos", examName: "Prova TJ" },
  { id: "q3", discipline: "Português", board: "FCC", difficulty: "Intermediária", origin: "exam_import", prompt: "Regência", topic: "Crase" },
];

describe("visão do banco de questões", () => {
  it("aplica disciplina, banca, dificuldade e busca sem diferenciar maiúsculas", () => {
    const view = buildQuestionBankView({ questions, discipline: "Português", board: "FCC", questionSearch: "REGÊNCIA" });
    expect(view.base.map((q) => q.id)).toEqual(["q3"]);
    expect(view.filtered).toEqual(view.base);
  });

  it("filtra corretamente questões autorais versus provas oficiais/licenciadas", () => {
    expect(buildQuestionBankView({ questions, originFilter: "EditalRadar" }).base.map(q => q.id)).toEqual(["q1"]);
    expect(buildQuestionBankView({ questions, originFilter: "Provas oficiais e licenciadas" }).base.map(q => q.id)).toEqual(["q2", "q3"]);
  });

  it("contabiliza todas, não respondidas, erradas e salvas sobre os filtros base", () => {
    const view = buildQuestionBankView({ questions, latestAttempts: { q1: { correct: true }, q2: { correct: false } }, savedQuestions: new Set(["q3"]) });
    expect(view.counts).toEqual({ adaptive: 2, all: 3, unanswered: 1, wrong: 1, saved: 1, due: 3 });
  });

  it("retorna coleção não respondida, caderno de erros ou salvas", () => {
    const attempts = { q1: { correct: true }, q2: { correct: false } };
    expect(buildQuestionBankView({ questions, latestAttempts: attempts, collection: "unanswered" }).filtered.map(q => q.id)).toEqual(["q3"]);
    expect(buildQuestionBankView({ questions, latestAttempts: attempts, collection: "wrong" }).filtered.map(q => q.id)).toEqual(["q2"]);
    expect(buildQuestionBankView({ questions, savedQuestions: new Set(["q1", "q3"]), collection: "saved" }).filtered.map(q => q.id)).toEqual(["q1", "q3"]);
  });

  it("mantém resultado vazio para filtro sem correspondência", () => {
    const view = buildQuestionBankView({ questions, discipline: "Matemática" });
    expect(view.base).toEqual([]);
    expect(view.counts).toEqual({ adaptive: 0, all: 0, unanswered: 0, wrong: 0, saved: 0, due: 0 });
    expect(view.filtered).toEqual([]);
  });

  it("tolera campos de texto ausentes", () => {
    expect(buildQuestionBankView({ questions: [{ id: "q", discipline: "X" }], questionSearch: "tema" }).base).toEqual([]);
  });

  it("busca sem diferenciar acentos e também encontra banca e ano", () => {
    const datedQuestion = { ...questions[0], examYear: 2024 };
    expect(buildQuestionBankView({ questions: [datedQuestion], questionSearch: "portugues" }).base.map(question => question.id)).toEqual(["q1"]);
    expect(buildQuestionBankView({ questions: [datedQuestion], questionSearch: "fcc 2024" }).base).toHaveLength(1);
    expect(buildQuestionBankView({ questions: [datedQuestion], questionSearch: "2024 FCC portugues" }).base).toHaveLength(1);
  });

  it("filtra por assunto e ano da prova sem alterar as contagens das coleções", () => {
    const datedQuestions = [
      { ...questions[0], examYear: 2023 },
      { ...questions[1], examYear: 2024 },
      { ...questions[2], examYear: 2024 }
    ];
    const view = buildQuestionBankView({
      questions: datedQuestions,
      topic: "Direitos",
      examYear: "2024",
      latestAttempts: { q2: { correct: false } }
    });
    expect(view.base.map(question => question.id)).toEqual(["q2"]);
    expect(view.counts).toMatchObject({ all: 1, wrong: 1, unanswered: 0 });
  });

  it("mantém compatibilidade quando as questões não possuem ano ou assunto", () => {
    const view = buildQuestionBankView({
      questions: [{ id: "legacy", discipline: "Direito", prompt: "Constituição" }],
      topic: "Todos os assuntos",
      examYear: "Todos"
    });
    expect(view.filtered.map(question => question.id)).toEqual(["legacy"]);
  });
});
