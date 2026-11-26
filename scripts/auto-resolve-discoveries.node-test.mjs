import test from "node:test";
import assert from "node:assert/strict";
import { appendContext, buildPendingDiscoveriesUrl, buildNonActionablePendingDiscoveriesUrl, dismissNonActionablePendingDiscoveries, buildRetificationUpdate, classifyDiscovery, extractDocumentText, extractRoleNamesFromText, extractVacancyDetails, fetchCandidateWithRetry, readBoundedResponseBytes, selectPdfOcrPages, findMatchingContestForRetification, inferOrganization, mapWithConcurrency, normalizeContestIdentity, normalizeOfficialUrl, normalizePdfVersionText, compareDocumentVersions, prepareDiscoveryDocument, isGenericOfficialLandingPage, countPendingDiscoveries, requestJson, summarizeFetchError, assessNoticeFreshness, extractDeclaredPublisherUrl, resolveGoogleNewsArticleUrl, prioritizePendingDiscoveries, selectDiscoveriesForTriage, isClearlyUnrelatedAdministrativeDiscovery, isTrustedSecondaryNewsHost, extractOfficialReferenceLinks, fetchSecondaryNewsArticle, autoResolvePending } from "./auto-resolve-discoveries.mjs";

const discovery = {
  id: 1,
  source_url: "https://igaci.al.gov.br/concursos",
  candidate_url: "https://igaci.al.gov.br/concursos/edital-01-2026",
  title: "Edital 01/2026"
};

test("extrai título, cabeçalho e conteúdo de uma página HTML", () => {
  assert.equal(extractRoleNamesFromText("Cargo/Área/Especialidade\n- Analista Judiciário - Área Judiciária - Subescrivão\n- Técnico Judiciário - Escrevente de Cartório")[0], "Analista Judiciário - Área Judiciária - Subescrivão");
  const doc = extractDocumentText("<html><head><title>Edital 01</title></head><body><nav>Menu</nav><h1>Concurso público</h1><p>30 vagas</p></body></html>");
  assert.equal(doc.title, "Edital 01");
  assert.equal(doc.heading, "Concurso público");
  assert.match(doc.text, /30 vagas/);
  assert.doesNotMatch(doc.text, /Menu/);
});


test("extrai cargos, escolaridade e vagas das tabelas de editais oficiais", () => {
  const document = extractDocumentText("<html><head><title>Município de Custódia (PE)</title></head><body><h1>Concurso</h1><p>Concurso público para o provimento de vagas imediatas em cargos efetivos da Prefeitura Municipal de Custódia (PE).</p><p>Edital: 002/2026 de 17/11/2026. Situação: Em andamento.</p><table><tr><th>Vaga</th><th>Escolaridade</th><th>Salário</th><th>Qtde.</th></tr><tr><td>AGENTE ADMINISTRATIVO I E II - Custódia (PE)</td><td>MÉDIO</td><td>R$ 1.900,00</td><td>22 + Cadastro de Reserva</td></tr><tr><td>ASSISTENTE SOCIAL - Custódia (PE)</td><td>SUPERIOR</td><td>R$ 2.000,00</td><td>3</td></tr></table></body></html>");
  assert.equal(document.tableRows.length,3);
  const result = classifyDiscovery(
    {...discovery,discovery_type:"new_link",title:"Município de Custódia (PE)"},
    document,
    "https://www.igeduc.org.br/informacoes/192/"
  );
  assert.equal(result.decision,"publish");
  assert.equal(result.data.orgao,"Prefeitura Municipal de Custódia");
  assert.equal(result.data.cargo,"AGENTE ADMINISTRATIVO I E II - Custódia (PE)");
  assert.equal(result.data.area,"Municipal");
  assert.equal(result.data.estado,"Pernambuco");
  assert.equal(result.data.nivel,"Médio/Técnico");
  assert.equal(result.data.vagas,null);
  assert.equal(result.data.vagasImediatas,25);
  assert.match(result.data.observacao,/cadastro de reserva não somado/);
});


test("identifica órgão estadual e cargo no texto do portal da FGV", () => {
  const html = "<html><head><title>Concurso Público para o Tribunal de Justiça do Estado de Santa Catarina - Juiz Substituto (2026)</title></head><body>"
    + "<h1>Concurso Público para o Tribunal de Justiça do Estado de Santa Catarina - Juiz Substituto (2026)</h1>"
    + "<p>Informações sobre o concurso público para o Tribunal de Justiça do Estado de Santa Catarina.</p>"
    + "<p>O concurso oferece vagas e formação de cadastro de reserva para o cargo de Juiz Substituto do Tribunal de Justiça do Estado de Santa Catarina, conforme consta no Edital.</p>"
    + "<p>Arquivos do concurso</p><p>Edital (retificado em 19/10/2026).</p></body></html>";
  const doc=extractDocumentText(html);
  const result=classifyDiscovery({...discovery,discovery_type:"new_link"},doc,"https://conhecimento.fgv.br/concursos/tjscjuiz26");
  assert.equal(result.decision,"publish");
  assert.equal(result.data.orgao,"Tribunal de Justiça do Estado de Santa Catarina");
  assert.equal(result.data.cargo,"Juiz Substituto");
  assert.equal(result.data.area,"Estadual");
  assert.equal(result.data.estado,"Santa Catarina");
});

test("extrai lista de cargos da seção Cargo/Área/Especialidade no padrão FCC", () => {
  const html = "<html><head><title>Tribunal de Justiça do Estado da Bahia</title></head><body>"
    + "<h1>Tribunal de Justiça do Estado da Bahia</h1>"
    + "<p>Concurso público para provimento de cargos do Tribunal de Justiça do Estado da Bahia.</p>"
    + "<p>Cargo/Área/Especialidade</p><ul>"
    + "<li>- Analista Judiciário - Área Judiciária - Subescrivão</li>"
    + "<li>- Técnico Judiciário - Escrevente de Cartório</li></ul>"
    + "<p>Links e Arquivos</p><p>Edital nº 01/2026.</p></body></html>";
  const doc=extractDocumentText(html);
  const result=classifyDiscovery({...discovery,discovery_type:"new_link"},doc,"https://www.concursosfcc.com.br/concursos/tjuba122/index.html");
  assert.equal(result.decision,"publish");
  assert.equal(result.data.orgao,"Tribunal de Justiça do Estado da Bahia");
  assert.equal(result.data.cargo,"Analista Judiciário - Área Judiciária - Subescrivão");
  assert.equal(result.data.estado,"Bahia");
  assert.equal(result.data.area,"Estadual");
  assert.match(result.data.observacao,/Técnico Judiciário/);
});



test("descarta título claramente administrativo sem descartar caso ambíguo de concurso", () => {
  const administrative = classifyDiscovery(
    { ...discovery, discovery_type: "new_link", title: "Consultar editais e ADEs" },
    {
      title: "Consultar editais e ADEs",
      heading: "Editais e atos declaratórios executivos",
      text: "Consulte editais e atos declaratórios executivos da Receita Federal."
    },
    "https://www.gov.br/pt-br/servicos/consultar-editais-e-atos-declaratorios-executivos-da-receita-federal"
  );
  assert.equal(administrative.decision, "dismiss");
  const ambiguous = classifyDiscovery(
    { ...discovery, discovery_type: "new_link", title: "Edital para concurso — detalhes a publicar" },
    { title: "Edital para concurso", heading: "Edital para concurso", text: "O órgão divulgará informações em breve." },
    "https://www.gov.br/concursos/novo-certame"
  );
  assert.equal(ambiguous.decision, "review");
});

