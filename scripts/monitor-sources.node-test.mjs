import test from "node:test";
import { buildSourceMonitorIssueReport, sourceMonitorIssueNeedsUpdate } from "./source-monitor-issue-report.mjs";
import assert from "node:assert/strict";
import { concursos } from "../src/data/concursos.js";
import { collectSourceUrls, compareSource, wasSourceAccessRestricted, fingerprintContent, normalizeHtml, extractOpportunityLinks, buildDiscoveriesForSource, fetchOfficialSource, fetchNewsFeedWithRetry, isTrustedOfficialHost, pruneSourceState, buildGoogleNewsRssUrl, parseGoogleNewsRss, searchInternetForContestLeads, filterUnseenWebSearchDiscoveries, INTERNET_SEARCH_QUERIES, classifyContestLead, SECONDARY_NEWS_FEEDS, parseSecondaryNewsRss, isActionableSecondaryNewsLead, fetchNewsFeedWithCurl, isSameTrustedSecondaryFeedPublisher, resolveTrustedSecondaryFeedRedirect, normalizeOfficialSourceUrl, fetchSource, readResponseBytes } from "./monitor-sources.mjs";

test("coleta URLs principais e fontes oficiais de prazos, somente HTTPS e sem duplicatas", () => {
  const urls = collectSourceUrls([
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "https://example.gov.br/a" },
    { sourceUrl: "https://example.gov.br/contest", periodoInscricao: { fonteUrl: "https://example.gov.br/calendar" } },
    { sourceUrl: "https://example.gov.br/other", periodoInscricao: { fonteUrl: "https://example.gov.br/calendar" } },
    { sourceUrl: "https://example.gov.br/unsafe", periodoInscricao: { fonteUrl: "http://example.gov.br/insecure" } },
    { sourceUrl: "http://example.gov.br/b" },
    { sourceUrl: "https://concursor.com.br/editais", periodoInscricao: { fonteUrl: "https://attacker.example/calendar" } },
    { sourceUrl: "not-a-url" },
    {}
  ], []);
  assert.deepEqual(urls, [
    "https://example.gov.br/a",
    "https://example.gov.br/calendar",
    "https://example.gov.br/contest",
    "https://example.gov.br/other",
    "https://example.gov.br/unsafe"
  ]);
  assert.equal(isTrustedOfficialHost("cebraspe.org.br"), true);
  assert.equal(isTrustedOfficialHost("conhecimento.fgv.br"), true);
  assert.equal(isTrustedOfficialHost("www.concursosfcc.com.br"), true);
  assert.equal(isTrustedOfficialHost("www.vunesp.com.br"), true);
  assert.equal(isTrustedOfficialHost("beta.institutoaocp.org.br"), true);
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



test("reutiliza snapshot em HTTP 304 e envia ETag/Last-Modified na próxima coleta", async () => {
  const requested = [];
  const previous = {
    sha256: "a".repeat(64),
    etag: '"versao-1"',
    lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    contentType: "text/html",
    opportunityLinks: [{ candidate_url: "https://orgao.gov.br/edital-01", title: "Edital" }],
    opportunityLinkFilterVersion: 6,
    lastFailureType: "restricted",
    lastError: "HTTP 403"
  };
  const current = await fetchSource("https://orgao.gov.br/concursos", previous, {
    fetchImpl: async (url, options) => {
      requested.push(options.headers);
      return new Response(null, { status: 304, headers: { etag: '"versao-1"' } });
    }
  });
  assert.equal(requested.length, 1);
  assert.equal(requested[0]["If-None-Match"], '"versao-1"');
  assert.equal(requested[0]["If-Modified-Since"], "Wed, 21 Oct 2015 07:28:00 GMT");
  assert.equal(current.ok, true);
  assert.equal(current.notModified, true);
  assert.equal(current.sha256, previous.sha256);
  assert.deepEqual(current.opportunityLinks, previous.opportunityLinks);
  assert.equal(current.lastFailureType, undefined);
  assert.equal(current.lastError, undefined);
});

test("não contorna HTTP 429 com curl nem repete antes de Retry-After longo", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const waits = [];
  const result = await fetchOfficialSource("https://orgao.gov.br/concursos", {
    attempts: 3,
    retryDelayMs: 5,
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fetchImpl: async url => {
      primaryCalls += 1;
      return { status: 429, headers: new Headers({ "retry-after": "120" }), url };
    },
    fallbackFetch: async url => {
      fallbackCalls += 1;
      return { status: 200, headers: new Headers(), url };
    }
  });
  assert.equal(result.response.status, 429);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(waits, []);
});

