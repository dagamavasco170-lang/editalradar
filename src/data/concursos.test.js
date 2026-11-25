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
    expect(selection.sourceUrl).toBe("https://ftp.ibge.gov.br/edital/PSS_Censo_Agro/2026_03/EDITAL_03_2026_PSS_RECENSEADOR_IBGE.pdf");
    expect(selection.inscricaoUrl).toBe("https://concursos.cesgranrio.org.br/portal/avaliacoes/33");
    expect(selection.documentos).toHaveLength(1);
  });

  it("cadastra o concurso efetivo de São Miguel dos Milagres com a fonte oficial e a faixa contextualizada", () => {
    const contest = concursos.find((item) => item.id === 520);
    expect(contest).toBeDefined();
    expect(contest.orgao).toBe("Prefeitura Municipal de São Miguel dos Milagres");
    expect(contest.vinculo).toMatch(/concurso público municipal/i);
    expect(contest.area).toBe("Municipal");
    expect(contest.estado).toBe("Alagoas");
    expect(contest.localidade).toBe("São Miguel dos Milagres");
    expect(contest.nivel).toBe("Diversos níveis");
    expect(contest.vagas).toBe(232);
    expect(contest.cargo).toMatch(/82 cargos/);
    expect(contest.status).toMatch(/inscrições abertas até 23\/12\/2026/i);
    expect(contest.sourceUrl).toBe("https://inbraedem.selecao.net.br/informacoes/4/");
    expect(contest.inscricaoUrl).toBe("https://inbraedem.selecao.net.br/area-candidato/concurso/4/inscricao");
    expect(contest.documentos[0].url).toBe("https://anexos-r2.selecao.net.br/uploads/875/concursos/4/anexos/77cdccb3-3cc7-45b9-8c81-c58081cbd4b2.pdf");
    expect(contest.remuneracao.valor).toBe(1621);
    expect(contest.remuneracao.natureza).toContain("chegam a R$ 10.000,00");
  });

  it("registra a data da atualização do conjunto estático", () => {
    expect(sourceUpdated).toBe("Atualizado em 24/11/2026");
  });
});