test("descarta cadernos e variantes de prova da FGV em vez de cadastrá-los como novos concursos", () => {
  const artifacts = [
    {
      title: "Tipo 1",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-1.pdf"
    },
    {
      title: "Tipo 2",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-2.pdf"
    },
    {
      title: "Tipo 3",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-3.pdf"
    },
    {
      title: "Tipo 4",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-4.pdf"
    },
    {
      title: "Tipo 2",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns301-papiloscopista-policial-cns301-tipo-2.pdf"
    },
    {
      title: "Caderno de prova",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-caderno-de-prova.pdf"
    },
    {
      title: "Gabarito preliminar",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-gabarito-preliminar.pdf"
    },
    {
      title: "Resultado preliminar",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-resultado-preliminar.pdf"
    },
    {
      title: "Classificação final",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-classificacao-final.pdf"
    },
    {
      title: "Convocação",
      url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-convocacao.pdf"
    }
  ];
  const misleadingDocument = {
    title: "Concurso público da Polícia Civil do Paraná — Edital 01/2026",
    heading: "Concurso público",
    text: "Polícia Civil do Estado do Paraná. Concurso público. Edital nº 01/2026. Cargo: Agente de Polícia Judiciária e Papiloscopista Policial. Consulte o edital oficial."
  };

  for (const artifact of artifacts) {
    const result = classifyDiscovery(
      { ...discovery, discovery_type: "new_link", title: artifact.title },
      misleadingDocument,
      artifact.url
    );
    assert.equal(result.decision, "dismiss", artifact.url);
    assert.match(result.reason, /material auxiliar de avaliação/i);
  }
});

test("rejeita caderno de prova antes de baixar ou processar o PDF", async () => {
  let requests = 0;
  const result = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "new_link",
    title: "Tipo 1",
    candidate_url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-1.pdf"
  }, async () => {
    requests += 1;
    throw new Error("O download não deveria acontecer.");
  });

  assert.equal(result.stage, "dismiss");
  assert.match(result.reason, /material auxiliar de avaliação/i);
  assert.equal(requests, 0);
});

test("não descarta a página oficial principal da PCPR por mencionar prova no cronograma", () => {
  const result = classifyDiscovery(
    { ...discovery, discovery_type: "new_link", title: "Concurso público PCPR 2026" },
    {
      title: "Concurso público da Polícia Civil do Estado do Paraná — Edital 01/2026",
      heading: "Edital de abertura do concurso público",
      text: "A Polícia Civil do Estado do Paraná abre concurso público para provimento de cargos. Edital nº 01/2026. Cargo: Agente de Polícia Judiciária. O concurso terá prova objetiva e prova discursiva. Inscrições abertas."
    },
    "https://conhecimento.fgv.br/concursos/pcpr26"
  );
  assert.notEqual(result.decision, "dismiss");
  assert.doesNotMatch(result.reason || "", /material auxiliar de avaliação/i);
});

test("descarta editais históricos sem sinal oficial de vigência", () => {
  const result = assessNoticeFreshness({
    candidateUrl:"https://conhecimento.fgv.br/concursos/tjmsjuiz23",
    title:"Concurso Público para Tribunal de Justiça do Estado de Mato Grosso do Sul - Juiz Substituto",
    documentTitle:"TJMS Juiz Substituto 2023",
    text:"Edital 01/2023. Situação: encerrado. Resultado final homologado."
  }, new Date("2026-11-21T19:00:00-03:00"));
  assert.equal(result.decision,"dismiss");
  assert.equal(result.editionYear,2023);
});

test("mantém concursos do ano anterior para revisão quando a fonte não confirma andamento", () => {
  const result = assessNoticeFreshness({
    candidateUrl:"https://conhecimento.fgv.br/concursos/concursoteste25",
    title:"Concurso Público 2025",
    text:"Edital 01/2025."
  }, new Date("2026-11-21T19:00:00-03:00"));
  assert.equal(result.decision,"review");
  assert.equal(result.editionYear,2025);
});


test("ano de copyright não mascara edital antigo", () => {
  const result = assessNoticeFreshness({
    candidateUrl:"https://conhecimento.fgv.br/concursos/tjmsjuiz23",
    title:"Tribunal de Justiça do Estado de Mato Grosso do Sul",
    text:"Edital 01/2023. Cargos e vagas para Juiz Substituto. Copyright 2026."
  }, new Date("2026-11-21T19:00:00-03:00"));
  assert.equal(result.editionYear,2023);
  assert.equal(result.decision,"dismiss");
});

test("aceita ano antigo somente quando a fonte oficial comprova andamento atual", () => {
  const result = assessNoticeFreshness({
    candidateUrl:"https://conhecimento.fgv.br/concursos/concursoteste24",
    title:"Concurso Público 2024",
    text:"Edital 01/2024. Situação: Em andamento."
  }, new Date("2026-11-21T19:00:00-03:00"));
  assert.equal(result.decision,"publish");
  assert.equal(result.status,"Em andamento");
});

test("exige revisão quando a página não informa ano nem situação", () => {
  const result = assessNoticeFreshness({
    candidateUrl:"https://orgao.gov.br/concursos/seleção",
    title:"Concurso Público",
    text:"Edital. Cargo: Analista."
  }, new Date("2026-11-21T19:00:00-03:00"));
  assert.equal(result.decision,"review");
});

test("mantém pistas externas pendentes quando o publisher resolve para uma página inicial genérica", async () => {
  assert.equal(isGenericOfficialLandingPage("https://pontapora.ms.gov.br/v2/"), true);
  assert.equal(
    isGenericOfficialLandingPage("https://www.gov.br/cgu/pt-br/acesso-a-informacao/concursos/concursos-publicos/"),
    true
  );

  let fetchCalls = 0;
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    title: "[Notícia para conferir] Concurso citado em listagem ampla",
    candidate_url: "https://www.cebraspe.org.br/concursos/inscricoes-abertas",
    context: "Endereço informado para a fonte: https://www.cebraspe.org.br"
  }, async () => {
    fetchCalls += 1;
    return new Response("<h1>Concurso público</h1>", {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });
  });

  assert.equal(prepared.stage, "review");
  assert.match(prepared.reason, /página inicial|listagem genérica/i);
  assert.equal(fetchCalls, 0);
});

test("identifica órgão público explicitamente declarado", () => {
  assert.equal(inferOrganization("Concurso público da Prefeitura Municipal de Igaci"), "Prefeitura Municipal de Igaci");
});

test("cadastra automaticamente somente quando edital, seleção, cargo, órgão e jurisdição são identificáveis", () => {
  const page = {
    title: "Concurso público da Prefeitura Municipal de Igaci - Edital 01/2026",
    heading: "Edital de abertura do concurso público",
    text: "A Prefeitura Municipal de Igaci torna público o concurso público. Edital nº 01/2026. Cargo: Agente Administrativo. São oferecidas 30 vagas. Requisito: nível médio. Inscrições abertas."
  };
  const result = classifyDiscovery(discovery, page);
  assert.equal(result.decision, "publish");
  assert.equal(result.data.orgao, "Prefeitura Municipal de Igaci");
  assert.equal(result.data.cargo, "Agente Administrativo");
  assert.equal(result.data.vagas, 30);
  assert.equal(result.data.area, "Municipal");
  assert.equal(result.data.estado, "Alagoas");
  assert.equal(result.data.status, "Inscrições abertas");
});