test("não aceita HTTP 304 sem baseline e não inventa hash", async () => {
  await assert.rejects(() => fetchSource("https://orgao.gov.br/concursos", null, {
    fetchImpl: async () => new Response(null, { status: 304 })
  }), /HTTP 304 sem uma versão anterior válida/);
});

test("classifica challenge/WAF servido com HTTP 200 como acesso restrito", async () => {
  await assert.rejects(() => fetchSource("https://orgao.gov.br/concursos", null, {
    fetchImpl: async () => new Response("<html><title>Just a moment...</title><p>Checking your browser before accessing</p><div>Cloudflare Ray ID</div></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  }), error => error.code === "SOURCE_RESTRICTED" && error.status === 200);
});

test("não considera JSON inesperado como coleta oficial válida", async () => {
  await assert.rejects(() => fetchSource("https://orgao.gov.br/concursos", null, {
    fetchImpl: async () => new Response('{"error":"upstream unavailable"}', {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  }), error => error.code === "UNSUPPORTED_SOURCE_CONTENT_TYPE");
});

test("limita o tamanho do corpo durante leitura do stream", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  });
  await assert.rejects(() => readResponseBytes({ headers: new Headers(), body: stream }, 12), /Resposta excede o limite/);
});

test("repete consulta após HTTP 503 e respeita Retry-After antes de aceitar 200", async () => {
  const requested = [];
  const waits = [];
  const result = await fetchOfficialSource("https://orgao.gov.br/concursos", {
    attempts: 3,
    retryDelayMs: 10,
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fetchImpl: async (url, options) => {
      requested.push({url, redirect:options.redirect});
      if (requested.length === 1) {
        return {status:503,headers:new Headers({"retry-after":"2"}),url};
      }
      return {status:200,headers:new Headers(),url};
    }
  });
  assert.equal(result.response.status,200);
  assert.equal(requested.length,2);
  assert.deepEqual(waits,[2000]);
  assert.ok(requested.every(item=>item.redirect==="manual"));
});

test("repete erro transitório de rede, mas não repete resposta 404", async () => {
  let calls=0;
  const recovered=await fetchOfficialSource("https://orgao.gov.br/concursos",{
    attempts:2,retryDelayMs:5,sleepImpl:async()=>{},
    fetchImpl:async url=>{
      calls+=1;
      if(calls===1)throw new Error("ECONNRESET");
      return {status:200,headers:new Headers(),url};
    }
  });
  assert.equal(recovered.response.status,200);
  assert.equal(calls,2);

  calls=0;
  const notFound=await fetchOfficialSource("https://orgao.gov.br/nao-existe",{
    attempts:3,retryDelayMs:5,sleepImpl:async()=>{},
    fetchImpl:async url=>{calls+=1;return {status:404,headers:new Headers(),url};}
  });
  assert.equal(notFound.response.status,404);
  assert.equal(calls,1);
});


test("usa transporte alternativo após 403 e valida cada redirecionamento", async () => {
  const primaryCalls = [];
  const fallbackCalls = [];
  const result = await fetchOfficialSource("https://orgao.gov.br/inicio", {
    fetchImpl: async url => {
      primaryCalls.push(url);
      return {status:403,headers:new Headers(),url};
    },
    fallbackFetch: async url => {
      fallbackCalls.push(url);
      if (url.endsWith("/inicio")) return {status:302,headers:new Headers({location:"/editais"}),url};
      return {status:200,headers:new Headers(),url};
    }
  });
  assert.deepEqual(primaryCalls,["https://orgao.gov.br/inicio","https://orgao.gov.br/editais"]);
  assert.deepEqual(fallbackCalls,["https://orgao.gov.br/inicio","https://orgao.gov.br/editais"]);
  assert.equal(result.response.status,200);
  assert.equal(result.finalUrl,"https://orgao.gov.br/editais");
  assert.equal(result.usedFallbackTransport,true);
});

test("bloqueia redirecionamento externo vindo do transporte alternativo", async () => {
  const fallbackCalls = [];
  await assert.rejects(() => fetchOfficialSource("https://orgao.gov.br/inicio", {
    fetchImpl: async url => ({status:403,headers:new Headers(),url}),
    fallbackFetch: async url => {
      fallbackCalls.push(url);
      return {status:302,headers:new Headers({location:"https://example.com/roubo"}),url};
    }
  }), /URL bloqueada/);
  assert.deepEqual(fallbackCalls,["https://orgao.gov.br/inicio"]);
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

test("busca PCI Concursos entra no monitoramento como fonte externa de descoberta", () => {
  const queries = INTERNET_SEARCH_QUERIES.filter(item => item.query.includes("site:pciconcursos.com.br"));
  assert.equal(queries.length, 3);
  assert.ok(queries.some(item => item.label.includes("concursos abertos")));
  assert.ok(queries.some(item => item.label.includes("últimas atualizações")));
  assert.ok(queries.some(item => item.label.includes("notícias")));
  assert.ok(queries.every(item => item.query.includes("pciconcursos.com.br")));
});

test("classifica pistas por natureza para orientar a revisão sem publicar notícias secundárias", () => {
  assert.deepEqual(classifyContestLead("Retificação do edital 02/2026"), { kind: "retification", label: "Retificação/errata" });
  assert.deepEqual(classifyContestLead("Inscrições abertas até sexta-feira"), { kind: "open_registration", label: "Inscrições/prazo" });
  assert.deepEqual(classifyContestLead("Banca definida para o concurso"), { kind: "pre_notice", label: "Pré-edital/autorização" });
  assert.deepEqual(classifyContestLead("Resultado final homologado"), { kind: "result_update", label: "Resultado/convocação" });
  assert.deepEqual(classifyContestLead("Prefeitura lança edital de concurso"), { kind: "notice", label: "Edital/publicação" });
});

test("deduplica a mesma manchete do mesmo veículo quando o agregador troca o permalink", () => {
  const xml = [
    "<rss><channel><item>",
    "<title>Prefeitura anuncia edital de concurso público com 40 vagas para 2027</title>",
    "<link>https://news.google.com/rss/articles/story-version-a</link>",
    "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>",
    "<source url=\"https://portal.example.org\">Portal Regional</source>",
    "</item><item>",
    "<title>Prefeitura anuncia edital de concurso público com 40 vagas para 2027</title>",
    "<link>https://news.google.com/rss/articles/story-version-b</link>",
    "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>",
    "<source url=\"https://portal.example.org\">Portal Regional</source>",
    "</item></channel></rss>"
  ].join("");
  const leads = parseGoogleNewsRss(xml, {
    now: new Date("2026-11-21T19:00:00-03:00"),
    queryLabel: "Concursos municipais",
    feedUrl: "https://news.google.com/rss/search?q=concursos"
  });
  assert.equal(leads.length, 1);
  assert.match(leads[0].discovery_key, /^web-search-title:[a-f0-9]{64}$/);
});

test("amplia as buscas automáticas para retificações, seleções, municípios e instituições de ensino", () => {
  const labels = INTERNET_SEARCH_QUERIES.map(item => item.label);
  assert.ok(labels.includes("Retificações, erratas e novos cronogramas"));
  assert.ok(labels.includes("Concursos municipais e câmaras"));
  assert.ok(labels.includes("Processos seletivos simplificados"));
  assert.ok(labels.includes("Universidades e institutos"));
  assert.ok(labels.includes("Inscrições abertas e prazos"));
});

test("catálogo atual possui fontes HTTPS deduplicadas", () => {
  const urls = collectSourceUrls(concursos);
  assert.ok(urls.length > 0);
  assert.equal(urls.length, new Set(urls).size);
  assert.ok(urls.every((url) => url.startsWith("https://")));
  assert.ok(urls.includes("https://conhecimento.fgv.br/concursos"));
  assert.ok(urls.includes("https://www.concursosfcc.com.br/concursoAndamento.html"));
  assert.ok(urls.includes("https://www.vunesp.com.br/busca/concurso/inscricoesabertas"));
  assert.ok(urls.includes("https://www.institutoaocp.org.br/concursos/status/inscricoes-abertas"));
  assert.ok(urls.includes("https://www.institutoaocp.org.br/concursos/status/em-andamento"));
  assert.ok(urls.includes("https://concursos.ibfc.org.br/index/abertos"));
  assert.ok(urls.includes("https://www.igeduc.org.br/index/abertos"));
  assert.ok(urls.includes("https://quadrix.org.br/index/todos"));
  assert.ok(urls.includes("https://fundacaolasalle.org.br/concursos?filtro=em-andamento"));
  assert.equal(isTrustedOfficialHost("www.igeduc.org.br"), true);
  assert.equal(isTrustedOfficialHost("concursos.ibfc.org.br"), true);
  assert.equal(isTrustedOfficialHost("quadrix.org.br"), true);
  assert.equal(isTrustedOfficialHost("fundacaolasalle.org.br"), true);
  assert.ok(urls.includes("https://www.cebraspe.org.br/concursos/inscricoes-abertas"));
});

test("normaliza HTML removendo scripts, estilos e espaços variáveis", () => {
  const first = "<html><style>.a{color:red}</style><body>  Edital  2026 <script>var now=1</script></body></html>";
  const second = "<html><body>edital 2026</body></html>";
  assert.equal(normalizeHtml(first), normalizeHtml(second));
  assert.equal(fingerprintContent(first), fingerprintContent(second));
});

test("identifica alteração, falha real e primeira leitura", () => {
  assert.equal(compareSource("https://example.gov.br", { sha256: "old" }, { ok: true, sha256: "new" }).type, "changed");
  assert.equal(compareSource("https://example.gov.br", { sha256: "old" }, { ok: false, status: 503, error: "HTTP 503" }).type, "unavailable");
  assert.equal(compareSource("https://example.gov.br", null, { ok: true, sha256: "new" }).type, "new_baseline");
});

test("distingue bloqueio do robô de indisponibilidade real e detecta recuperação", () => {
  for (const status of [401, 403, 429]) {
    const result = compareSource("https://example.gov.br", { sha256: "old" }, { ok: false, status, error: "HTTP " + status });
    assert.equal(result.type, "restricted");
    assert.equal(result.status, status);
    assert.match(result.message, /não confirma que a página oficial esteja fora do ar/);
  }

  const serverFailure = compareSource("https://example.gov.br", { sha256: "old" }, { ok: false, status: 503, error: "HTTP 503" });
  assert.equal(serverFailure.type, "unavailable");
  assert.equal(wasSourceAccessRestricted({ lastFailureType: "restricted" }), true);
  assert.equal(wasSourceAccessRestricted({ lastError: "HTTP 403 Forbidden" }), true);
  assert.equal(wasSourceAccessRestricted({ lastError: "HTTP 503 Service Unavailable" }), false);
  assert.equal(wasSourceAccessRestricted({}), false);
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



test("ignora páginas de categoria de concursos e mantém links diretos de editais", () => {
  const links = extractOpportunityLinks(`
    <a href="/concursos/status/novos">Novos Concursos</a>
    <a href="/concursos/status/inscricoes-abertas">Inscrições Abertas</a>
    <a href="/concursos/status/em-andamento">Concursos em Andamento</a>
    <a href="/concursos/edital-01-2026.pdf">Edital 01/2026 - Analista</a>
  `, "https://www.institutoaocp.org.br/");
  assert.equal(links.length,1);
  assert.match(links[0].candidate_url,/edital-01-2026\.pdf/);
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
    opportunityLinkFilterVersion: 6
  }, {
    ok: true, sha256: "new", opportunityLinks: [oldLink, newLink]
  });
  assert.equal(discoveries.length, 2);
  assert.ok(discoveries.some(item => item.discovery_type === "page_change"));
  assert.ok(discoveries.some(item => item.discovery_type === "new_link" && item.candidate_url === newLink.candidate_url));
});


test("monta consultas RSS brasileiras com recência e idioma português", () => {
  const url = new URL(buildGoogleNewsRssUrl('"concurso público" site:gov.br'));
  assert.equal(url.origin, "https://news.google.com");
  assert.equal(url.pathname, "/rss/search");
  assert.match(url.searchParams.get("q"), /when:7d/);
  assert.equal(url.searchParams.get("hl"), "pt-BR");
  assert.equal(url.searchParams.get("gl"), "BR");
  assert.equal(url.searchParams.get("ceid"), "BR:pt-419");
});

test("extrai pistas de concursos do RSS e descarta links inseguros, notícias antigas e assuntos irrelevantes", () => {
  const xml = [
    "<rss><channel><item>",
    "<title>Prefeitura publica edital de concurso público com 40 vagas</title>",
    "<link>https://news.google.com/rss/articles/contest-001</link>",
    "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>",
    "<description>Seleção pública com edital e inscrições abertas.</description>",
    '<source url="https://portal.example.org">Portal de Notícias</source>',
    "</item><item>",
    "<title>Concurso público antigo</title><link>http://news.google.com/rss/articles/insecure</link>",
    "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item><item>",
    "<title>Concurso público encerrado há muito tempo</title>",
    "<link>https://news.google.com/rss/articles/old</link>",
    "<pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item><item>",
    "<title>Campeonato de futebol local</title>",
    "<link>https://news.google.com/rss/articles/sports</link>",
    "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>",
    "</item></channel></rss>"
  ].join("");
  const leads = parseGoogleNewsRss(xml, {
    now: new Date("2026-11-21T19:00:00-03:00"),
    queryLabel: "Concursos federais",
    feedUrl: "https://news.google.com/rss/search?q=concursos",
    maxResults: 8
  });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].discovery_type, "web_search_lead");
  assert.match(leads[0].title, /40 vagas/);
  assert.match(leads[0].context, /Portal de Notícias/);
  assert.match(leads[0].context, /Confirme o edital/);
  assert.match(leads[0].discovery_key, /^web-search-title:[a-f0-9]{64}$/);
  assert.match(leads[0].context, /Classificação automática: Inscrições\/prazo/);
});

test("repete falha temporária do feed de notícias e respeita Retry-After", async () => {
  const waits = [];
  let calls = 0;
  const feedUrl = buildGoogleNewsRssUrl("concurso público");
  const response = await fetchNewsFeedWithRetry(feedUrl, {
    attempts: 3,
    retryDelayMs: 10,
    nowMs: Date.parse("2026-11-22T12:00:00Z"),
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fetchImpl: async url => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporariamente indisponível", {
          status: 503,
          headers: { "Retry-After": "2" }
        });
      }
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
});

test("repete erro de rede e HTTP 429, mas não repete erros definitivos", async () => {
  const waits = [];
  let calls = 0;
  const feedUrl = buildGoogleNewsRssUrl("edital concurso");
  const response = await fetchNewsFeedWithRetry(feedUrl, {
    attempts: 3,
    retryDelayMs: 25,
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      if (calls === 2) return new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "3" }
      });
      return new Response("<rss/>", { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [25, 3000]);

  calls = 0;
  const notFound = await fetchNewsFeedWithRetry(feedUrl, {
    attempts: 4,
    retryDelayMs: 10,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response("not found", { status: 404 });
    }
  });
  assert.equal(notFound.status, 404);
  assert.equal(calls, 1);
});

test("bloqueia feeds fora do endpoint HTTPS autorizado", async () => {
  let calls = 0;
  await assert.rejects(() => fetchNewsFeedWithRetry("https://example.org/rss", {
    fetchImpl: async () => { calls += 1; return new Response("<rss/>"); }
  }), /somente feeds HTTPS previamente autorizados/);
  assert.equal(calls, 0);
});

test("consulta a busca pública com HTTPS, bloqueio de redirecionamentos e tratamento independente de falhas", async () => {
  const requested = [];
  const result = await searchInternetForContestLeads({
    queries: [
      { label: "Busca nacional", query: "concurso edital site:gov.br" },
      { label: "Busca estadual", query: "concurso Alagoas edital" }
    ],
    secondaryFeeds: [],
    now: new Date("2026-11-21T19:00:00-03:00"),
    attempts: 1,
    fallbackFetch: async () => { throw new Error("Fallback simulado indisponível"); },
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      if (url.includes("Alagoas")) throw new Error("Falha simulada");
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/rss+xml" }),
        text: async () => [
          "<rss><channel><item><title>Edital de concurso público municipal</title>",
          "<link>https://news.google.com/rss/articles/municipal-001</link>",
          "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>",
          "<description>Prefeitura anuncia vagas.</description>",
          "</item></channel></rss>"
        ].join("")
      };
    }
  });
  assert.equal(requested.length, 2);
  assert.ok(requested.every(item => item.url.startsWith("https://news.google.com/rss/search?")));
  assert.ok(requested.every(item => item.options.redirect === "manual"));
  assert.equal(result.feedsChecked, 2);
  assert.equal(result.leadCount, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.discoveries[0].discovery_type, "web_search_lead");
});

