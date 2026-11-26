import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportManifest,
  normalizeQuestionText,
  parseExamPages,
  sha256
} from "./import-official-exam-pdf.mjs";

const documentHash = sha256("sample-pdf-document");
const samplePages = [{
  page: 3,
  text: [
    "QUESTÃO 01",
    "Assinale a alternativa que apresenta a regra correta para o caso descrito no enunciado.",
    "(A) Primeira alternativa com conteúdo suficientemente extenso.",
    "(B) Segunda alternativa com conteúdo suficientemente extenso.",
    "(C) Terceira alternativa com conteúdo suficientemente extenso.",
    "(D) Quarta alternativa com conteúdo suficientemente extenso.",
    "2. Julgue a afirmação a seguir conforme o texto apresentado pela banca examinadora.",
    "A) A primeira proposição está correta conforme as regras aplicáveis.",
    "B) A segunda proposição está correta conforme as regras aplicáveis."
  ].join("\n")
}];

const metadata = {
  board: "Cebraspe",
  exam_name: "Concurso de teste",
  exam_year: 2025,
  discipline: "Língua Portuguesa",
  source_url: "https://www.cebraspe.org.br/concursos/exemplo",
  exam_pdf_url: "https://cdn.cebraspe.org.br/concursos/exemplo/prova.pdf",
  rights_basis: "official_publication",
  official_release_verified: true,
  question_format: "multiple_choice"
};

test("normaliza acentos, caixa e espaços para fingerprint estável", () => {
  assert.equal(normalizeQuestionText("  Ação   Pública! "), "acao publica");
});

test("extrai itens objetivos e preserva página/número sem inventar gabarito", () => {
  const rows = parseExamPages(samplePages, documentHash);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_page, 3);
  assert.equal(rows[0].source_question_number, 1);
  assert.equal(rows[0].options.length, 4);
  assert.equal(rows[0].options[0].id, "a");
  assert.equal(rows[0].suggested_answer, null);
  assert.match(rows[0].fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(rows[1].source_question_number, 2);
  assert.equal(rows[1].options.length, 2);
});