test("prioriza a esfera federal mesmo quando o texto menciona estados de lotação", () => {
  const result = classifyDiscovery(
    { ...discovery, title: "Edital do Banco Central do Brasil" },
    {
      title: "Concurso público do Banco Central do Brasil - Edital 2026",
      heading: "Edital de abertura do concurso público",
      text: "O Banco Central do Brasil publica edital para o cargo de Auditor. As vagas terão lotação no Distrito Federal e em Alagoas. São oferecidas 30 vagas."
    },
    "https://www.bcb.gov.br/concursos/edital-2026"
  );
  assert.equal(result.decision, "publish");
  assert.equal(result.data.area, "Federal");
  assert.equal(result.data.estado, "Brasil");
});

test("extrai vagas imediatas e cadastro de reserva sem contar números genéricos", () => {
  assert.deepEqual(
    extractVacancyDetails("O edital prevê 40 vagas imediatas e 60 para cadastro de reserva (100 no total)."),
    { total: 100, imediatas: 40, reserva: 60 }
  );
  assert.deepEqual(
    extractVacancyDetails("A notícia cita 40 vagas e menciona outras 20 oportunidades de outro órgão."),
    { total: null, imediatas: null, reserva: null }
  );
  assert.deepEqual(
    extractVacancyDetails("São oferecidas 30 vagas imediatas."),
    { total: 30, imediatas: 30, reserva: null }
  );
});

test("não transforma menção histórica de inscrições abertas em situação atual confirmada", () => {
  const result = classifyDiscovery(
    { ...discovery, title: "Edital de concurso público da Prefeitura Municipal de Igaci" },
    {
      title: "Concurso público da Prefeitura Municipal de Igaci - Edital 01/2026",
      heading: "Edital de abertura do concurso público",
      text: "A Prefeitura Municipal de Igaci torna público o concurso público. Edital nº 01/2026. Cargo: Agente Administrativo. São oferecidas 30 vagas. Requisito: nível médio. No arquivo de notícias de 2024, as inscrições estavam abertas em outubro."
    }
  );
  assert.equal(result.decision, "publish");
  assert.equal(result.data.status, "Edital publicado · situação a confirmar");
});

test("reconhece retificação que não repete a expressão concurso público", () => {
  const result = classifyDiscovery(
    {
      ...discovery,
      title: "Retificação do Edital nº 01/2026"
    },
    {
      title: "Retificação do Edital nº 01/2026",
      heading: "Retificação do Edital",
      text: "A Prefeitura Municipal de Igaci torna pública a retificação do Edital nº 01/2026. O município fica em Alagoas. Cargo: Agente Administrativo. Onde se lê 20 vagas, leia-se 30 vagas."
    },
    "https://igaci.al.gov.br/concursos/edital-01-2026/retificacao.pdf"
  );

  assert.equal(result.decision, "publish");
  assert.equal(result.data.orgao, "Prefeitura Municipal de Igaci");
  assert.equal(result.data.cargo, "Agente Administrativo");
});

test("descarta páginas administrativas claramente sem relação com concursos", () => {
  const result = classifyDiscovery(
    { ...discovery, discovery_type: "new_link", title: "Transação Tributária" },
    { title: "Transação Tributária", heading: "Transação Tributária", text: "Serviços de transação tributária e negociação de débitos." }
  );
  assert.equal(result.decision, "dismiss");
});

test("mantém para revisão páginas ambíguas ou com dados incompletos", () => {
  const result = classifyDiscovery(discovery, {
    title: "Concurso público 2026",
    heading: "Concurso público",
    text: "A página apresenta informações gerais sobre concurso público. Consulte o edital."
  });
  assert.equal(result.decision, "review");
});

test("não publica conteúdo hospedado fora de domínio oficial autorizado", () => {
  const result = classifyDiscovery(discovery, {
    title: "Concurso público da Prefeitura Municipal de Igaci",
    heading: "Edital",
    text: "Concurso público, Edital nº 1, Cargo: Agente, 10 vagas."
  }, "https://example.com/edital");
  assert.equal(result.decision, "review");
});

test("atualiza o motivo da triagem automática sem duplicar comentários antigos", () => {
  const old = ["Contexto original", "", "[Triagem automática do EditalRadar] Tentativa anterior"].join(String.fromCharCode(10));
  const updated = appendContext(old, "PDF sem texto extraível");
  assert.match(updated, /Contexto original/);
  assert.match(updated, /PDF sem texto extraível/);
  assert.doesNotMatch(updated, /Tentativa anterior/);
});

test("repete uma falha temporária de rede e recupera o acesso à publicação", async () => {
  let calls = 0;
  const response = await fetchCandidateWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) });
    return { ok: true, status: 200 };
  }, "https://orgao.gov.br/edital", { attempts: 2, timeoutMs: 1000, retryDelayMs: 0 });
  assert.equal(response.ok, true);
  assert.equal(calls, 2);
});

test("respeita Retry-After do HTTP 429 antes de repetir a leitura do edital", async () => {
  const waits = [];
  let calls = 0;
  const response = await fetchCandidateWithRetry(async url => {
    calls += 1;
    if (calls === 1) return {
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "3" }),
      url
    };
    return { ok: true, status: 200, headers: new Headers(), url };
  }, "https://orgao.gov.br/edital", {
    attempts: 2,
    retryDelayMs: 5,
    sleepImpl: async milliseconds => waits.push(milliseconds)
  });
  assert.equal(response.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [3000]);
});

test("não usa transporte alternativo nem repete antes de Retry-After longo em HTTP 429", async () => {
  let calls = 0;
  let fallbackCalls = 0;
  const waits = [];
  const response = await fetchCandidateWithRetry(async url => {
    calls += 1;
    return { ok: false, status: 429, headers: new Headers({ "retry-after": "120" }), url };
  }, "https://orgao.gov.br/edital", {
    attempts: 3,
    retryDelayMs: 5,
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fallbackRequest: async url => {
      fallbackCalls += 1;
      return { ok: true, status: 200, url };
    }
  });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(waits, []);
});