test("não reenfileira notícias já vistas em execuções anteriores do monitor", () => {
  const previousKeys = ["web-search:old-1", "web-search:old-2"];
  const items = [
    { discovery_key: "web-search:old-1", title: "Notícia repetida" },
    { discovery_key: "web-search:new-1", title: "Nova notícia" },
    { discovery_key: "web-search:new-1", title: "Duplicada na mesma consulta" }
  ];
  const result = filterUnseenWebSearchDiscoveries(items, previousKeys);
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.discoveries[0].title, "Nova notícia");
  assert.deepEqual(result.keys, ["web-search:old-1", "web-search:old-2", "web-search:new-1"]);
  const nextRun = filterUnseenWebSearchDiscoveries(items, result.keys);
  assert.equal(nextRun.discoveries.length, 0);
});


test("mantém feeds editoriais auxiliares explícitos, HTTPS e independentes do Google Notícias", () => {
  assert.equal(SECONDARY_NEWS_FEEDS.length, 3);
  assert.ok(SECONDARY_NEWS_FEEDS.every(feed => feed.feedUrl.startsWith("https://")));
  assert.ok(SECONDARY_NEWS_FEEDS.some(feed => feed.id === "concursos-no-brasil"
    && feed.feedUrl === "https://www.concursosnobrasil.com.br/feed/"));
  assert.ok(SECONDARY_NEWS_FEEDS.some(feed => feed.id === "estrategia-concursos"));
  assert.ok(SECONDARY_NEWS_FEEDS.some(feed => feed.id === "g1-concursos"));
});

