import { describe, expect, it } from "vitest";
import { buildContestChangeHistory, describeContestHistoryEntry, formatContestHistoryDate } from "./admin-history.js";

describe("histórico de alterações do catálogo", () => {
  it("registra somente campos que realmente mudaram", () => {
    const previous = { cargo: "Analista", orgao: "Órgão A", vagas: 10, status: "Edital publicado", historicoAtualizacoes: [] };
    const next = { cargo: "Analista", orgao: "Órgão A", vagas: 20, status: "Inscrições abertas" };
    const history = buildContestChangeHistory(previous, next, {
      at: "2026-11-22T12:00:00.000Z",
      actor: "admin@example.com"
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      at: "2026-11-22T12:00:00.000Z",
      actor: "admin@example.com",
      summary: "Vagas: 10 → 20 · Situação: Edital publicado → Inscrições abertas"
    });
    expect(history[0].changes).toEqual([
      { field: "vagas", label: "Vagas", from: "10", to: "20" },
      { field: "status", label: "Situação", from: "Edital publicado", to: "Inscrições abertas" }
    ]);
  });


  it("resume alterações em linguagem simples e substitui resumo genérico antigo", () => {
    expect(describeContestHistoryEntry({
      summary: "3 campo(s) alterado(s)",
      changes: [
        { label: "Vagas", from: "10", to: "20" },
        { label: "Situação", from: "Em preparação", to: "Inscrições abertas" },
        { label: "Prazo", from: "Não informado", to: "30/11" }
      ]
    })).toBe("Vagas: 10 → 20 · Situação: Em preparação → Inscrições abertas · +1 outra(s) alteração(ões)");
  });
\n  it("não cria eventos quando os dados não mudaram e preserva histórico antigo", () => {
    const history = [{ id: "old", at: "2026-11-20T10:00:00Z", changes: [] }];
    expect(buildContestChangeHistory(
      { cargo: "Analista", historicoAtualizacoes: history },
      { cargo: "Analista" },
      { at: "2026-11-22T12:00:00Z" }
    )).toEqual(history);
  });

  it("limita valores exibidos e mantém no máximo cinquenta eventos", () => {
    const previous = { historicoAtualizacoes: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })) };
    const history = buildContestChangeHistory(previous, { cargo: "novo" }, { at: "2026-11-22T12:00:00Z" });
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe("2");
    expect(history.at(-1).changes[0].to).toBe("novo");
  });

  it("formata datas inválidas sem quebrar a tela", () => {
    expect(formatContestHistoryDate("não é data")).toBe("Data não informada");
  });
});