test("não troca para transporte alternativo quando Retry-After longo acompanha HTTP 503", async () => {
  let calls = 0;
  let fallbackCalls = 0;
  const waits = [];
  const response = await fetchCandidateWithRetry(async url => {
    calls += 1;
    return { ok: false, status: 503, headers: new Headers({ "retry-after": "120" }), url };
  }, "https://orgao.gov.br/edital", {
    attempts: 3,
    retryDelayMs: 5,
    sleepImpl: async milliseconds => waits.push(milliseconds),
    fallbackRequest: async url => {
      fallbackCalls += 1;
      return { ok: true, status: 200, url };
    }
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(waits, []);
});

test("limita o corpo do documento durante leitura de stream sem Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  });
  await assert.rejects(
    () => readBoundedResponseBytes({ headers: new Headers(), body: stream }, 12, "Documento"),
    /Documento excede o limite/
  );
});

test("segue redirecionamento somente para outro destino oficial e HTTPS", async () => {
  const requested = [];
  const response = await fetchCandidateWithRetry(async (url, options) => {
    requested.push({ url, redirect: options.redirect });
    if (url.endsWith("/inicio")) {
      return { ok: false, status: 302, headers: new Headers({ location: "/edital.pdf" }), url };
    }
    return { ok: true, status: 200, headers: new Headers(), url };
  }, "https://orgao.gov.br/inicio", { timeoutMs: 1000 });
  assert.equal(response.ok, true);
  assert.equal(requested.length, 2);
  assert.ok(requested.every(item => item.redirect === "manual"));
  assert.equal(requested[1].url, "https://orgao.gov.br/edital.pdf");
});

test("bloqueia redirecionamento externo antes de requisitar o destino", async () => {
  const requested = [];
  await assert.rejects(() => fetchCandidateWithRetry(async (url) => {
    requested.push(url);
    return { ok: false, status: 302, headers: new Headers({ location: "https://example.com/metadata" }), url };
  }, "https://orgao.gov.br/inicio", { timeoutMs: 1000 }), /URL bloqueada/);
  assert.deepEqual(requested, ["https://orgao.gov.br/inicio"]);
});

test("bloqueia redirecionamento de HTTPS para HTTP", async () => {
  await assert.rejects(() => fetchCandidateWithRetry(async (url) => ({
    ok: false,
    status: 301,
    headers: new Headers({ location: "http://orgao.gov.br/edital" }),
    url
  }), "https://orgao.gov.br/inicio", { timeoutMs: 1000 }), /URL bloqueada/);
});

test("inclui o código e a causa técnica no diagnóstico de rede", () => {
  const message = summarizeFetchError(new TypeError("fetch failed", {
    cause: Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" })
  }));
  assert.match(message, /fetch failed/);
  assert.match(message, /ENOTFOUND/);
  assert.match(message, /DNS lookup failed/);
});


test("usa transporte alternativo quando as tentativas de fetch falham por rede", async () => {
  let fetchCalls = 0;
  let fallbackCalls = 0;
  const response = await fetchCandidateWithRetry(async () => {
    fetchCalls += 1;
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" })
    });
  }, "https://orgao.gov.br/edital", {
    attempts: 2,
    timeoutMs: 1000,
    retryDelayMs: 0,
    fallbackRequest: async () => {
      fallbackCalls += 1;
      return { ok: true, status: 200, url: "https://orgao.gov.br/edital" };
    }
  });

  assert.equal(fetchCalls, 2);
  assert.equal(fallbackCalls, 1);
  assert.equal(response.ok, true);
});



test("usa transporte alternativo também quando o servidor bloqueia fetch com HTTP 403", async () => {
  let primaryCalls=0;
  let fallbackCalls=0;
  const response=await fetchCandidateWithRetry(async url=>{
    primaryCalls+=1;
    return {ok:false,status:403,url};
  },"https://orgao.gov.br/edital",{
    attempts:1,timeoutMs:1000,retryDelayMs:0,
    fallbackRequest:async url=>{
      fallbackCalls+=1;
      return {ok:true,status:200,url};
    }
  });
  assert.equal(primaryCalls,1);
  assert.equal(fallbackCalls,1);
  assert.equal(response.status,200);
});

test("normaliza nomes para comparar o mesmo órgão e cargo", () => {
  assert.equal(normalizeContestIdentity("Agente Administrativo — Área Geral"), "agente administrativo area geral");
});

test("atualiza apenas campos explícitos da retificação e preserva histórico", () => {
  const existing = {
    id: 301,
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    status: "Edital publicado · inscrições abertas",
    nivel: "Médio",
    sourceUrl: discovery.candidate_url,
    historicoAtualizacoes: [{ at: "2026-01-01T00:00:00.000Z", type: "retificacao", changes: [] }]
  };
  const extracted = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 30,
    status: "Edital publicado · inscrições encerradas"
  };
  const document = {
    title: "1ª Retificação do Edital 01/2026",
    heading: "Retificação do concurso público",
    text: "A Prefeitura Municipal de Igaci publica retificação do concurso público. Cargo: Agente Administrativo. Onde se lê 20 vagas, leia-se 30 vagas. Inscrições encerradas."
  };
  const result = buildRetificationUpdate(existing, extracted, discovery, document);
  assert.equal(result.updated, true);
  assert.equal(result.data.vagas, 30);
  assert.equal(result.data.status, "Edital publicado · inscrições abertas");
  assert.equal(result.data.historicoAtualizacoes.length, 2);
  assert.deepEqual(result.changes.map(change => change.field).sort(), ["vagas"]);
  assert.equal(result.data.cargo, existing.cargo);
});

test("atualiza remuneração somente com par explícito e valor anterior compatível", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    remuneracao: { valor: "R$ 2.000,00", natureza: "Inicial" },
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital 01/2026" },
    {
      title: "Retificação do Edital 01/2026",
      text: "Retificação oficial. Para o cargo, onde se lê remuneração de R$ 2.000,00, leia-se remuneração de R$ 2.450,00."
    }
  );
  assert.equal(result.updated, true);
  assert.equal(result.data.remuneracao.valor, "R$ 2.450,00");
  assert.ok(result.changes.some(change => change.field === "remuneracao"));
});

test("mantém remuneração original quando o valor antigo não corresponde ao catálogo", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    remuneracao: { valor: "R$ 2.700,00" },
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital" },
    {
      title: "Retificação do Edital",
      text: "Retificação. Onde se lê remuneração de R$ 2.000,00, leia-se remuneração de R$ 2.450,00."
    }
  );
  assert.equal(result.updated, false);
  assert.equal(result.data, undefined);
});

test("atualiza prazo de inscrição e data de prova e publica o histórico legível", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    status: "Edital publicado · inscrições abertas",
    observacao: "Concurso para Agente Administrativo.",
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital 01/2026" },
    {
      title: "Retificação do Edital 01/2026",
      text: "Retificação do cronograma: onde se lê período de inscrições até 10/12/2026, leia-se período de inscrições até 20/12/2026. Onde se lê data da prova objetiva 15/01/2027, leia-se data da prova objetiva 22/01/2027."
    }
  );
  assert.equal(result.updated, true);
  assert.equal(result.data.prazoInscricao, "20/12/2026");
  assert.equal(result.data.dataProva, "22/01/2027");
  assert.match(result.data.status, /inscrições até 20\/12\/2026/);
  assert.match(result.data.observacao, /Prazo de inscrição alterado de 10\/12\/2026 para 20\/12\/2026/);
  assert.match(result.data.observacao, /Data da prova alterada de 15\/01\/2027 para 22\/01\/2027/);
  assert.ok(result.changes.some(change => change.field === "prazoInscricao"));
  assert.ok(result.changes.some(change => change.field === "dataProva"));
});

test("não atualiza contagem de vagas quando o valor corrigido anterior diverge do catálogo", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 18,
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital" },
    {
      title: "Retificação do Edital",
      text: "Onde se lê 20 vagas, leia-se 30 vagas."
    }
  );
  assert.equal(result.updated, false);
});