test("extrai pistas recentes de RSS editorial sem tratar o artigo como prova oficial", () => {
  const feedUrl = "https://www.concursosnobrasil.com.br/feed/";
  const xml = [
    "<rss><channel><item>",
    "<title>Prefeitura de Igaci publica edital de concurso público com 20 vagas</title>",
    "<link>https://www.concursosnobrasil.com.br/noticias/concurso-igaci-2026/</link>",
    "<pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate>",
    "<description>O edital de seleção pública será disponibilizado pela prefeitura.</description>",
    "</item></channel></rss>"
  ].join("");
  const leads = parseSecondaryNewsRss(xml, {
    now: new Date("2026-11-22T12:30:00Z"),
    feedUrl,
    feedLabel: "Concursos no Brasil"
  });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].discovery_type, "web_search_lead");
  assert.equal(leads[0].source_url, feedUrl);
  assert.match(leads[0].candidate_url, /concursosnobrasil\.com\.br/);
  assert.match(leads[0].discovery_key, /^secondary-feed-title:[a-f0-9]{64}$/);
  assert.match(leads[0].context, /não é confirmação/);
  assert.doesNotMatch(leads[0].context, /Endereço informado para a fonte/);
});

test("busca feed editorial independente e transforma itens em pistas externas", async () => {
  const feed = SECONDARY_NEWS_FEEDS[0];
  const requested = [];
  const result = await searchInternetForContestLeads({
    queries: [],
    secondaryFeeds: [feed],
    now: new Date("2026-11-22T12:30:00Z"),
    attempts: 1,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return new Response([
        "<rss><channel><item>",
        "<title>Concurso público: prefeitura anuncia edital com vagas</title>",
        "<link>https://www.concursosnobrasil.com.br/noticias/concurso-municipal/</link>",
        "<pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate>",
        "</item></channel></rss>"
      ].join(""), { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
  });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].url, feed.feedUrl);
  assert.equal(requested[0].options.redirect, "manual");
  assert.equal(result.feedsChecked, 1);
  assert.equal(result.secondaryFeedsChecked, 1);
  assert.equal(result.leadCount, 1);
});


