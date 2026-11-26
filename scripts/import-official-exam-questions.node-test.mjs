import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExamSourceCandidates,
  extractOfficialPdfLinks,
  pairExamAndAnswerPdfs,
  parseOfficialAnswerKey,
  validateQuestionForAutomaticPublication,
  readBoundedResponse,
  inferBoardFromOfficialUrl
} from "./import-official-exam-questions.mjs";

const officialPage = "https://conhecimento.fgv.br/concursos/exemplo";
const answerText = [
  "GABARITO DEFINITIVO",
  "01 - A",
  "02 - B",
  "03 - C",
  "04 - D",
  "05 - A",
  "06 - B"
].join("\n");

test("descobre fontes oficiais concluídas e ignora URLs não autorizadas", () => {
  const candidates = buildExamSourceCandidates({
    catalog: [
      { data: {
        orgao: "Tribunal de Justiça de Alagoas",
        cargo: "Analista Judiciário",
        vinculo: "Concurso público 2025",
        status: "Resultado final publicado",
        sourceUrl: officialPage
      } },
      { data: {
        orgao: "Órgão teste",
        cargo: "Cargo",
        vinculo: "Concurso público 2025",
        status: "Gabarito divulgado",
        sourceUrl: "https://www.pciconcursos.com.br/provas/"
      } }
    ],
    officialSources: [{
      board: "Cebraspe",
      exam_name: "Concurso PGE/AL",
      exam_year: 2024,
      source_url: "https://www.cebraspe.org.br/concursos/pgeal"
    }],
    staticContests: []
  });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some(candidate => candidate.board === "FGV"));
  assert.ok(candidates.some(candidate => candidate.board === "Cebraspe"));
});

test("identifica banca pelos hosts oficiais autorizados", () => {
  assert.equal(inferBoardFromOfficialUrl("https://cdn.cebraspe.org.br/prova.pdf"), "Cebraspe");
  assert.equal(inferBoardFromOfficialUrl("https://conhecimento.fgv.br/prova.pdf"), "FGV");
  assert.equal(inferBoardFromOfficialUrl("https://www.vunesp.com.br/prova.pdf"), "Vunesp");
});

test("extrai apenas PDFs com origem oficial e associa links por tipo de caderno", () => {
  const html = [
    '<a href="/sites/default/files/prova-tipo-a.pdf">Caderno de prova Tipo A</a>',
    '<a href="/sites/default/files/gabarito-definitivo-tipo-a.pdf">Gabarito definitivo Tipo A</a>',
    '<a href="https://www.pciconcursos.com.br/prova.pdf">Prova no PCI</a>'
  ].join("\n");
  const links = extractOfficialPdfLinks(html, officialPage);
  assert.equal(links.length, 2);
  const pairs = pairExamAndAnswerPdfs(links);
  assert.equal(pairs.length, 1);
  assert.match(pairs[0].exam.url, /prova-tipo-a\.pdf/);
  assert.match(pairs[0].answerKey.url, /gabarito-definitivo-tipo-a\.pdf/);
});

test("não associa gabarito preliminar ao caderno para publicação", () => {
  const links = [
    { url: "https://conhecimento.fgv.br/prova-tipo-a.pdf", label: "Caderno de prova Tipo A" },
    { url: "https://conhecimento.fgv.br/gabarito-preliminar-tipo-a.pdf", label: "Gabarito preliminar Tipo A" }
  ];
  assert.deepEqual(pairExamAndAnswerPdfs(links), []);
});

test("aceita apenas gabarito explicitamente definitivo/final e associa respostas sem conflito", () => {
  const key = parseOfficialAnswerKey([{ page: 1, text: answerText }], "Gabarito definitivo");
  assert.equal(key.valid, true);
  assert.equal(key.answers.size, 6);
  assert.equal(key.answers.get(1), "a");
  assert.equal(key.answers.get(6), "b");

  const preliminary = parseOfficialAnswerKey([{ page: 1, text: "GABARITO PRELIMINAR\n01 - A\n02 - B\n03 - C\n04 - D\n05 - A" }], "gabarito.pdf");
  assert.equal(preliminary.valid, false);
  assert.match(preliminary.reason, /preliminar/i);
});

