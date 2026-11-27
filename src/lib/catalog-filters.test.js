import { describe, expect, it } from "vitest";
import { isPreliminaryContest, matchesContestCatalogFilters, normalizeCatalogSearchText } from "./catalog-filters.js";

const defaults = {
  query: "",
  nivel: "Todos os níveis",
  esfera: "Todas as esferas",
  estado: "Todos os estados",
  localidade: "Todas as cidades",
  situacao: "Todas as situações",
  ocultarPreliminares: false
};

const contest = {
  sigla: "BCB",
  cargo: "Auditor Fiscal",
  orgao: "Banco Central",
  vinculo: "Concurso público",
  atoOficial: "Portaria MGI",
  nivel: "Superior",
  area: "Federal",
  estado: "Brasil",
  localidade: "Brasil",
  status: "Autorizado · pré-edital",
  observacao: "Comissão formada para área de fiscalização",
  remuneracao: { valor: 20000, natureza: "Inicial" }
};

describe("filtros do catálogo", () => {
  it("normaliza acentos, caixa e separadores", () => {
    expect(normalizeCatalogSearchText("PORTUGUÊS — Pré-edital")).toBe("portugues pre edital");
    expect(matchesContestCatalogFilters({ ...contest, cargo: "Analista de Português" }, { ...defaults, query: "portugues" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "pre edital" })).toBe(true);
  });

  it("busca em diferentes campos, incluindo observações e remuneração", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "BANCO" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "fiscal" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "comissao formada" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "20000" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, query: "inexistente" })).toBe(false);
  });

  it("combina escolaridade, esfera, estado e cidade", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, nivel: "Superior", esfera: "Federal" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, nivel: "Médio" })).toBe(false);
    expect(matchesContestCatalogFilters(contest, { ...defaults, estado: "Alagoas" })).toBe(false);
  });

  it("filtra situações por status sem depender de acentuação", () => {
    expect(matchesContestCatalogFilters(contest, { ...defaults, situacao: "Pré-edital / anunciado" })).toBe(true);
    expect(matchesContestCatalogFilters(contest, { ...defaults, situacao: "Inscrições abertas" })).toBe(false);
    expect(matchesContestCatalogFilters({ ...contest, status: "Inscrições abertas" }, { ...defaults, situacao: "Inscrições abertas" })).toBe(true);
    expect(matchesContestCatalogFilters({ ...contest, status: "Prova prevista e resultado" }, { ...defaults, situacao: "Provas / resultados" })).toBe(true);
  });

  it("oculta fichas preliminares quando solicitado", () => {
    const preliminary = { ...contest, status: "Concurso listado · verificar" };
    expect(isPreliminaryContest(preliminary)).toBe(true);
    expect(matchesContestCatalogFilters(preliminary, defaults)).toBe(true);
    expect(matchesContestCatalogFilters(preliminary, { ...defaults, ocultarPreliminares: true })).toBe(false);
    expect(isPreliminaryContest(contest)).toBe(false);
  });

  it("mantém padrões para campos opcionais", () => {
    expect(matchesContestCatalogFilters({}, defaults)).toBe(true);
    expect(matchesContestCatalogFilters({}, { ...defaults, estado: "Brasil" })).toBe(true);
    expect(matchesContestCatalogFilters({}, { ...defaults, esfera: "Estadual" })).toBe(false);
  });
});
