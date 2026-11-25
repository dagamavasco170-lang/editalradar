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

  it("cadastra o concurso do CRO/PR com inscrição futura e edital oficial", () => {
    const contest = concursos.find((item) => item.id === 521);
    expect(contest).toBeDefined();
    expect(contest.orgao).toBe("Conselho Regional de Odontologia do Paraná");
    expect(contest.vagas).toBe(12);
    expect(contest.status).toMatch(/inscrições começam em 30\/11\/2026/i);
    expect(contest.sourceUrl).toBe("https://conhecimento.fgv.br/concursos/cropr");
    expect(contest.documentos[0].url).toBe("https://conhecimento.fgv.br/sites/default/files/concursos/edital-cro-pr.pdf");
    expect(contest.remuneracao.natureza).toContain("14.318,45");
  });

  it("cadastra Custódia com vagas imediatas e cadastro reserva separados", () => {
    const contest = concursos.find((item) => item.id === 522);
    expect(contest).toBeDefined();
    expect(contest.estado).toBe("Pernambuco");
    expect(contest.vagasImediatas).toBe(384);
    expect(contest.cadastroReserva).toBe(819);
    expect(contest.vagasTotais).toBe(1203);
    expect(contest.status).toMatch(/18\/12\/2026/);
    expect(contest.documentos[0].url).toContain("/192/anexos/");
  });

  it("cadastra São Caetano com as 46 vagas do edital", () => {
    const contest = concursos.find((item) => item.id === 523);
    expect(contest).toBeDefined();
    expect(contest.estado).toBe("Pernambuco");
    expect(contest.vagas).toBe(46);
    expect(contest.cargo).toContain("Procurador");
    expect(contest.status).toMatch(/10\/12\/2026/);
    expect(contest.remuneracao.valor).toBe(2051.03);
  });

  it("cadastra IFG com distribuição por nível e diferencia vencimento básico do total", () => {
    const contest = concursos.find((item) => item.id === 524);
    expect(contest).toBeDefined();
    expect(contest.estado).toBe("Goiás");
    expect(contest.vagas).toBe(36);
    expect(contest.nivel).toBe("Médio, Técnico e Superior");
    expect(contest.status).toMatch(/23\/12\/2026/);
    expect(contest.observacao).toMatch(/14\/02\/2027/);
    expect(contest.remuneracao.natureza).toContain("R$ 2.607,70");
    expect(contest.remuneracao.natureza).toContain("R$ 5.215,39");
    expect(contest.remuneracao.observacao).toContain("R$ 10.318,93");
  });


  it("cadastra SEDUC-SP com apenas as 5.000 vagas efetivas e inscrição futura", () => {
    const contest = concursos.find((item) => item.id === 525);
    expect(contest).toBeDefined();
    expect(contest.orgao).toBe("Secretaria da Educação do Estado de São Paulo");
    expect(contest.vagas).toBe(5000);
    expect(contest.vagasTotais).toBe(5000);
    expect(contest.status).toMatch(/inscrições começam em 26\/11\/2026 às 16h/i);
    expect(contest.sourceUrl).toBe("https://conhecimento.fgv.br/concursos/concursoseducsp27");
    expect(contest.documentos[0].url).toBe("https://conhecimento.fgv.br/sites/default/files/concursos/edital_pefm_2027_retificado.pdf");
    expect(contest.remuneracao.natureza).toContain("R$ 3.478,13");
    expect(contest.remuneracao.natureza).toContain("R$ 5.565,00");
    expect(contest.observacao).toMatch(/lista separada para contratação temporária/);
    expect(contest.observacao).toMatch(/não representa vagas efetivas adicionais/);
  });

  it("registra a data da atualização do conjunto estático", () => {
    expect(sourceUpdated).toBe("Atualizado em 25/11/2026");
  });
});
