import { describe, expect, it } from "vitest";
import { getRecommendationMatch, getRecommendationReasons, scoreRecommendation } from "./recommendation-matching.js";

const profile = {
  interest_area: "Fiscal e controle",
  education_level: "Superior completo",
  state: "Alagoas",
  city: "Maceió"
};

describe("compatibilidade das recomendações do catálogo", () => {
  it("reconhece área de interesse sem confundir esfera federal com área profissional", () => {
    const item = { cargo: "Auditor Fiscal", orgao: "Receita Estadual", area: "Estadual", estado: "Alagoas", localidade: "Maceió", nivel: "Superior" };
    expect(getRecommendationMatch(item, profile).areaMatches).toBe(true);
    expect(getRecommendationMatch({ ...item, cargo: "Professor", orgao: "Secretaria de Educação" }, profile).areaMatches).toBe(false);
  });

  it("normaliza acentos e variações de escrita em estado e cidade", () => {
    const item = { cargo: "Auditor de Tributos", estado: "ALAGOAS", localidade: "MACEIO", nivel: "Superior", status: "Inscrições abertas" };
    const match = getRecommendationMatch(item, profile);
    expect(match.stateMatches).toBe(true);
    expect(match.cityMatches).toBe(true);
    expect(match.active).toBe(true);
  });

  it("mantém concursos nacionais compatíveis mesmo quando a localização do perfil é específica", () => {
    const item = { cargo: "Auditor Federal", orgao: "Órgão nacional", estado: "Brasil", localidade: "Brasil", nivel: "Superior" };
    const match = getRecommendationMatch(item, profile);
    expect(match.national).toBe(true);
    expect(match.stateMatches).toBe(true);
    expect(match.cityMatches).toBe(true);
    expect(scoreRecommendation(item, profile)).toBeGreaterThanOrEqual(25);
    expect(getRecommendationReasons(item, profile)).toContain("Abrangência nacional");
  });

  it("não concede compatibilidade geográfica a uma vaga local de outro estado", () => {
    const item = { cargo: "Auditor Fiscal", estado: "Pernambuco", localidade: "Recife", nivel: "Superior" };
    const match = getRecommendationMatch(item, profile);
    expect(match.stateMatches).toBe(false);
    expect(match.cityMatches).toBe(false);
  });

  it("trata escolaridade não informada como neutra, sem reprovar a recomendação", () => {
    expect(getRecommendationMatch({ cargo: "Auditor Fiscal", nivel: "" }, profile).educationMatches).toBe(true);
  });

  it("retorna score limitado à escala de 0 a 100", () => {
    const item = { cargo: "Auditor Fiscal", estado: "Alagoas", localidade: "Maceió", nivel: "Superior", status: "Inscrições abertas" };
    expect(scoreRecommendation(item, profile)).toBe(100);
  });
});
