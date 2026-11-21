import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryRows, publishDiscoveries } from "./publish-discoveries.mjs";

test("prepara somente descobertas HTTPS válidas e elimina duplicatas", () => {
  const item = {
    source_url: "https://orgao.gov.br/concursos",
    candidate_url: "https://orgao.gov.br/edital-2026.pdf",
    discovery_key: "link:https://orgao.gov.br/edital-2026.pdf",
    title: "Edital 2026",
    context: "Página oficial",
    discovery_type: "new_link"
  };
  const rows = buildDiscoveryRows([item, item, { ...item, candidate_url: "http://inseguro.gov.br" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].title, "Edital 2026");
});

test("não envia registros quando não há descobertas válidas", async () => {
  const result = await publishDiscoveries([{ source_url: "http://inseguro", candidate_url: "http://inseguro" }], {
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "test-key",
    fetchImpl: async () => { throw new Error("Não deveria chamar fetch"); }
  });
  assert.deepEqual(result, { published: 0, skipped: 0 });
});

test("envia descobertas para PostgREST usando conflito idempotente", async () => {
  let request;
  const result = await publishDiscoveries([{
    source_url: "https://orgao.gov.br/concursos",
    candidate_url: "https://orgao.gov.br/edital.pdf",
    discovery_key: "link:https://orgao.gov.br/edital.pdf",
    title: "Edital novo",
    context: "Página oficial",
    discovery_type: "new_link"
  }], {
    supabaseUrl: "https://project.supabase.co/",
    serviceRoleKey: "secret-test",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    }
  });
  assert.equal(result.published, 1);
  assert.match(request.url, /contest_discoveries\\?on_conflict=/);
  assert.equal(request.options.headers.Authorization, "Bearer secret-test");
  assert.equal(JSON.parse(request.options.body)[0].status, "pending");
});
