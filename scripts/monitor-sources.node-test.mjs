import test from "node:test";
import assert from "node:assert/strict";
import { concursos } from "../src/data/concursos.js";
import { collectSourceUrls, compareSource, fingerprintContent, normalizeHtml, extractOpportunityLinks, buildDiscoveriesForSource, isTrustedOfficialHost } from "./monitor-sources.mjs";

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

test("gera itens pendentes para mudanças da página e novos links, não na primeira linha de base", () => {
  const url = "https://orgao.gov.br/concursos";
  const oldLink = { candidate_url: "https://orgao.gov.br/edital-antigo.pdf" };
  const newLink = {
    candidate_url: "https://orgao.gov.br/edital-novo.pdf",
    title: "Edital novo",
    context: "Página oficial"
  };
  assert.deepEqual(buildDiscoveriesForSource(url, null, {
    ok: true, sha256: "first", opportunityLinks: [newLink]
  }), []);
  const discoveries = buildDiscoveriesForSource(url, {
    sha256: "old", opportunityLinks: [oldLink]
  }, {
    ok: true, sha256: "new", opportunityLinks: [oldLink, newLink]
  });
  assert.equal(discoveries.length, 2);
  assert.ok(discoveries.some(item => item.discovery_type === "page_change"));
  assert.ok(discoveries.some(item => item.discovery_type === "new_link" && item.candidate_url === newLink.candidate_url));
});
