import { describe, expect, it } from "vitest";
import { isTrustedOfficialHostname, isTrustedOfficialUrl, officialSourceLabel, parseHttpsUrl } from "./official-sources.js";

describe("validação de fontes oficiais", () => {
  it("aceita órgãos públicos e domínios oficiais de bancas", () => {
    for (const url of [
      "https://www.gov.br/concursos",
      "https://portal.al.gov.br/concursos",
      "https://www.bcb.gov.br/concursos",
      "https://cdn.cebraspe.org.br/concursos",
      "https://conhecimento.fgv.br/concursos",
      "https://igeduc.selecao.net.br/informacoes/129/",
      "https://www.vunesp.com.br/PMES2603",
      "https://noticias.institutoaocp.org.br/blog/edital"
    ]) expect(isTrustedOfficialUrl(url), url).toBe(true);
  });

  it("rejeita HTTP, credenciais embutidas, URLs inválidas e domínios parecidos", () => {
    for (const url of [
      "http://www.gov.br/concursos",
      "https://www.gov.br.evil.com/concursos",
      "https://gov.br@evil.com/concursos",
      "https://evil.com/www.gov.br",
      "javascript:alert(1)",
      "not-a-url",
      ""
    ]) expect(isTrustedOfficialUrl(url), url).toBe(false);
  });

  it("identifica uma referência secundária sem promovê-la a fonte oficial", () => {
    expect(isTrustedOfficialUrl("https://concursor.com.br/editais?uf=AL")).toBe(false);
    expect(officialSourceLabel("https://concursor.com.br/editais?uf=AL")).toContain("Referência externa");
    expect(officialSourceLabel("https://www.gov.br/concursos")).toBe("Fonte oficial");
  });

  it("não aceita hostname falso nem URL com usuário e senha", () => {
    expect(isTrustedOfficialHostname("evilgov.br")).toBe(false);
    expect(isTrustedOfficialHostname("not.gov.br.evil.com")).toBe(false);
    expect(parseHttpsUrl("https://user:password@www.gov.br")).toBeNull();
  });
});