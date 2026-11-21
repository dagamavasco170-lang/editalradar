import test from "node:test";
import assert from "node:assert/strict";
import { classifyDiscovery, extractDocumentText, inferOrganization } from "./auto-resolve-discoveries.mjs";

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