test("remove números com gabarito conflitante e identifica questões anuladas", () => {
  const key = parseOfficialAnswerKey([{
    page: 1,
    text: "GABARITO DEFINITIVO\n01 - A\n01 - B\n02 - C\n03 - D\n04 - A\n05 - B\n06 - C\nQuestão 7 anulada"
  }], "gabarito definitivo");
  assert.equal(key.answers.has(1), false);
  assert.equal(key.annulled.has(7), true);
  assert.equal(key.valid, true);
});

test("aprova automaticamente apenas questão autônoma com estrutura e resposta consistentes", () => {
  const question = {
    prompt: "A administração pública direta e indireta deve observar os princípios constitucionais expressos no artigo 37 da Constituição.",
    options: [
      { id: "a", text: "Legalidade, impessoalidade, moralidade, publicidade e eficiência." },
      { id: "b", text: "Hierarquia, disciplina, sigilo, pessoalidade e autoridade." },
      { id: "c", text: "Supremacia, autotutela, continuidade, motivação e oportunidade." },
      { id: "d", text: "Proporcionalidade, informalidade, pessoalidade, eficiência e sigilo." }
    ],
    source_question_number: 1,
    review_notes: "Extração automática estruturada.",
    ocr_used: false
  };
  const key = { valid: true, answers: new Map([[1, "a"]]), annulled: new Set() };
  const result = validateQuestionForAutomaticPublication(question, key, {
    sourceOfficial: true,
    answerKeyOfficial: true,
    duplicateFree: true,
    sourceRestrictionsClear: true
  });
  assert.equal(result.eligible, true);
  assert.equal(result.score, 100);
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("rejeita questão com dependência de texto externo mesmo com gabarito correto", () => {
  const question = {
    prompt: "Com base no texto apresentado anteriormente, assinale a alternativa correta sobre a ideia central defendida pelo autor.",
    options: ["a","b","c","d"].map(id => ({ id, text: "Alternativa " + id.toUpperCase() + " com conteúdo suficientemente longo." })),
    source_question_number: 1,
    review_notes: "",
    ocr_used: false
  };
  const result = validateQuestionForAutomaticPublication(question, {
    valid: true, answers: new Map([[1, "a"]]), annulled: new Set()
  }, {
    sourceOfficial: true, answerKeyOfficial: true, duplicateFree: true, sourceRestrictionsClear: true
  });
  assert.equal(result.eligible, false);
  assert.equal(result.checks.standalone_text, false);
});


test("aprova automaticamente item Cebraspe Certo/Errado com gabarito definitivo correspondente", () => {
  const question = {
    prompt: "A administração pública deve observar os princípios constitucionais previstos no artigo 37 da Constituição Federal.",
    options: [{ id: "c", text: "Certo" }, { id: "e", text: "Errado" }],
    source_question_number: 1,
    review_notes: "Extração automática estruturada.",
    ocr_used: false
  };
  const key = { valid: true, answers: new Map([[1, "c"]]), annulled: new Set() };
  const result = validateQuestionForAutomaticPublication(question, key, {
    sourceOfficial: true, answerKeyOfficial: true,
    duplicateFree: true, sourceRestrictionsClear: true
  });
  assert.equal(result.eligible, true);
  assert.equal(result.score, 100);
  assert.equal(result.answer, "c");
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("limita respostas de rede para proteger espaço e não aceitar conteúdo ilimitado", async () => {
  const response = new Response(new Uint8Array([1,2,3,4]));
  const bytes = await readBoundedResponse(response, 4);
  assert.equal(bytes.length, 4);
  await assert.rejects(
    readBoundedResponse(new Response(new Uint8Array([1,2,3,4,5])), 4),
    /limite de tamanho/
  );
});

