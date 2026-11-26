import { describe, expect, it } from "vitest";
import { isPreliminaryContest, matchesContestCatalogFilters } from "./catalog-filters.js";

const defaults = { query: "", nivel: "Todos os níveis", esfera: "Todas as esferas", estado: "Todos os estados", localidade: "Todas as cidades", situacao: "Todas as situações", ocultarPreliminares: false };
const contest = { sigla: "BCB", cargo: "Auditor Fiscal", orgao: "Banco Central", vinculo: "Concurso público", atoOficial: "Portaria MGI", nivel: "Superior", area: "Federal", estado: "Brasil", localidade: "Brasil", status: "Autorizado · pré-edital" };

describe("filtros do catálogo", () => {
  it("busca palavras em campos diferentes sem diferenciar caixa", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "BANCO" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "fiscal" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "inexistente" })).toBe(false);
  });
  it("combina filtros de escolaridade, esfera, estado e cidade", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, nivel: "Superior", esfera: "Federal" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, nivel: "Médio" })).toBe(false);
    expect(matchesContestCatalogFilters(contest, { ...defaults, estado: "Alagoas" })).toBe(false);
  });
  it("identifica situações por palavras-chave", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, situacao: "Pré-edital / anunciado" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, situacao: "Inscrições abertas" })).toBe(false);
    expect(matchesContestCatalogFilters({ ...contest, status: "Inscrições abertas" }, { ...defaults, situacao: "Inscrições abertas" })).toBe(true);
    expect(matchesContestCatalogFilters({ ...contest, status: "Prova prevista e resultado" }, { ...defaults, situacao: "Provas / resultados" })).toBe(true);
  });
  it("aplica filtro para esconder fichas preliminares", () => {
    const preliminary = { ...contest, status: "Concurso listado · verificar" };
    expect(isPreliminaryContest(preliminary)).toBe(true);
    expect(matchesContestCatalogFilters(preliminary, defaults)).toBe(true);
    expect(matchesContestCatalogFilters(preliminary, { ...defaults, ocultarPreliminares: true })).toBe(false);
    expect(isPreliminaryContest(contest)).toBe(false);
  });
  it("trata campos opcionais com valores padrão", () => {
    expect(matchesContestCatalogFilters({}, defaults)).toBe(true);
    expect(matchesContestCatalogFilters({}, { ...defaults, estado: "Brasil" })).toBe(true);
    expect(matchesContestCatalogFilters({}, { ...defaults, esfera: "Estadual" })).toBe(false);
  });
});
