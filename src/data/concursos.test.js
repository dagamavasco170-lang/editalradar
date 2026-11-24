import { describe, expect, it } from "vitest";
import { concursos, sourceUpdated } from "./concursos.js";

describe("Atualização temporal do catálogo", () => {
  it.each([
    [517, "PMPE"],
    [518, "CBMPE"]
  ])("%s (%s) não permanece aberto após o prazo de 23/11/2026", (id, sigla) => {
    const contest = concursos.find((item) => item.id === id);
    expect(contest).toBeDefined();
    expect(contest.sigla).toBe(sigla);
    expect(contest.status).toMatch(/inscrições encerradas em 23\/11\/2026 às 14h/i);
    expect(contest.status).not.toMatch(/inscrições abertas/i);
  });

  it("mantém as 60 vagas da CGU distribuídas entre as quatro fichas estáticas", () => {
    const cgu = concursos.filter((item) => item.orgao === "Controladoria-Geral da União");
    expect(cgu).toHaveLength(4);
    expect(cgu.reduce((total, item) => total + Number(item.vagas || 0), 0)).toBe(60);
  });

  it("registra a data da atualização do conjunto estático", () => {
    expect(sourceUpdated).toBe("Atualizado em 24/11/2026");
  });
});
