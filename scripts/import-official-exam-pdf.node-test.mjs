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
  official_release_verified: true
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
