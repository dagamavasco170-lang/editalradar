import test from "node:test";
import assert from "node:assert/strict";
import { concursos } from "../src/data/concursos.js";
import { collectSourceUrls, compareSource, fingerprintContent, normalizeHtml, extractOpportunityLinks, buildDiscoveriesForSource, fetchOfficialSource, isTrustedOfficialHost, pruneSourceState } from "./monitor-sources.mjs";

test("coleta somente URLs HTTPS únicas", () => {
  const urls = collectSourceUrls([
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "http://example.gov.br/b" },
    { sourceUrl: "https://concursor.com.br/editais" },
    { sourceUrl: "not-a-url" },
    {}
  ]);
  assert.deepEqual(urls, ["https://example.gov.br/a"]);
  assert.equal(isTrustedOfficialHost("cebraspe.org.br"), true);
  assert.equal(isTrustedOfficialHost("concursor.com.br"), false);
});

test("segue somente redirecionamentos para domínios HTTPS oficiais autorizados", async () => {
  const requested = [];
  const result = await fetchOfficialSource("https://orgao.gov.br/inicio", {
    fetchImpl: async (url, options) => {
      requested.push({ url, redirect: options.redirect });
      if (url.endsWith("/inicio")) {
        return { status: 302, headers: new Headers({ location: "/concursos" }), url };
      }
      return { status: 200, headers: new Headers(), url };
    }
  });
  assert.equal(requested.length, 2);
  assert.ok(requested.every(item => item.redirect === "manual"));
  assert.equal(result.finalUrl, "https://orgao.gov.br/concursos");
});

test("bloqueia redirecionamento para domínio externo antes da segunda requisição", async () => {
  const requested = [];
  await assert.rejects(() => fetchOfficialSource("https://orgao.gov.br/inicio", {
    fetchImpl: async (url) => {
      requested.push(url);
      return { status: 302, headers: new Headers({ location: "https://example.com/metadata" }), url };
    }
  }), /URL bloqueada/);
  assert.deepEqual(requested, ["https://orgao.gov.br/inicio"]);
});

test("bloqueia downgrade para HTTP e remove fontes antigas da linha de base", async () => {
  await assert.rejects(() => fetchOfficialSource("https://orgao.gov.br/inicio", {
    fetchImpl: async (url) => ({
      status: 302,
      headers: new Headers({ location: "http://orgao.gov.br/concursos" }),
      url
    })
  }), /URL bloqueada/);
  const result = pruneSourceState({
    "https://orgao.gov.br/antiga": { sha256: "old" },
    "https://orgao.gov.br/atual": { sha256: "current" }
  }, ["https://orgao.gov.br/atual"]);
  assert.deepEqual(result.removed, ["https://orgao.gov.br/antiga"]);
  assert.deepEqual(Object.keys(result.sources), ["https://orgao.gov.br/atual"]);
});

test("catálogo atual possui fontes HTTPS deduplicadas", () => {
  const urls = collectSourceUrls(concursos);
  assert.ok(urls.length > 0);
  assert.equal(urls.length, new Set(urls).size);
  assert.ok(urls.every((url) => url.startsWith("https://")));
});

test("normaliza HTML removendo scripts, estilos e espaços variáveis", () => {
  const first = "<html><style>.a{color:red}</style><body>  Edital  2026 <script>var now=1</script></body></html>";
  const second = "<html><body>edital 2026</body></html>";
  assert.equal(normalizeHtml(first), normalizeHtml(second));
  assert.equal(fingerprintContent(first), fingerprintContent(second));
});

test("identifica alteração, falha e primeira leitura", () => {
  assert.equal(compareSource("https://example.gov.br", { sha256: "old" }, { ok: true, sha256: "new" }).type, "changed");
  assert.equal(compareSource("https://example.gov.br", { sha256: "old" }, { ok: false, error: "HTTP 503" }).type, "unavailable");
  assert.equal(compareSource("https://example.gov.br", null, { ok: true, sha256: "new" }).type, "new_baseline");
});

test("mantém texto relevante em português", () => {
  assert.equal(normalizeHtml("<p>Inscrições abertas até 25/11.</p>"), "inscrições abertas até 25/11.");
});

test("extrai links HTTPS relevantes de edital e ignora links comuns ou inseguros", () => {
  const links = extractOpportunityLinks(`
    <a href="/editais/edital-2026.pdf">Edital 2026 - Analista</a>
    <a href="http://inseguro.example/edital">Edital inseguro</a>
    <a href="/sobre">Sobre o órgão</a>
    <a href="https://orgao.gov.br/concursos">Página concursos</a>
  `, "https://orgao.gov.br/concursos-publicos");
  assert.equal(links.length, 1);
  assert.equal(links[0].candidate_url, "https://orgao.gov.br/editais/edital-2026.pdf");
  assert.match(links[0].title, /Edital 2026/);
});


test("detecta links oficiais de retificação, errata e aditivo", () => {
  const html =
    "<a href='/concursos/edital-01-2026/retificacao-1.pdf'>1ª Retificação do Edital 01/2026</a>" +
    "<a href='/concursos/edital-01-2026/errata.pdf'>Errata do concurso público</a>" +
    "<a href='/concursos/edital-01-2026/aditivo.pdf'>Aditivo ao edital</a>";
  const links = extractOpportunityLinks(html, "https://orgao.gov.br/concursos");

  assert.equal(links.length, 3);
  assert.ok(links.some(item => /retificacao-1\.pdf/.test(item.candidate_url)));
  assert.ok(links.some(item => /errata\.pdf/.test(item.candidate_url)));
  assert.ok(links.some(item => /aditivo\.pdf/.test(item.candidate_url)));
});

test("semeia a fila com links oficiais atuais na primeira execução do detector filtrado", () => {
  const url = "https://orgao.gov.br/concursos";
  const currentLink = {
    candidate_url: "https://orgao.gov.br/edital-atual.pdf",
    title: "Edital atual",
    context: "Página oficial"
  };
  const discoveries = buildDiscoveriesForSource(url, null, {
    ok: true, sha256: "first", opportunityLinks: [currentLink]
  });
  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].discovery_type, "new_link");
  assert.equal(discoveries[0].candidate_url, currentLink.candidate_url);
  assert.match(discoveries[0].context, /carga inicial da fila/);
});

test("adiciona a página monitorada à fila inicial quando não há links específicos identificados", () => {
  const url = "https://orgao.gov.br/concursos";
  const discoveries = buildDiscoveriesForSource(url, null, {
    ok: true,
    sha256: "baseline-page",
    opportunityLinks: []
  });
  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].discovery_type, "source_baseline");
  assert.equal(discoveries[0].candidate_url, url);
  assert.match(discoveries[0].title, /Fonte oficial para verificação inicial/);
});

test("detecta página alterada e links novos após a linha de base", () => {
  const url = "https://orgao.gov.br/concursos";
  const oldLink = { candidate_url: "https://orgao.gov.br/edital-antigo.pdf" };
  const newLink = {
    candidate_url: "https://orgao.gov.br/edital-novo.pdf",
    title: "Edital novo",
    context: "Página oficial"
  };
  const discoveries = buildDiscoveriesForSource(url, {
    sha256: "old",
    opportunityLinks: [oldLink],
    opportunityLinkFilterVersion: 5
  }, {
    ok: true, sha256: "new", opportunityLinks: [oldLink, newLink]
  });
  assert.equal(discoveries.length, 2);
  assert.ok(discoveries.some(item => item.discovery_type === "page_change"));
  assert.ok(discoveries.some(item => item.discovery_type === "new_link" && item.candidate_url === newLink.candidate_url));
});