test("filtra materiais de estudo e gabaritos antes de criar pistas editoriais", () => {
  assert.equal(isActionableSecondaryNewsLead(
    "Gabarito Extraoficial TCDF – Analista Administrativo",
    "As provas foram aplicadas hoje; confira o gabarito comentado segundo o edital."
  ), false);
  assert.equal(isActionableSecondaryNewsLead(
    "Concurso CGU – Evidência e Conclusão",
    "Resumo de conteúdo de auditoria previsto no edital de todos os cargos."
  ), false);
  assert.equal(isActionableSecondaryNewsLead(
    "Leis de De Morgan: Resumo para concursos",
    "Material de estudo de lógica proposicional."
  ), false);
  assert.equal(isActionableSecondaryNewsLead(
    "Concurso BACEN terá a FGV como banca: 170 vagas!",
    "Novo concurso autorizado com vagas para cargos efetivos."
  ), true);
  assert.equal(isActionableSecondaryNewsLead(
    "Concurso Custódia PE: edital publicado com 1,2 mil vagas!",
    "A prefeitura publicou o edital do processo seletivo."
  ), true);
  assert.equal(isActionableSecondaryNewsLead(
    "Prefeitura de Igaci abre processo seletivo com 20 vagas",
    "Seleção pública para cargos temporários."
  ), true);
});

