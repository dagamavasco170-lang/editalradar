import { describe, expect, it } from "vitest";
import { isTrustedOfficialHostname, isTrustedOfficialUrl, officialSourceLabel, parseHttpsUrl } from "./official-sources.js";

describe("validação de fontes privadas de estudo", () => {
  it("aceita apenas editoras, plataformas e organizações educacionais privadas selecionadas", () => {
    for (const url of [
      "https://brasilescola.uol.com.br/gramatica",
      "https://www.mundoeducacao.uol.com.br/matematica",
      "https://www.todamateria.com.br/materias/",
      "https://pt.khanacademy.org/math",
      "https://www.politize.com.br/trilhas/politicas-publicas/",
      "https://www.jrconcursos.com.br/materiais-gratuitos-para-concursos-publicos/materiais-por-disciplinas/",
      "https://blog.grancursosonline.com.br/informatica-para-concursos-conceitos-basicos-para-prova/",
      "https://www.somatematica.com.br/"
    ]) expect(isTrustedOfficialUrl(url), url).toBe(true);
  });

  it("rejeita HTTP, credenciais embutidas, URLs inválidas e domínios parecidos", () => {
    for (const url of [
      "http://brasilescola.uol.com.br/gramatica",
      "https://www.gov.br/concursos",
      "https://www2.camara.leg.br/atividade-legislativa",
      "https://educa.ibge.gov.br/",
      "https://brasilescola.uol.com.br.evil.com/concursos",
      "https://brasilescola.uol.com.br@evil.com/concursos",
      "https://evil.com/www.gov.br",
      "javascript:alert(1)",
      "not-a-url",
      ""
    ]) expect(isTrustedOfficialUrl(url), url).toBe(false);
  });

  it("identifica uma referência secundária não selecionada", () => {
    expect(isTrustedOfficialUrl("https://concursor.com.br/editais?uf=AL")).toBe(false);
    expect(officialSourceLabel("https://concursor.com.br/editais?uf=AL")).toContain("Referência externa");
    expect(officialSourceLabel("https://brasilescola.uol.com.br/gramatica")).toBe("Fonte de estudo selecionada");
  });

  it("não aceita hostname falso nem URL com usuário e senha", () => {
    expect(isTrustedOfficialHostname("evilgov.br")).toBe(false);
    expect(isTrustedOfficialHostname("not.gov.br.evil.com")).toBe(false);
    expect(parseHttpsUrl("https://user:password@www.gov.br")).toBeNull();
  });
});