test("não atualiza registro se órgão ou cargo não corresponder exatamente", () => {
  const result = buildRetificationUpdate(
    { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", vagas: 20 },
    { orgao: "Prefeitura Municipal de Igaci", cargo: "Professor", vagas: 30 },
    discovery,
    { title: "Retificação", text: "Retificação do concurso público. Leia-se 30 vagas." }
  );
  assert.equal(result.updated, false);
  assert.match(result.reason, /não correspondem exatamente/i);
});

test("não trata mudança comum como retificação", () => {
  const result = buildRetificationUpdate(
    { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", vagas: 20 },
    { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", vagas: 30 },
    discovery,
    { title: "Edital atualizado", text: "Concurso público. 30 vagas." }
  );
  assert.equal(result.updated, false);
  assert.match(result.reason, /não apresenta evidência explícita/i);
});


test("vincula uma retificação em PDF ao concurso com mesmo órgão, cargo e domínio oficial", () => {
  const match = findMatchingContestForRetification({
    candidateUrl: "https://igaci.al.gov.br/concursos/edital-01-2026/retificacao-2.pdf",
    extractedData: { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo" },
    baseCatalog: [{
      id: 701,
      orgao: "Prefeitura Municipal de Igaci",
      cargo: "Agente Administrativo",
      sourceUrl: "https://igaci.al.gov.br/concursos/edital-01-2026"
    }]
  });

  assert.equal(match?.kind, "static");
  assert.equal(match?.id, 701);
});

test("não escolhe entre concursos repetidos com o mesmo órgão e cargo", () => {
  const match = findMatchingContestForRetification({
    candidateUrl: "https://igaci.al.gov.br/concursos/edital-2026/retificacao.pdf",
    extractedData: { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo" },
    baseCatalog: [
      { id: 701, orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", sourceUrl: "https://igaci.al.gov.br/concursos/edital-2025" },
      { id: 702, orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", sourceUrl: "https://igaci.al.gov.br/concursos/edital-2026" }
    ]
  });

  assert.equal(match, null);
});

test("prioriza correspondência exata de URL quando existem registros homônimos", () => {
  const match = findMatchingContestForRetification({
    candidateUrl: "https://igaci.al.gov.br/concursos/edital-2026",
    extractedData: { orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo" },
    baseCatalog: [
      { id: 701, orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", sourceUrl: "https://igaci.al.gov.br/concursos/edital-2025" },
      { id: 702, orgao: "Prefeitura Municipal de Igaci", cargo: "Agente Administrativo", sourceUrl: "https://igaci.al.gov.br/concursos/edital-2026" }
    ]
  });

  assert.equal(match?.id, 702);
});


test("limita a concorrência e mantém a ordem dos resultados", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 3);
});

test("a triagem rejeita chaves anon e desconhecidas antes de acessar o Supabase", async () => {
  let fetchCalled = false;
  for (const serviceRoleKey of [
    "header." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") + ".signature",
    "not-a-jwt"
  ]) {
    await assert.rejects(() => autoResolvePending({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey,
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("A credencial inválida não deveria alcançar o Supabase");
      }
    }), /credencial (pública|desconhecida)/);
  }
  assert.equal(fetchCalled, false);
});

test("a URL da fila de manutenção seleciona apenas linhas de base pendentes", () => {
  const url = new URL(buildNonActionablePendingDiscoveriesUrl("https://example.supabase.co"));
  assert.equal(url.searchParams.get("status"), "eq.pending");
  assert.equal(url.searchParams.get("discovery_type"), "eq.source_baseline");
  assert.equal(url.searchParams.get("order"), "detected_at.asc");
  assert.equal(url.searchParams.get("limit"), "1000");
});

test("encerra linhas de base sem tratá-las como oportunidades de concurso", async () => {
  const requests = [];
  const dismissed = await dismissNonActionablePendingDiscoveries(
    async (url, options) => {
      requests.push({ url, options });
      if (options.method === "PATCH") return new Response(null, { status: 204 });
      return new Response(JSON.stringify([{
        id: 901,
        source_url: "https://banca.org.br/concursos/",
        candidate_url: "https://banca.org.br/concursos/",
        title: "Página inicial acompanhada",
        context: "Primeira leitura da fonte.",
        discovery_type: "source_baseline",
        status: "pending"
      }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    "https://example.supabase.co",
    "test-service-role"
  );

  assert.equal(dismissed, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /discovery_type=eq\.source_baseline/);
  assert.equal(requests[1].options.method, "PATCH");
  const patch = JSON.parse(requests[1].options.body);
  assert.equal(patch.status, "dismissed");
  assert.match(patch.context, /Linha de base inicial/);
  assert.ok(patch.reviewed_at);
});

test("conta somente pendências que representam oportunidades acionáveis", async () => {
  let requestUrl = "";
  let requestOptions;
  const count = await countPendingDiscoveries(async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(null, {
      status: 200,
      headers: { "content-range": "0-0/27" }
    });
  }, "https://example.supabase.co", "test-service-role");

  assert.equal(count, 27);
  assert.match(requestUrl, /status=eq\.pending/);
  assert.equal(new URL(requestUrl).searchParams.get("discovery_type"), "in.(new_link,page_change,web_search_lead)");
  assert.equal(requestOptions.method, "HEAD");
  assert.match(requestOptions.headers.Prefer, /count=exact/);
});

test("a triagem repete automaticamente consultas Supabase com falha temporária", async () => {
  let calls = 0;
  const result = await requestJson(async () => {
    calls += 1;
    if (calls < 3) {
      return new Response("temporariamente indisponível", { status: 503 });
    }
    return new Response(JSON.stringify([{ id: 7 }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, "https://example.supabase.co/rest/v1/contest_discoveries", "test-service-role", {
    retryDelayMs: 100
  });
  assert.equal(calls, 3);
  assert.deepEqual(result, [{ id: 7 }]);
});

test("a triagem não repete inserção de catálogo não idempotente após resposta ambígua", async () => {
  let calls = 0;
  await assert.rejects(() => requestJson(async () => {
    calls += 1;
    return new Response("erro interno", { status: 503 });
  }, "https://example.supabase.co/rest/v1/contest_catalog", "test-service-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
    retryDelayMs: 100
  }), /HTTP 503/);
  assert.equal(calls, 1);
});

test("consulta fontes oficiais e pistas externas a cada 6 horas", () => {
  const now = new Date("2026-11-21T18:00:00.000Z");
  const officialUrl = new URL(buildPendingDiscoveriesUrl(
    "https://example.supabase.co", now, 6 * 60 * 60 * 1000, ["new_link", "page_change"]
  ));
  const externalUrl = new URL(buildPendingDiscoveriesUrl(
    "https://example.supabase.co", now, 6 * 60 * 60 * 1000, ["web_search_lead"]
  ));

  assert.equal(officialUrl.searchParams.get("status"), "eq.pending");
  assert.equal(officialUrl.searchParams.get("discovery_type"), "in.(new_link,page_change)");
  assert.match(officialUrl.searchParams.get("or"), /reviewed_at\.is\.null/);
  assert.match(officialUrl.searchParams.get("or"), /reviewed_at\.lt\.2026-11-21T12:00:00/);
  assert.equal(officialUrl.searchParams.get("limit"), "300");

  assert.equal(externalUrl.searchParams.get("discovery_type"), "in.(web_search_lead)");
  assert.match(externalUrl.searchParams.get("or"), /reviewed_at\.lt\.2026-11-21T12:00:00/);
  assert.equal(externalUrl.searchParams.get("limit"), "300");
  assert.equal(officialUrl.searchParams.get("order"), "reviewed_at.asc.nullsfirst,detected_at.asc");
  assert.equal(externalUrl.searchParams.get("order"), "reviewed_at.asc.nullsfirst,detected_at.asc");
});


test("mantém páginas-base fora da automação e rejeita tipos de descoberta desconhecidos", () => {
  const url = new URL(buildPendingDiscoveriesUrl(
    "https://example.supabase.co",
    new Date("2026-11-21T18:00:00.000Z"),
    6 * 60 * 60 * 1000,
    ["new_link", "page_change"]
  ));
  assert.equal(url.searchParams.get("discovery_type"), "in.(new_link,page_change)");
  assert.doesNotMatch(url.searchParams.get("discovery_type"), /source_baseline|web_search_lead/);
  assert.throws(() => buildPendingDiscoveriesUrl("https://example.supabase.co", new Date(), 0, ["source_baseline"]), /tipo permitido/);
});


test("descarta serviços administrativos claramente alheios a concursos antes de acessar a rede", async () => {
  const unrelated = [
    { title: "Avisos de Edital de Leilao", candidate_url: "https://www.gov.br/receitafederal/avisos-de-edital-de-leilao" },
    { title: "• Procurações (Autorizações de Acesso)", candidate_url: "https://www.gov.br/receitafederal/assuntos/procuracoes" },
    { title: "Consultar editais e ADEs", candidate_url: "https://www.gov.br/servicos/consultar-editais-e-atos-declaratorios-executivos" },
    { title: "Atos Declaratórios Executivos", candidate_url: "https://www.gov.br/receitafederal/atos-declaratorios" },
    { title: "Atos Declaratorios Executivos", candidate_url: "https://www.gov.br/receitafederal/atos-declaratorios" }
  ];
  let networkCalls = 0;
  for (const item of unrelated) {
    assert.equal(isClearlyUnrelatedAdministrativeDiscovery({ ...item, discovery_type: "new_link" }), true, item.title);
    const prepared = await prepareDiscoveryDocument({
      ...discovery, ...item, discovery_type: "new_link"
    }, async () => {
      networkCalls += 1;
      throw new Error("A rede não deveria ser chamada.");
    });
    assert.equal(prepared.stage, "dismiss");
    assert.match(prepared.reason, /sem relação com concurso/);
  }
  assert.equal(networkCalls, 0);
});

test("não descarta edital de concurso por engano no filtro administrativo antecipado", () => {
  const legitimate = {
    discovery_type: "new_link",
    title: "Edital 01/2026 — concurso público para agente administrativo",
    candidate_url: "https://banca.org.br/concursos/edital-01-2026"
  };
  assert.equal(isClearlyUnrelatedAdministrativeDiscovery(legitimate), false);
});

test("resolve a notícia do Google somente para a publicação no mesmo domínio oficial declarado", async () => {
  const officialUrl = "https://igaci.al.gov.br/concursos/edital-01-2026";
  const newsUrl = "https://news.google.com/rss/articles/opaque";
  const html = "<html><head><title>Edital 01/2026</title></head><body><h1>Concurso público</h1><p>Edital da Prefeitura Municipal de Igaci. 20 vagas.</p></body></html>";
  const requested = [];
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    candidate_url: newsUrl,
    context: "Pista externa. Endereço informado para a fonte: https://igaci.al.gov.br"
  }, async url => {
    requested.push(url);
    if (url === newsUrl) return new Response(null, { status: 302, headers: { location: officialUrl } });
    return {
      ok: true,
      status: 200,
      url,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer
    };
  }, { fallbackRequest: async () => { throw new Error("fallback inesperado"); } });

  assert.deepEqual(requested, [newsUrl, officialUrl]);
  assert.equal(prepared.stage, "ready");
  assert.equal(prepared.candidateUrl, officialUrl);
});


test("resolve redirecionador do Google apenas quando o parâmetro aponta ao publisher autorizado", async () => {
  const officialUrl = "https://igaci.al.gov.br/concursos/edital-01-2026.pdf";
  const redirectUrl = "https://www.google.com/url?url=" + encodeURIComponent(officialUrl);
  const result = await resolveGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/teste",
    "https://igaci.al.gov.br",
    async () => new Response(null, { status: 302, headers: { location: redirectUrl } })
  );
  assert.equal(result, officialUrl);
});

test("não segue redirecionamento Google para outro domínio oficial diferente do publisher declarado", async () => {
  await assert.rejects(() => resolveGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/teste",
    "https://igaci.al.gov.br",
    async () => new Response(null, { status: 302, headers: { location: "https://outro.gov.br/edital.pdf" } })
  ), /não corresponde ao domínio oficial indicado/);
});

test("mantém notícia pendente quando o Google não revela um destino oficial", async () => {
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    candidate_url: "https://news.google.com/rss/articles/teste",
    context: "Pista externa. Endereço informado para a fonte: https://igaci.al.gov.br"
  }, async () => new Response("<html>Google Notícias</html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
  assert.equal(prepared.stage, "review");
  assert.match(prepared.reason, /não revelou um endereço verificável/);
});

test("extrai somente publisher HTTPS presente na lista de fontes oficiais", () => {
  assert.equal(extractDeclaredPublisherUrl("Endereço informado para a fonte: https://igaci.al.gov.br")?.hostname, "igaci.al.gov.br");
  assert.equal(extractDeclaredPublisherUrl("Endereço informado para a fonte: http://igaci.al.gov.br"), null);
  assert.equal(extractDeclaredPublisherUrl("Endereço informado para a fonte: https://blog.example.com"), null);
});

test("prioriza itens nunca analisados e evita que tentativas antigas monopolizem a fila", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const rows = [
    { id: 1, status: "pending", discovery_type: "new_link", title: "Edital 01/2026 — concurso público", candidate_url: "https://banca.org.br/concursos/edital-01-2026.pdf", detected_at: "2026-11-20T09:00:00.000Z", reviewed_at: "2026-11-22T06:00:00.000Z" },
    { id: 2, status: "pending", discovery_type: "web_search_lead", title: "Notícia sobre edital de seleção", candidate_url: "https://news.google.com/rss/articles/a", detected_at: "2026-11-22T11:00:00.000Z" },
    { id: 3, status: "pending", discovery_type: "new_link", title: "Edital 02/2026 — concurso público", candidate_url: "https://banca.org.br/concursos/edital-02-2026.pdf", detected_at: "2026-11-22T10:00:00.000Z" }
  ];
  assert.deepEqual(prioritizePendingDiscoveries(rows, now).map(item => item.id), [3, 2, 1]);
});

test("limita cada rodada e informa quantas oportunidades ficam para a próxima execução", () => {
  const official = Array.from({ length: 4 }, (_, index) => ({
    id: index + 1,
    status: "pending",
    discovery_type: "new_link",
    title: "Edital " + (index + 1) + "/2026 — concurso público",
    candidate_url: "https://banca.org.br/concursos/edital-" + (index + 1) + "-2026.pdf",
    detected_at: "2026-11-22T10:00:00.000Z",
    reviewed_at: null
  }));
  const external = [{
    id: 5,
    status: "pending",
    discovery_type: "web_search_lead",
    title: "Notícia sobre edital",
    detected_at: "2026-11-22T11:00:00.000Z"
  }];
  const selection = selectDiscoveriesForTriage(official, external, 3, Date.parse("2026-11-22T12:00:00.000Z"));
  assert.equal(selection.eligible.length, 5);
  assert.equal(selection.discoveries.length, 3);
  assert.equal(selection.limit, 3);
  assert.equal(selection.deferred, 2);
  assert.ok(selection.discoveries.every(item => item.reviewed_at == null));
});

test("prioriza links específicos de edital e mantém pistas externas abaixo de fontes monitoradas", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const items = [
    { id: 1, status: "pending", discovery_type: "web_search_lead", title: "Concurso público, edital e vagas", context: "Pista externa", candidate_url: "https://news.google.com/rss/articles/a", detected_at: "2026-11-22T11:00:00.000Z" },
    { id: 2, status: "pending", discovery_type: "new_link", title: "Edital 01/2026 — concurso público, 20 vagas", context: "Cargo identificado", candidate_url: "https://banca.org.br/concursos/edital-01-2026.pdf", detected_at: "2026-11-22T10:00:00.000Z" },
    { id: 3, status: "pending", discovery_type: "new_link", title: "Consultar editais e ADEs", context: "Página administrativa", candidate_url: "https://www.gov.br/servicos/consultar-editais", detected_at: "2026-11-22T09:00:00.000Z" }
  ];
  assert.deepEqual(prioritizePendingDiscoveries(items, now).map(item => item.id), [2, 1, 3]);
});


test("mantém pistas externas sem domínio oficial na fila em vez de descartá-las ou publicá-las", async () => {
  let calls = 0;
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    candidate_url: "https://news.google.com/rss/articles/opaque",
    context: "Pista externa. Endereço informado para a fonte: https://portal-privado.example.org/concursos"
  }, async () => { calls += 1; throw new Error("não deveria requisitar domínio não autorizado"); });
  assert.equal(prepared.stage, "review");
  assert.equal(calls, 0);
  assert.match(prepared.reason, /veículo editorial auxiliar autorizado/);
});

test("descarta páginas genéricas de categoria da banca sem consultar conteúdo como edital", async () => {
  let calls=0;
  const result=await prepareDiscoveryDocument({
    ...discovery,
    candidate_url:"https://www.institutoaocp.org.br/concursos/status/inscricoes-abertas"
  },async()=>{calls+=1;throw new Error("não deveria consultar a página de categoria");});
  assert.equal(result.stage,"dismiss");
  assert.match(result.reason,/Página geral de categoria/);
  assert.equal(calls,0);
});

test("prepara documento oficial para triagem sem escrever no banco", async () => {
  const html = "<html><head><title>Edital 01/2026</title></head><body><h1>Concurso público</h1><p>Edital da Prefeitura Municipal de Igaci. 20 vagas.</p></body></html>";
  let calls = 0;
  const prepared = await prepareDiscoveryDocument(discovery, async url => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      url,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer
    };
  }, { fallbackRequest: async () => { throw new Error("fallback não deveria ser chamado"); } });

  assert.equal(calls, 1);
  assert.equal(prepared.stage, "ready");
  assert.equal(prepared.candidateUrl, discovery.candidate_url);
  assert.match(prepared.document.text, /20 vagas/);
});


test("localiza exatamente um link de edital oficial dentro de artigo secundário", async () => {
  const articleUrl = "https://www.concursosnobrasil.com.br/noticias/concurso-igaci-2026/";
  const officialUrl = "https://igaci.al.gov.br/concursos/edital-01-2026";
  const articleHtml = '<html><body><article><p>Veja o concurso anunciado.</p><a href="' + officialUrl + '">Clique para acessar o edital oficial</a></article></body></html>';
  const references = extractOfficialReferenceLinks(articleHtml, articleUrl);
  assert.equal(references.length, 1);
  assert.equal(references[0].url, officialUrl);
  assert.equal(isTrustedSecondaryNewsHost("www.concursosnobrasil.com.br"), true);
  assert.equal(isTrustedSecondaryNewsHost("g1.globo.com"), true);
  assert.equal(isTrustedSecondaryNewsHost("evil-g1.globo.com.attacker.test"), false);
  assert.equal(isTrustedSecondaryNewsHost("news.example.org"), false);
});

test("triagem de notícia editorial só abre a publicação depois de localizar um link oficial único", async () => {
  const articleUrl = "https://www.concursosnobrasil.com.br/noticias/concurso-igaci-2026/";
  const officialUrl = "https://igaci.al.gov.br/concursos/edital-01-2026";
  const articleHtml = '<html><body><article><p>Veja o concurso anunciado.</p><a href="' + officialUrl + '">Clique para acessar o edital oficial</a></article></body></html>';
  const officialHtml = "<html><head><title>Edital 01/2026</title></head><body><h1>Concurso público</h1><p>Prefeitura Municipal de Igaci. 20 vagas para cargos efetivos. Edital 01/2026.</p></body></html>";
  const requested = [];
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    source_url: "https://www.concursosnobrasil.com.br/feed/",
    candidate_url: articleUrl,
    title: "[Edital/publicação] Concursos no Brasil: Prefeitura de Igaci publica edital de concurso",
    context: "Pista encontrada em feed editorial independente; ainda não é confirmação de concurso."
  }, async url => {
    requested.push(url);
    if (url === articleUrl) {
      return new Response(articleHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url === officialUrl) {
      return new Response(officialHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw new Error("URL inesperada: " + url);
  }, { fallbackRequest: async () => { throw new Error("fallback inesperado"); } });

  assert.equal(prepared.stage, "ready", prepared.reason);
  assert.deepEqual(requested, [articleUrl, officialUrl]);
  assert.equal(prepared.candidateUrl, officialUrl);
  assert.match(prepared.document.text, /Prefeitura Municipal de Igaci/);
});

test("página editorial com vários editais oficiais possíveis continua pendente", async () => {
  const articleUrl = "https://www.concursosnobrasil.com.br/noticias/concursos-abertos/";
  const html = '<a href="https://igaci.al.gov.br/concursos/edital-01-2026.pdf">Edital de Igaci</a>'
    + '<a href="https://arapiraca.al.gov.br/concursos/edital-02-2026.pdf">Edital de Arapiraca</a>';
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    candidate_url: articleUrl,
    context: "Pista editorial."
  }, async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
  assert.equal(prepared.stage, "review");
  assert.match(prepared.reason, /mais de um link oficial possível/);
});

test("bloqueia redirecionamento de artigo editorial para domínio que não esteja autorizado", async () => {
  const articleUrl = "https://www.concursosnobrasil.com.br/noticias/concurso/";
  const requested = [];
  const prepared = await prepareDiscoveryDocument({
    ...discovery,
    discovery_type: "web_search_lead",
    candidate_url: articleUrl,
    context: "Pista editorial."
  }, async (url) => {
    requested.push(url);
    return new Response(null, { status: 302, headers: { location: "https://example.net/redirect" } });
  });
  assert.equal(prepared.stage, "review");
  assert.deepEqual(requested, [articleUrl]);
  assert.match(prepared.reason, /veículo secundário previamente autorizado/);
});

test("recusa respostas de notícia de formato inesperado", async () => {
  const articleUrl = "https://concursos.estrategia.com/noticias/concurso/";
  await assert.rejects(() => fetchSecondaryNewsArticle(articleUrl, async () => new Response("PDF", {
    status: 200,
    headers: { "content-type": "application/pdf" }
  })), /não retornou HTML/);
});


test("aceita artigo do G1 como pista, mas extrai apenas links HTTPS oficiais autorizados", async () => {
  const articleUrl = "https://g1.globo.com/espirito-santo/noticia/2026/11/22/idaf-lanca-edital.ghtml";
  const officialUrl = "https://idaf.es.gov.br/concursos/edital-01-2026";
  const html = '<article><p>O edital do concurso foi publicado.</p><a href="' + officialUrl + '">Confira o edital oficial</a></article>';
  const references = extractOfficialReferenceLinks(html, articleUrl);
  assert.equal(references.length, 1);
  assert.equal(references[0].url, officialUrl);
  assert.equal(isTrustedSecondaryNewsHost("g1.globo.com"), true);
});


test("não altera status de inscrição por texto histórico fora de uma correção explícita", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    status: "Edital publicado · inscrições abertas",
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital 01/2026" },
    {
      title: "Retificação do Edital 01/2026",
      text: "Retificação do edital. Cargo: Agente Administrativo. O cronograma original informava inscrições encerradas em 10/11/2026."
    }
  );
  assert.equal(result.updated, false);
  assert.equal(existing.status, "Edital publicado · inscrições abertas");
});

