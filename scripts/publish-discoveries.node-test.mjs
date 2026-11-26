import test from "node:test";
import assert from "node:assert/strict";
import { assertSupabaseServiceCredential, buildDiscoveryRows, getSupabaseCredentialRole, publishDiscoveries } from "./publish-discoveries.mjs";

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

test("identifica o papel real da chave JWT sem expor a credencial", () => {
  const token = role => "header." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".signature";
  assert.equal(getSupabaseCredentialRole(token("service_role")), "service_role");
  assert.equal(getSupabaseCredentialRole(token("anon")), "anon");
  assert.equal(getSupabaseCredentialRole("sb_secret_example"), "secret");
  assert.equal(getSupabaseCredentialRole("sb_publishable_example"), "publishable");
  assert.equal(getSupabaseCredentialRole("not-a-jwt"), "unknown");
});

test("aceita somente credencial service_role ou chave secreta", () => {
  const token = role => "header." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".signature";
  assert.equal(assertSupabaseServiceCredential(token("service_role")), "service_role");
  assert.equal(assertSupabaseServiceCredential("sb_secret_test-example"), "secret");
  assert.throws(() => assertSupabaseServiceCredential(token("anon")), /credencial pública/);
  assert.throws(() => assertSupabaseServiceCredential("sb_publishable_test"), /credencial pública/);
  assert.throws(() => assertSupabaseServiceCredential("not-a-jwt"), /credencial desconhecida/);
});

test("bloqueia chave publishable antes de tentar gravar a fila protegida", async () => {
  const publishableKey = "sb_publishable_public-example";
  await assert.rejects(() => publishDiscoveries([{
    source_url: "https://orgao.gov.br/concursos",
    candidate_url: "https://orgao.gov.br/edital.pdf",
    discovery_key: "link:https://orgao.gov.br/edital.pdf",
    title: "Edital novo",
    context: "Página oficial",
    discovery_type: "new_link"
  }], {
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: publishableKey,
    fetchImpl: async () => { throw new Error("Não deveria enviar com chave pública"); }
  }), /credencial pública/);
});

test("bloqueia credencial desconhecida antes de tentar gravar a fila protegida", async () => {
  let called = false;
  await assert.rejects(() => publishDiscoveries([{
    source_url: "https://orgao.gov.br/concursos",
    candidate_url: "https://orgao.gov.br/edital.pdf",
    discovery_key: "link:https://orgao.gov.br/edital.pdf",
    title: "Edital novo",
    context: "Página oficial",
    discovery_type: "new_link"
  }], {
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "not-a-jwt",
    fetchImpl: async () => { called = true; throw new Error("Não deveria enviar com credencial desconhecida"); }
  }), /credencial desconhecida/);
  assert.equal(called, false);
});

test("bloqueia credencial anon antes de tentar gravar a fila protegida", async () => {
  let called = false;
  const anonKey = "header." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") + ".signature";
  await assert.rejects(() => publishDiscoveries([{
    source_url: "https://orgao.gov.br/concursos",
    candidate_url: "https://orgao.gov.br/edital.pdf",
    discovery_key: "link:https://orgao.gov.br/edital.pdf",
    title: "Edital novo",
    context: "Página oficial",
    discovery_type: "new_link"
  }], {
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: anonKey,
    fetchImpl: async () => { called = true; throw new Error("Não deveria enviar com chave anon"); }
  }), /credencial pública/);
  assert.equal(called, false);
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
    serviceRoleKey: "sb_secret_example",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    }
  });
  assert.equal(result.published, 1);
  assert.match(request.url, /contest_discoveries\?on_conflict=/);
  assert.equal(request.options.headers.apikey, "sb_secret_example");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(JSON.parse(request.options.body)[0].status, "pending");
});

test("falha e preserva a descoberta se os secrets do Supabase estiverem ausentes", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await assert.rejects(() => publishDiscoveries([{
      source_url: "https://orgao.gov.br/concursos",
      candidate_url: "https://orgao.gov.br/edital.pdf",
      discovery_key: "link:https://orgao.gov.br/edital.pdf",
      title: "Edital novo",
      context: "Página oficial",
      discovery_type: "new_link"
    }], { supabaseUrl: "", serviceRoleKey: "" }), /preservar a linha de base/);
  } finally {
    if (previousUrl !== undefined) process.env.SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("mantém pistas da busca na internet na fila sem tratá-las como edital oficial", () => {
  const rows = buildDiscoveryRows([{
    source_url: "https://news.google.com/rss/search?q=concursos",
    candidate_url: "https://news.google.com/rss/articles/abc123",
    discovery_key: "web-search:abc123",
    title: "Busca na internet: Prefeitura anuncia seleção",
    context: "Fonte secundária. Confirme a publicação oficial.",
    discovery_type: "web_search_lead"
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].discovery_type, "web_search_lead");
  assert.match(rows[0].context, /Confirme a publicação oficial/);
});