test("usa transporte alternativo restrito quando o feed falha no fetch ou responde 403", async () => {
  const feedUrl = SECONDARY_NEWS_FEEDS[0].feedUrl;
  for (const mode of ["network", "forbidden"]) {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const result = await fetchNewsFeedWithRetry(feedUrl, {
      attempts: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        primaryCalls += 1;
        if (mode === "network") throw new Error("fetch failed");
        return new Response("bloqueado", { status: 403 });
      },
      fallbackFetch: async url => {
        fallbackCalls += 1;
        assert.equal(url, feedUrl);
        return new Response("<rss><channel></channel></rss>", {
          status: 200,
          headers: { "content-type": "application/rss+xml" }
        });
      }
    });
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(result.status, 200);
  }
});

test("transporte curl rejeita feed não autorizado antes de qualquer requisição", async () => {
  await assert.rejects(
    () => fetchNewsFeedWithCurl("https://example.org/rss"),
    /transporte alternativo/
  );
});


test("aceita manchetes de concursos do G1 como pistas e mantém o destino oficial obrigatório", () => {
  const feed = SECONDARY_NEWS_FEEDS.find(item => item.id === "g1-concursos");
  const xml = [
    "<rss><channel><item>",
    "<title>Idaf lança edital de concurso público com salários de R$ 8 mil</title>",
    "<link>https://g1.globo.com/espirito-santo/noticia/2026/11/22/idaf-lanca-edital.ghtml</link>",
    "<pubDate>Sun, 22 Nov 2026 18:00:00 GMT</pubDate>",
    "<description>O edital do concurso oferece vagas para cargos de nível superior.</description>",
    "</item></channel></rss>"
  ].join("");
  const leads = parseSecondaryNewsRss(xml, {
    now: new Date("2026-11-22T18:30:00Z"),
    feedUrl: feed.feedUrl,
    feedLabel: feed.label
  });
  assert.equal(leads.length, 1);
  assert.match(leads[0].candidate_url, /^https:\/\/g1\.globo\.com\//);
  assert.match(leads[0].context, /ainda não é confirmação/);
});

test("pausa novas consultas ao Google Notícias depois de um HTTP 503 e continua com os feeds independentes", async () => {
  const queries = Array.from({ length: 5 }, (_, index) => ({
    label: "Consulta " + index,
    query: "concurso edital " + index
  }));
  let googleRequests = 0;
  let secondaryRequests = 0;
  const result = await searchInternetForContestLeads({
    queries,
    secondaryFeeds: [SECONDARY_NEWS_FEEDS.find(item => item.id === "g1-concursos")],
    concurrency: 2,
    googleConcurrency: 1,
    attempts: 1,
    retryDelayMs: 0,
    fallbackFetch: async () => new Response("temporariamente indisponível", { status: 503 }),
    fetchImpl: async url => {
      if (url.includes("news.google.com")) {
        googleRequests += 1;
        return new Response("temporariamente indisponível", { status: 503 });
      }
      secondaryRequests += 1;
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
  });

  assert.equal(googleRequests, 1);
  assert.equal(secondaryRequests, 1);
  assert.equal(result.googleFeedsChecked, 5);
  assert.equal(result.googleSkippedAfter503, 4);
  assert.equal(result.secondaryFeedsChecked, 1);
  assert.equal(result.errors.length, 5);
});


test("segue redirecionamento HTTPS entre domínio raiz e www do mesmo veículo editorial", async () => {
  const start = "https://www.concursosnobrasil.com.br/feed/";
  const destination = "https://concursosnobrasil.com.br/feed/";
  const calls = [];
  const response = await fetchNewsFeedWithRetry(start, {
    attempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, redirect: options.redirect });
      if (url === start) {
        return new Response(null, {
          status: 301,
          headers: { location: destination }
        });
      }
      if (url === destination) {
        return new Response("<rss><channel></channel></rss>", {
          status: 200,
          headers: { "content-type": "application/rss+xml" }
        });
      }
      throw new Error("URL inesperada: " + url);
    }
  });
  assert.deepEqual(calls, [
    { url: start, redirect: "manual" },
    { url: destination, redirect: "manual" }
  ]);
  assert.equal(response.status, 200);
});