test("não altera quantidade de vagas por menção isolada sem indicar valor corrigido", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    status: "Edital publicado · inscrições abertas",
    historicoAtualizacoes: []
  };
  const result = buildRetificationUpdate(
    existing,
    { orgao: existing.orgao, cargo: existing.cargo },
    { ...discovery, title: "Retificação do Edital 01/2026" },
    {
      title: "Retificação do Edital 01/2026",
      text: "Retificação do edital. Cargo: Agente Administrativo. O documento menciona 30 vagas em caráter informativo, sem indicar alteração do quantitativo."
    }
  );
  assert.equal(result.updated, false);
  assert.equal(existing.vagas, 20);
});


test("normaliza URLs oficiais removendo tracking, fragmentos e diferenças irrelevantes", () => {
  assert.equal(
    normalizeOfficialUrl("https://IGACI.AL.GOV.BR:443//concursos/edital-01/?utm_source=facebook&fbclid=abc&ano=2026#documento"),
    "https://igaci.al.gov.br/concursos/edital-01?ano=2026"
  );
  assert.equal(
    normalizeOfficialUrl("https://igaci.al.gov.br/concursos/edital-01?ano=2026&utm_campaign=x"),
    normalizeOfficialUrl("https://igaci.al.gov.br/concursos/edital-01?utm_medium=y&ano=2026")
  );
  assert.equal(normalizeOfficialUrl("javascript:alert(1)"), "");
});

