import { describe, expect, it } from "vitest";
import {
  isTrustedOfficialHostname,
  isTrustedOfficialUrl,
  isTrustedPrivateStudySourceUrl,
  officialSourceLabel,
  parseHttpsUrl,
  privateStudySourceLabel
} from "./official-sources.js";

describe("fontes de estudo privadas e fontes de prova", () => {
  it("aceita fontes privadas abertas ou com permissão de reutilização", () => {
    for (const url of [
      "https://pt.wikibooks.org/wiki/Portugu%C3%AAs",
      "https://pt.wikipedia.org/wiki/Matem%C3%A1tica",
      "https://pt.wikiversity.org/wiki/Faculdade:Matem%C3%A1tica",
      "https://pt.wiktionary.org/wiki/gram%C3%A1tica",
      "https://www.politize.com.br/trilhas/politicas-publicas/",
      "https://wikieducator.org/WikiEducator:About",
    ]) expect(isTrustedPrivateStudySourceUrl(url), url).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://escolhalivre.org.br/en/about/")).toBe(false);
  });

  it("não aceita órgãos públicos como fontes para a geração automática", () => {
    for (const url of [
      "https://www.gov.br/concursos",
      "https://www2.camara.leg.br/atividade-legislativa",
      "https://educa.ibge.gov.br/",
      "https://www.bcb.gov.br/",
      "https://www.gov.br.evil.com/concursos",
      "http://brasilescola.uol.com.br/gramatica",
      "https://brasilescola.uol.com.br.evil.com/concursos",
      "https://www.jusbrasil.com.br/artigos/",
      "https://www.tecconcursos.com.br/materias/",
      "https://brasilescola.uol.com.br@evil.com/concursos",
      "javascript:alert(1)",
      "not-a-url",
      ""
    ]) expect(isTrustedPrivateStudySourceUrl(url), url).toBe(false);
  });

  it("mantém fontes oficiais e bancas para comprovar questões reais importadas", () => {
    expect(isTrustedOfficialUrl("https://www.gov.br/concursos")).toBe(true);
    expect(isTrustedOfficialUrl("https://www.cebraspe.org.br/concursos")).toBe(true);
    expect(isTrustedOfficialUrl("https://conhecimento.fgv.br/concursos")).toBe(true);
    expect(isTrustedOfficialUrl("https://brasilescola.uol.com.br/gramatica")).toBe(false);
  });

  it("rejeita HTTP, credenciais e domínios falsos para comprovação de prova", () => {
    expect(isTrustedOfficialUrl("http://www.gov.br/")).toBe(false);
    expect(isTrustedOfficialUrl("https://www.gov.br.evil.com/concursos")).toBe(false);
    expect(isTrustedOfficialUrl("https://gov.br@evil.com/concursos")).toBe(false);
    expect(isTrustedOfficialHostname("evilgov.br")).toBe(false);
    expect(isTrustedOfficialHostname("not.gov.br.evil.com")).toBe(false);
    expect(parseHttpsUrl("https://user:password@www.gov.br")).toBeNull();
  });

  it("mostra rótulos diferentes para as duas finalidades", () => {
    expect(officialSourceLabel("https://www.gov.br/concursos")).toBe("Fonte oficial");
    expect(privateStudySourceLabel("https://pt.wikibooks.org/wiki/Portugu%C3%AAs")).toBe("Fonte privada de estudo selecionada");
    expect(privateStudySourceLabel("https://www.gov.br/concursos")).toBe("Fonte privada externa não selecionada");
  });
});