test("permite redirecionamentos apenas entre hosts da mesma família editorial", () => {
  assert.equal(isSameTrustedSecondaryFeedPublisher(
    "concursosnobrasil.com.br",
    "www.concursosnobrasil.com.br"
  ), true);
  assert.equal(isSameTrustedSecondaryFeedPublisher(
    "concursos.estrategia.com",
    "www.estrategiaconcursos.com.br"
  ), true);
  assert.equal(isSameTrustedSecondaryFeedPublisher(
    "g1.globo.com",
    "concursosnobrasil.com.br"
  ), false);
  assert.equal(isSameTrustedSecondaryFeedPublisher(
    "g1.globo.com",
    "attacker.example"
  ), false);
});

test("bloqueia redirecionamento de feed para outro veículo autorizado ou destino HTTP", async () => {
  const start = "https://www.concursosnobrasil.com.br/feed/";
  for (const target of [
    "https://g1.globo.com/rss/feed.xml",
    "http://www.concursosnobrasil.com.br/feed/"
  ]) {
    await assert.rejects(() => fetchNewsFeedWithRetry(start, {
      attempts: 1,
      fetchImpl: async () => new Response(null, {
        status: 301,
        headers: { location: target }
      })
    }), /Redirecionamento do feed bloqueado/);
  }
});

test("impede que o feed Google Notícias redirecione para fora do endpoint fixo", async () => {
  const feedUrl = buildGoogleNewsRssUrl("concurso público");
  await assert.rejects(() => fetchNewsFeedWithRetry(feedUrl, {
    attempts: 1,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/feed.xml" }
    })
  }), /Redirecionamento do Google Notícias recusado/);
});