test("distribui OCR por todo PDF digitalizado sem exceder 12 páginas", () => {
  const selected = selectPdfOcrPages(100, [], "", 12);
  assert.equal(selected.length, 12);
  assert.ok(selected.includes(1));
  assert.ok(selected.includes(2));
  assert.ok(selected.includes(3));
  assert.ok(selected.includes(100));
  assert.ok(selected[0] <= 3);
  assert.ok(selected.at(-1) >= 99);
  assert.ok(selected.every((page, index) => page >= 1 && page <= 100 && (index === 0 || page > selected[index - 1])));
});

test("distribui OCR entre páginas esparsas ao longo de PDFs mistos", () => {
  const pages = Array.from({ length: 60 }, (_, index) => index % 2 === 0 ? "" : "Texto digital extraído com densidade suficiente para não ser selecionado");
  const selected = selectPdfOcrPages(60, pages, "texto extraído", 12, 45);
  assert.equal(selected.length, 12);
  assert.ok(selected[0] <= 2);
  assert.ok(selected.at(-1) >= 58);
  assert.ok(selected.every(page => page % 2 === 1));
});

test("compara versões textuais de PDF ignorando numeração de página e detectando mudanças críticas", () => {
  const previous = "EDITAL 01/2026\nPágina 1 de 20\nPeríodo de inscrições: até 10/12/2026\n20 vagas";
  const current = "EDITAL 01/2026\nPágina 1 de 21\nPeríodo de inscrições: até 20/12/2026\n25 vagas";
  const result = compareDocumentVersions(previous, current);
  assert.equal(result.changed, true);
  assert.equal(result.addedLineCount, 2);
  assert.equal(result.removedLineCount, 2);
  assert.ok(result.criticalAreas.includes("prazos"));
  assert.ok(result.criticalAreas.includes("vagas"));
  assert.equal(normalizePdfVersionText("Página 2 de 10\nTexto"), "Texto");
});

