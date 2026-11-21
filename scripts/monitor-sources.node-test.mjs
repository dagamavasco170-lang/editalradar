import test from "node:test";
import assert from "node:assert/strict";
import { concursos } from "../src/data/concursos.js";
import { collectSourceUrls, compareSource, fingerprintContent, normalizeHtml } from "./monitor-sources.mjs";

test("coleta somente URLs HTTPS únicas", () => {
  const urls = collectSourceUrls([
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "http://example.gov.br/b" },
    { sourceUrl: "not-a-url" },
    {}
  ]);
  assert.deepEqual(urls, ["https://example.gov.br/a"]);
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