test("mantém o mesmo fingerprint quando somente o link da execução muda", () => {
  const input = {
    report: {
      unavailable: [{ url: "https://orgao.gov.br/concursos", message: "HTTP 503" }],
      restricted: [{ url: "https://banca.gov.br/concursos", message: "HTTP 403" }]
    },
    env: {
      MONITOR_OUTCOME: "success",
      PUBLISH_OUTCOME: "success",
      TRIAGE_OUTCOME: "success",
      TRIAGE_PENDING: "2",
      TRIAGE_PENDING_TOTAL: "5"
    }
  };
  const first = buildSourceMonitorIssueReport({ ...input, runUrl: "https://github.com/run/1" });
  const repeated = buildSourceMonitorIssueReport({ ...input, runUrl: "https://github.com/run/2" });

  assert.equal(first.fingerprint, repeated.fingerprint);
  assert.notEqual(first.body, repeated.body);
  assert.equal(sourceMonitorIssueNeedsUpdate(first.body, repeated.fingerprint), false);
});

test("gera novo fingerprint quando muda uma ocorrência ou o resumo da triagem", () => {
  const first = buildSourceMonitorIssueReport({
    report: { unavailable: [{ url: "https://orgao.gov.br/a", message: "HTTP 503" }] },
    env: { TRIAGE_PENDING_TOTAL: "2" }
  });
  const changedFinding = buildSourceMonitorIssueReport({
    report: { unavailable: [{ url: "https://orgao.gov.br/a", message: "HTTP 502" }] },
    env: { TRIAGE_PENDING_TOTAL: "2" }
  });
  const changedTriage = buildSourceMonitorIssueReport({
    report: { unavailable: [{ url: "https://orgao.gov.br/a", message: "HTTP 503" }] },
    env: { TRIAGE_PENDING_TOTAL: "3" }
  });

  assert.notEqual(first.fingerprint, changedFinding.fingerprint);
  assert.notEqual(first.fingerprint, changedTriage.fingerprint);
  assert.equal(sourceMonitorIssueNeedsUpdate(first.body, changedFinding.fingerprint), true);
  assert.equal(sourceMonitorIssueNeedsUpdate(first.body, changedTriage.fingerprint), true);
});

test("preserva novos links, acesso restrito e recuperação no relatório deduplicado", () => {
  const result = buildSourceMonitorIssueReport({
    report: {
      restricted: [{ url: "https://orgao.gov.br", message: "HTTP 403" }],
      recovered: [{ url: "https://banca.gov.br", message: "HTTP 200 após falha anterior" }],
      discoveries: [{
        discovery_type: "new_link",
        candidate_url: "https://orgao.gov.br/edital-02-2026.pdf",
        title: "Edital 02/2026",
        context: "Novo documento na página oficial"
      }]
    },
    runUrl: "https://github.com/run/3"
  });

  assert.match(result.body, /Acesso automatizado bloqueado\/limitado/);
  assert.match(result.body, /Fonte recuperada/);
  assert.match(result.body, /Novo link de oportunidade oficial/);
  assert.match(result.body, /edital-02-2026\.pdf/);
});

test("inicializa fingerprint em issue legada e suprime repetição depois disso", () => {
  const report = buildSourceMonitorIssueReport({ report: { changed: [{ url: "https://orgao.gov.br", message: "mudou" }] } });
  assert.equal(sourceMonitorIssueNeedsUpdate("Corpo anterior sem fingerprint", report.fingerprint), true);
  assert.equal(sourceMonitorIssueNeedsUpdate(report.body, report.fingerprint), false);
});


test("canonicaliza URLs de fontes oficiais e remove parâmetros de rastreamento", () => {
  assert.equal(
    normalizeOfficialSourceUrl("https://IGACI.AL.GOV.BR:443//concursos/?utm_source=facebook&fbclid=abc&ano=2026#edital"),
    "https://igaci.al.gov.br/concursos?ano=2026"
  );
  assert.equal(
    normalizeOfficialSourceUrl("https://igaci.al.gov.br/concursos?ano=2026&utm_campaign=x"),
    normalizeOfficialSourceUrl("https://igaci.al.gov.br/concursos?utm_medium=y&ano=2026")
  );
  assert.equal(normalizeOfficialSourceUrl("https://example.com/edital"), "");
});

test("deduplica links de edital que diferem somente por parâmetros de rastreamento", () => {
  const html = '<a href="/concursos/edital-01?utm_source=facebook">Edital 01/2026 — concurso público</a>'
    + '<a href="/concursos/edital-01?fbclid=abc">Edital 01/2026 — concurso público</a>';
  const links = extractOpportunityLinks(html, "https://igaci.al.gov.br/concursos");
  assert.equal(links.length, 1);
  assert.equal(links[0].candidate_url, "https://igaci.al.gov.br/concursos/edital-01");
});
