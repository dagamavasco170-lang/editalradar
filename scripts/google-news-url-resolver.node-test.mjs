import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleNewsArticleUrl } from "./google-news-url-resolver.mjs";

const officialUrl = "https://igaci.al.gov.br/concursos/edital-01-2026.pdf";
const declaredSource = "https://igaci.al.gov.br";
const rpcUrl = "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je";

function googleArticlePage(signature = "sig_teste_2026", timestamp = 1795370000) {
  return new Response(
    '<html><body><div data-n-a-sg="' + signature + '" data-n-a-ts="' + timestamp + '"></div></body></html>',
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function googleRpcResponse(url) {
  const inner = JSON.stringify(["garturlres", url]);
  const frames = [
    ["wrb.fr", "Fbv4je", inner, null, null, null, "generic"],
    ["di", 16]
  ];
  return new Response(")]}'\n\n" + JSON.stringify(frames) + "\n", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

test("resolve o token atual do Google Notícias pelo RPC e valida o publisher oficial", async () => {
  const articleId = "CBMiTesteToken_2026";
  const newsUrl = "https://news.google.com/rss/articles/" + articleId + "?oc=5";
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") return googleArticlePage();
    assert.equal(url, rpcUrl);
    return googleRpcResponse(officialUrl);
  };

  const result = await resolveGoogleNewsArticleUrl(newsUrl, declaredSource, request, { timeoutMs: 5000 });

  assert.equal(result, officialUrl);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://news.google.com/rss/articles/" + articleId);
  assert.equal(calls[0].init.redirect, "manual");
  assert.match(calls[0].init.headers.Cookie, /CONSENT=/);
  assert.equal(calls[1].init.method, "POST");
  assert.match(calls[1].init.headers["Content-Type"], /application\/x-www-form-urlencoded/i);
  assert.equal(calls[1].init.headers.Origin, "https://news.google.com");
  assert.equal(calls[1].init.headers["X-Same-Domain"], "1");

  const form = new URLSearchParams(calls[1].init.body);
  const outer = JSON.parse(form.get("f.req"));
  const rpc = outer[0][0];
  assert.equal(rpc[0], "Fbv4je");
  const inner = JSON.parse(rpc[1]);
  assert.equal(inner[0], "garturlreq");
  assert.equal(inner[2], articleId);
  assert.equal(inner[3], 1795370000);
  assert.equal(inner[4], "sig_teste_2026");
});

test("mantém compatibilidade com redirecionamento HTTP direto para o mesmo domínio oficial", async () => {
  const newsUrl = "https://news.google.com/rss/articles/direct-redirect";
  let calls = 0;
  const result = await resolveGoogleNewsArticleUrl(newsUrl, declaredSource, async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: officialUrl } });
  });

  assert.equal(result, officialUrl);
  assert.equal(calls, 1);
});

test("aceita IDs antigos que ainda contêm a URL oficial em base64url", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22, Buffer.byteLength(officialUrl)]),
    Buffer.from(officialUrl)
  ]);
  const articleId = bytes.toString("base64url");
  const result = await resolveGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/" + articleId,
    declaredSource,
    async () => { throw new Error("O formato antigo deve ser resolvido sem rede."); }
  );
  assert.equal(result, officialUrl);
});

test("recusa um endereço resolvido que não pertence ao publisher oficial declarado", async () => {
  const newsUrl = "https://news.google.com/rss/articles/wrong-publisher";
  const request = async (url, init) => init.method === "GET"
    ? googleArticlePage()
    : googleRpcResponse("https://outro.gov.br/concursos/edital.pdf");

  await assert.rejects(
    () => resolveGoogleNewsArticleUrl(newsUrl, declaredSource, request),
    /não corresponde ao domínio oficial/
  );
});

test("recusa redirecionamento direto para outro órgão, mesmo que também use domínio governamental", async () => {
  await assert.rejects(
    () => resolveGoogleNewsArticleUrl(
      "https://news.google.com/rss/articles/cross-publisher",
      declaredSource,
      async () => new Response(null, {
        status: 302,
        headers: { location: "https://outro.gov.br/edital.pdf" }
      })
    ),
    /não corresponde ao domínio oficial informado/
  );
});

test("mantém a pista sem publicar quando a página do Google não apresenta assinatura de resolução", async () => {
  let calls = 0;
  const result = await resolveGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/no-signature",
    declaredSource,
    async () => {
      calls += 1;
      return new Response("<html><title>Consent</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
  );

  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("não segue redirecionamento para host externo arbitrário", async () => {
  await assert.rejects(
    () => resolveGoogleNewsArticleUrl(
      "https://news.google.com/rss/articles/external-hop",
      declaredSource,
      async () => new Response(null, {
        status: 302,
        headers: { location: "https://noticias.example.com/materia" }
      })
    ),
    /domínio diferente do publisher oficial/
  );
});

test("limita o tamanho das respostas do Google antes de extrair assinatura ou resultado", async () => {
  await assert.rejects(
    () => resolveGoogleNewsArticleUrl(
      "https://news.google.com/rss/articles/large-page",
      declaredSource,
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    ),
    /excedeu o limite/
  );
});
