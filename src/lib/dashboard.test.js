import { describe, expect, it } from "vitest";
import { getUpcomingMilestones } from "./dashboard.js";

describe("agenda inteligente do candidato", () => {
  const today = new Date(2026, 10, 21, 12, 0, 0);

  it("inclui datas corrigidas por retificação mesmo quando não estão no campo de situação", () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    const items = [{
      id: 44,
      cargo: "Analista",
      orgao: "Órgão público",
      status: "Edital publicado · inscrições até 20/12/2026",
      prazoInscricao: "20/12/2026",
      dataProva: "22/01/2027",
      dataResultado: "20/03/2027"
    }];
    const events = getUpcomingMilestones(items, now, 10);
    expect(events.map(event => event.type)).toEqual(["deadline", "exam", "result"]);
    expect(events.map(event => event.date.toLocaleDateString("pt-BR"))).toEqual([
      "20/12/2026", "22/01/2027", "20/03/2027"
    ]);
  });

  it("identifica provas, resultados e encerramento de inscrições com datas futuras", () => {
    const catalog = [
      { id: 1, cargo: "Auditor", orgao: "Receita", status: "Prova objetiva em 06/12/2026 · inscrições encerradas" },
      { id: 2, cargo: "Analista", orgao: "Tribunal", status: "Provas realizadas · resultado previsto em 25/11/2026" },
      { id: 3, cargo: "Técnico", orgao: "Universidade", status: "Inscrições abertas até 30/11/2026" }
    ];

    const events = getUpcomingMilestones(catalog, today);

    expect(events.map((event) => [event.id, event.type])).toEqual([
      [2, "result"],
      [3, "deadline"],
      [1, "exam"]
    ]);
    expect(events.map((event) => event.label)).toEqual([
      "Resultado previsto",
      "Fim das inscrições",
      "Prova"
    ]);
  });

  it("ignora datas passadas, registros preliminares e datas citadas apenas nas observações", () => {
    const catalog = [
      { id: 1, cargo: "Resultado antigo", status: "Resultado previsto em 20/11/2026" },
      { id: 2, cargo: "Registro não confirmado", status: "Concurso listado · verificar edital e cronograma", observacao: "Prova em 28/11/2026" },
      { id: 3, cargo: "Sem data no status", status: "Edital publicado", observacao: "Prova em 29/11/2026" },
      { id: 4, cargo: "Data inválida", status: "Prova em 31/02/2027" }
    ];

    expect(getUpcomingMilestones(catalog, today)).toEqual([]);
  });

  it("limita a agenda e trata catálogos ausentes ou entradas inválidas", () => {
    const catalog = [
      { id: 1, cargo: "A", status: "Prova em 22/11/2026" },
      { id: 2, cargo: "B", status: "Prova em 23/11/2026" },
      null
    ];

    expect(getUpcomingMilestones(catalog, today, 1)).toHaveLength(1);
    expect(getUpcomingMilestones(null, today)).toEqual([]);
    expect(getUpcomingMilestones(catalog, today, 0)).toEqual([]);
  });
});
