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

  it("cadastra o PSS temporário do IBGE separadamente de concurso efetivo", () => {
    const selection = concursos.find((item) => item.id === 519);
    expect(selection).toBeDefined();
    expect(selection.orgao).toBe("Instituto Brasileiro de Geografia e Estatística");
    expect(selection.vinculo).toMatch(/processo seletivo simplificado.*temporária/i);
    expect(selection.estado).toBe("Alagoas");
    expect(selection.vagas).toBe(421);
    expect(selection.status).toMatch(/inscrições abertas até 25\/11\/2026 às 23h59/i);
    expect(selection.sourceUrl).toMatch(/ftp\.ibge\.gov\.br\/edital/);
    expect(selection.inscricaoUrl).toBe("https://concursos.cesgranrio.org.br/portal/avaliacoes/33");
    expect(selection.documentos).toHaveLength(1);
  });

  it("registra a data da atualização do conjunto estático", () => {
    expect(sourceUpdated).toBe("Atualizado em 24/11/2026");
  });
});