test("reconhece opções Cebraspe com letra separada por espaço e aspas tipográficas", () => {
  const pages = [{
    page: 1,
    text: [
      "QUESTÃO 1",
      "Assinale a opção correspondente à frase do texto que representa a síntese de suas ideias.",
      "A “O conceito de verdade tem sido abordado e compreendido de diferentes formas por diversos pensadores.”",
      "B “Os filósofos gregos começaram a buscar a verdade em relação ou oposição à falsidade.”",
      "C “Assim, um elemento necessário à verdade era a visão inteligível.”",
      "D “A formulação do problema do critério de verdade ocupou os adeptos da gnosiologia.”"
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].options.map(option => option.id), ["a", "b", "c", "d"]);
  assert.match(rows[0].options[0].text, /^“O conceito de verdade/);
});



test("extrai itens Cebraspe ITEM n como Certo/Errado sem inferir resposta", () => {
  const pages = [{
    page: 2,
    text: [
      "ITEM 1",
      "NO QUE SE REFERE AOS FUNDAMENTOS DA ATENÇÃO PRIMÁRIA À SAÚDE, JULGUE O ITEM A SEGUIR.",
      "Na APS, longitudinalidade se refere ao vínculo e ao acompanhamento ao longo do tempo.",
      "ITEM 2",
      "A RESPEITO DA POLÍTICA NACIONAL DE ATENÇÃO BÁSICA, JULGUE O SEGUINTE ITEM.",
      "A equipe de atenção básica deve atender aos princípios e às diretrizes propostas para a atenção básica.",
      "ITEM 3",
      "GABARITO: CERTO",
      "A respeito do acolhimento no sistema de saúde, julgue o próximo item.",
      "O acolhimento implica escuta qualificada e responsabilização pelo sofrimento ou necessidade de saúde do usuário."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, { questionFormat: "true_false" });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].options, [{ id: "c", text: "Certo" }, { id: "e", text: "Errado" }]);
  assert.equal(rows[0].suggested_answer, null);
  assert.equal(rows[1].source_question_number, 2);
  assert.match(rows[1].prompt, /A equipe de atenção básica/);
  assert.equal(rows[2].source_question_number, 3);
  assert.doesNotMatch(rows[2].prompt, /GABARITO/i);
});

test("manifesto preserva o formato certo/errado para a fila administrativa", () => {
  const questions = parseExamPages([{
    page: 1,
    text: [
      "ITEM 7",
      "JULGUE O ITEM A SEGUIR CONSIDERANDO OS PRINCÍPIOS DA ADMINISTRAÇÃO PÚBLICA.",
      "A administração pública deve obedecer aos princípios expressos no texto constitucional."
    ].join("\n")
  }], documentHash, { questionFormat: "true_false" });
  const manifest = buildImportManifest({ ...metadata, question_format: "true_false" }, documentHash, questions);
  assert.equal(manifest.metadata.question_format, "true_false");
  assert.equal(manifest.imports[0].question_format, "true_false");
  assert.deepEqual(manifest.imports[0].options.map(option => option.id), ["c", "e"]);
});




test("não confunde enunciado iniciado por 'A respeito' com alternativa A", () => {
  const pages = [{
    page: 4,
    text: [
      "QUESTÃO 10",
      "A respeito da regência verbal, analise as afirmações e assinale a opção correta.",
      "I O primeiro enunciado descreve uma situação hipotética.",
      "II O segundo enunciado apresenta uma consequência possível.",
      "III O terceiro enunciado delimita o contexto de aplicação.",
      "Assinale a opção correta.",
      "A Apenas a afirmação I está correta.",
      "B Apenas a afirmação II está correta.",
      "C Apenas as afirmações I e III estão corretas.",
      "D Todas as afirmações estão corretas."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash);
  assert.equal(rows.length, 1);
  assert.match(rows[0].prompt, /^A respeito da regência verbal/);
  assert.deepEqual(rows[0].options.map(option => option.id), ["a", "b", "c", "d"]);
  assert.match(rows[0].options[0].text, /^Apenas a afirmação I/);
});



test("parse o layout Cebraspe ANS com numeração simples e separa comandos entre blocos", () => {
  const pages = [{
    page: 1,
    text: [
      "A respeito da evolução dos sistemas de saúde no Brasil, julgue os itens a seguir.",
      "1 A Conferência da Organização Mundial da Saúde de Alma Ata, de 1978, é reconhecida como marco conceitual internacional importante para a definição de um modelo de atenção assistencial de saúde.",
      "2 Visto que o sistema de saúde brasileiro se desenvolveu ao longo do século XX com grande estímulo a entidades privadas, a implantação do SUS ocorreu concomitantemente com a forte presença daqueles prestadores.",
      "3 A criação do SUS e a universalização da cobertura de saúde resultaram em imediata e importante melhoria dos serviços.",
      "4 Dados de 2024 demonstram que há predominância, no Brasil, de planos de assistência médica hospitalar e ambulatorial por meio de contrato coletivo.",
      "Acerca da regulação econômica, pelo Estado, das operadoras de planos privados de assistência à saúde, julgue os itens que se seguem.",
      "5 Do ponto de vista histórico, o Plano Diretor da Reforma do Aparelho do Estado, de 1995, implantou as desestatizações de diversos setores.",
      "6 Caso a rede hospitalar do SUS em determinado município se encontre sem vagas para a realização de hemodiálise, esse município poderá realizar convênio com instituição privada."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, { questionFormat: "true_false" });
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0].options, [{ id: "c", text: "Certo" }, { id: "e", text: "Errado" }]);
  assert.equal(rows[0].suggested_answer, null);
  assert.match(rows[0].prompt, /^A respeito da evolução/);
  assert.doesNotMatch(rows[3].prompt, /Acerca da regulação econômica/);
  assert.match(rows[4].prompt, /^Acerca da regulação econômica/);
  assert.equal(rows[5].source_question_number, 6);
});

test("deduplica questão repetida no mesmo PDF pelo fingerprint e número", () => {
  const duplicated = [
    samplePages[0],
    { page: 4, text: samplePages[0].text }
  ];
  const rows = parseExamPages(duplicated, documentHash);
  assert.equal(rows.length, 2);
});

test("manifesto aceita publicação oficial comprovada sem exigir licença individual", () => {
  const questions = parseExamPages(samplePages, documentHash);
  const manifest = buildImportManifest(metadata, documentHash, questions);
  assert.equal(manifest.metadata.rights_basis, "official_publication");
  assert.equal(manifest.metadata.license_proof_url, null);
  assert.equal(manifest.rights_review_status, "not_reviewed");
  assert.equal(manifest.publication_status, "pending_admin_review");
  assert.ok(manifest.imports.every((item) => item.status === "pending"));
});

test("recusa fundamento de ato oficial sem confirmação de publicação na fonte oficial", () => {
  assert.throws(() => buildImportManifest({
    ...metadata,
    official_release_verified: false
  }, documentHash, []), /official_release_verified=true/);
});

test("recusa URLs com HTTP, credenciais ou esquema inválido", () => {
  assert.throws(() => buildImportManifest({
    ...metadata,
    source_url: "http://www.cebraspe.org.br/prova"
  }, documentHash, []), /HTTPS/);
  assert.throws(() => buildImportManifest({
    ...metadata,
    exam_pdf_url: "https://user:password@cdn.cebraspe.org.br/prova.pdf"
  }, documentHash, []), /HTTPS/);
});

test("recusa URLs de agregadores e domínios fora da lista de fontes oficiais", () => {
  assert.throws(() => buildImportManifest({
    ...metadata,
    source_url: "https://www.pciconcursos.com.br/provas/"
  }, documentHash, []), /domínio oficial/);
});

test("exige hash SHA-256 válido no manifesto", () => {
  assert.throws(() => buildImportManifest(metadata, "bad-hash", []), /SHA-256|64/);
});
