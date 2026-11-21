import test from "node:test";
import assert from "node:assert/strict";
import { appendContext, buildPendingDiscoveriesUrl, buildRetificationUpdate, classifyDiscovery, extractDocumentText, extractVacancyDetails, fetchCandidateWithRetry, findMatchingContestForRetification, inferOrganization, mapWithConcurrency, normalizeContestIdentity, prepareDiscoveryDocument, summarizeFetchError } from "./auto-resolve-discoveries.mjs";

const discovery = {
  id: 1,
  source_url: "https://igaci.al.gov.br/concursos",
  candidate_url: "https://igaci.al.gov.br/concursos/edital-01-2026",
  title: "Edital 01/2026"
};

test("extrai título, cabeçalho e conteúdo de uma página HTML", () => {
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
  assert.equal(result.data.status, "Edital publicado · situação a confirmar");
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
  assert.equal(result.data.status, "Edital publicado · inscrições encerradas");
  assert.equal(result.data.historicoAtualizacoes.length, 2);
  assert.deepEqual(result.changes.map(change => change.field).sort(), ["status", "vagas"]);
  assert.equal(result.data.cargo, existing.cargo);
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

test("consulta apenas pendências novas ou cujo intervalo de retentativa venceu", () => {
  const url = new URL(buildPendingDiscoveriesUrl(
    "https://example.supabase.co",
    new Date("2026-11-21T18:00:00.000Z")
  ));

  assert.equal(url.searchParams.get("status"), "eq.pending");
  assert.equal(url.searchParams.get("discovery_type"), "eq.new_link");
  assert.match(url.searchParams.get("or"), /reviewed_at\.is\.null/);
  assert.match(url.searchParams.get("or"), /reviewed_at\.lt\.2026-11-21T12:00:00/);
  assert.equal(url.searchParams.get("limit"), "200");
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