test("registra baseline de retificação mesmo sem correção estruturada e não duplica a mesma versão", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    historicoAtualizacoes: []
  };
  const item = { ...discovery, title: "Retificação do Edital 01/2026" };
  const document = {
    title: "Retificação do Edital 01/2026",
    text: "Retificação do Edital 01/2026\nA comissão publica nova versão para consulta dos candidatos."
  };
  const first = buildRetificationUpdate(existing, {
    orgao: existing.orgao, cargo: existing.cargo
  }, item, document);
  assert.equal(first.updated, true);
  assert.deepEqual(first.changes, []);
  assert.equal(first.data.historicoAtualizacoes.length, 1);
  assert.equal(first.data.historicoAtualizacoes[0].documentVersion.comparison, null);
  assert.match(first.data.historicoAtualizacoes[0].documentVersion.sha256, /^[a-f0-9]{64}$/);

  const repeated = buildRetificationUpdate(first.data, {
    orgao: existing.orgao, cargo: existing.cargo
  }, item, document);
  assert.equal(repeated.updated, false);
  assert.equal(repeated.data, undefined);
  assert.equal(first.data.historicoAtualizacoes.length, 1);
});

test("compara nova versão sem correções estruturadas com a baseline anterior", () => {
  const existing = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    historicoAtualizacoes: [{
      type: "retificacao",
      documentVersion: {
        sha256: "placeholder",
        textSnapshot: "Retificação do Edital 01/2026\nA comissão publica nova versão para consulta dos candidatos."
      }
    }]
  };
  const result = buildRetificationUpdate(existing, {
    orgao: existing.orgao, cargo: existing.cargo
  }, { ...discovery, title: "Retificação do Edital 01/2026" }, {
    title: "Retificação do Edital 01/2026",
    text: "Retificação do Edital 01/2026\nA comissão publica nova versão para consulta dos candidatos.\nO atendimento presencial ocorrerá em horário especial."
  });
  assert.equal(result.updated, true);
  assert.deepEqual(result.changes, []);
  const version = result.data.historicoAtualizacoes.at(-1).documentVersion;
  assert.equal(version.comparison.changed, true);
  assert.ok(version.comparison.addedLineCount >= 1);
});

test("mantém histórico de versão e resumo comparativo ao registrar retificação subsequente", () => {
  const previousText = "Retificação do Edital 01/2026\nPrazo de inscrição: até 10/12/2026\n20 vagas";
  const previous = {
    orgao: "Prefeitura Municipal de Igaci",
    cargo: "Agente Administrativo",
    vagas: 20,
    prazoInscricao: "10/12/2026",
    historicoAtualizacoes: [{
      type: "retificacao",
      documentVersion: { textSnapshot: previousText, sha256: "baseline" }
    }]
  };
  const result = buildRetificationUpdate(
    previous,
    { orgao: previous.orgao, cargo: previous.cargo, vagas: 25 },
    { ...discovery, title: "Retificação do Edital 01/2026", candidate_url: "https://igaci.al.gov.br/retificacao.pdf?utm_source=x" },
    { title: "Retificação do Edital 01/2026", text: "Retificação do Edital 01/2026\nOnde se lê: 20 vagas\nLeia-se: 25 vagas\nPrazo de inscrição: até 20/12/2026" }
  );
  assert.equal(result.updated, true);
  const version = result.data.historicoAtualizacoes.at(-1).documentVersion;
  assert.match(version.sha256, /^[a-f0-9]{64}$/);
  assert.equal(version.comparison.changed, true);
  assert.ok(version.comparison.criticalAreas.includes("prazos"));
  assert.ok(version.comparison.criticalAreas.includes("vagas"));
  assert.equal(result.data.historicoAtualizacoes.at(-1).candidateUrl, "https://igaci.al.gov.br/retificacao.pdf");
});
