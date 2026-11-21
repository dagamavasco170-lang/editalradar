import test from "node:test";
import assert from "node:assert/strict";
import { appendContext, buildRetificationUpdate, classifyDiscovery, extractDocumentText, fetchCandidateWithRetry, inferOrganization, normalizeContestIdentity, summarizeFetchError } from "./auto-resolve-discoveries.mjs";

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
  assert.equal(result.data.status, "Edital publicado · inscrições abertas");
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
