import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAnswerKeyCoverage,
  classifyOfficialPdfLink,
  extractOfficialPdfLinks,
  extractOfficialSubpageLinks,
  fetchOfficialResource,
  pairExamWithAnswerKey,
  parseOfficialAnswerKey,
  validateQuestionForAutoPublication,
  variantIdentity
} from "./automatic-official-exam-ingestion.mjs";

test("extractOfficialPdfLinks keeps only HTTPS links on approved official hosts", () => {
  const html = `
    <a href="/arquivos/caderno-prova.pdf">Caderno de prova</a>
    <a href="https://evil.example/prova.pdf">Prova externa</a>
    <a href="http://cdn.cebraspe.org.br/prova.pdf">HTTP inseguro</a>
    <a href="https://cdn.cebraspe.org.br/arquivos/gabarito-definitivo.pdf">Gabarito definitivo</a>\n    <a href="https://cdn.cebraspe.org.br/concursos/TREGO08_Gab_Definitivo_001_1.PDF">Arquivo</a>
  `;
  const links = extractOfficialPdfLinks(html, "https://www.cebraspe.org.br/concursos/exemplo");
  assert.equal(links.length, 3);
  assert.ok(links.some(link => link.url === "https://www.cebraspe.org.br/arquivos/caderno-prova.pdf"));
  assert.ok(links.some(link => link.url.includes("gabarito-definitivo.pdf")));
  assert.ok(links.some(link => link.url.includes("Gab_Definitivo")));
});

test("discovers only official intermediate pages for exams and answer keys", () => {
  const html = `
    <a href="/concursos/sesau_al_26/provas">Provas e gabaritos</a>
    <a href="/concursos/sesau_al_26/edital">Edital</a>
    <a href="https://evil.example/provas">Provas em outro site</a>
    <a href="/concursos/sesau_al_26/gabarito.pdf">Gabarito PDF</a>
  `;
  const links = extractOfficialSubpageLinks(html, "https://www.cebraspe.org.br/concursos/sesau_al_26");
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://www.cebraspe.org.br/concursos/sesau_al_26/provas");
});
test("classifies prova, gabarito definitivo and preliminary key separately", () => {
  assert.equal(classifyOfficialPdfLink({ label: "Caderno de prova", url: "https://cdn.cebraspe.org.br/prova.pdf" }), "exam_pdf");
  assert.equal(classifyOfficialPdfLink({ label: "Gabarito definitivo", url: "https://cdn.cebraspe.org.br/gab_def.pdf" }), "definitive_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "TREGO08_Gab_Definitivo_001_1.PDF", url: "https://cdn.cebraspe.org.br/TREGO08_Gab_Definitivo_001_1.PDF" }), "definitive_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "Gabarito preliminar", url: "https://cdn.cebraspe.org.br/gab_preliminar.pdf" }), "preliminary_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "Edital", url: "https://cdn.cebraspe.org.br/edital.pdf" }), "other");
});

test("extracts a booklet variant from caderno and answer-key labels", () => {
  assert.equal(variantIdentity("Caderno tipo A"), "a");
  assert.equal(variantIdentity("Prova tipo B"), "b");
  assert.equal(variantIdentity("Gabarito tipo A definitivo"), "a");
  assert.equal(variantIdentity("TREGO08_Gab_Definitivo_001_1.PDF"), "");
});

test("does not pair one unversioned answer key with multiple cadernos", () => {
  const answerKey = {
    label: "Gabarito definitivo",
    url: "https://cdn.cebraspe.org.br/gabarito-definitivo.pdf"
  };
  const examA = { label: "Caderno tipo A", url: "https://cdn.cebraspe.org.br/prova-tipo-a.pdf" };
  const examB = { label: "Caderno tipo B", url: "https://cdn.cebraspe.org.br/prova-tipo-b.pdf" };
  assert.equal(pairExamWithAnswerKey(examA, [answerKey], 2), null);
  assert.equal(pairExamWithAnswerKey(examB, [answerKey], 2), null);
  assert.equal(pairExamWithAnswerKey(examA, [{ label: "Gabarito tipo A definitivo", url: "https://cdn.cebraspe.org.br/gabarito-tipo-a-definitivo.pdf" }], 2).label, "Gabarito tipo A definitivo");
});

test("parses definitive multiple-choice answer keys with one or multiple entries per line", () => {
  const parsed = parseOfficialAnswerKey("GABARITO DEFINITIVO\n1 - A\n02 B 03 C\nQUESTÃO 4: D\n5 ANULADA");
  assert.equal(parsed.conflicts.length, 0);
  assert.equal(parsed.answers.get(1), "A");
  assert.equal(parsed.answers.get(2), "B");
  assert.equal(parsed.answers.get(3), "C");
  assert.equal(parsed.answers.get(4), "D");
  assert.equal(parsed.answers.get(5), "ANULADA");
});

test("parses Cebraspe Certo/Errado keys and rejects conflicting values", () => {
  const parsed = parseOfficialAnswerKey("1 C\n2 E\nITEM 3 C\n4 C\n4 E", "true_false");
  assert.equal(parsed.answers.get(1), "C");
  assert.equal(parsed.answers.get(2), "E");
  assert.equal(parsed.answers.get(3), "C");
  assert.deepEqual(parsed.conflicts, [4]);
  assert.equal(parsed.answers.has(4), false);
});


test("answer-key coverage compares the extracted caderno against all non-annulled key entries", () => {
  const answers = new Map([[1, "A"], [2, "B"], [3, "ANULADA"], [4, "D"]]);
  assert.equal(calculateAnswerKeyCoverage([
    { source_question_number: 1 },
    { source_question_number: 2 },
    { source_question_number: 4 }
  ], answers), 1);
  assert.equal(calculateAnswerKeyCoverage([
    { source_question_number: 1 },
    { source_question_number: 2 }
  ], answers), 2 / 3);
});

test("auto-publication gate accepts a complete text question with matching official answer", () => {
  const question = {
    prompt: "Segundo a Constituição Federal, a administração pública deve observar os princípios expressos no texto constitucional.",
    options: [
      { id: "a", text: "Legalidade, impessoalidade, moralidade, publicidade e eficiência." },
      { id: "b", text: "Legalidade, pessoalidade, moralidade, sigilo e eficiência." },
      { id: "c", text: "Autonomia, hierarquia, publicidade, sigilo e eficiência." },
      { id: "d", text: "Legalidade, moralidade, economicidade, sigilo e eficiência." }
    ],
    ocr_used: false,
    review_notes: "Extração automática estruturada."
  };
  const result = validateQuestionForAutoPublication(question, "a", "multiple_choice");
  assert.equal(result.approved, true);
  assert.equal(result.checks.completePrompt, true);
  assert.equal(result.checks.answerKeyMatches, true);
  assert.equal(result.checks.parserTextOnly, true);
});

test("auto-publication gate rejects OCR and visual dependencies", () => {
  const question = {
    prompt: "Com base na figura apresentada, assinale a alternativa correta sobre o comportamento do gráfico a seguir.",
    options: [
      { id: "a", text: "Primeira alternativa textual." },
      { id: "b", text: "Segunda alternativa textual." }
    ],
    ocr_used: true,
    review_notes: "OCR aplicado; possível dependência de imagem."
  };
  const result = validateQuestionForAutoPublication(question, "a", "multiple_choice");
  assert.equal(result.approved, false);
  assert.ok(result.reasons.some(reason => reason.includes("OCR")));
  assert.ok(result.reasons.some(reason => reason.includes("visual")));
});

test("official resource fetch blocks cross-domain redirects", async () => {
  const fetchImpl = async () => new Response("", {
    status: 302,
    headers: { location: "https://evil.example/steal.pdf" }
  });
  await assert.rejects(
    fetchOfficialResource("https://www.cebraspe.org.br/concursos/exemplo", { fetchImpl }),
    /Redirecionamento para destino não autorizado/
  );
});

test("official resource fetch verifies PDF signature and returns bounded bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7\nfixture");
  const fetchImpl = async () => new Response(pdf, {
    status: 200,
    headers: { "content-type": "application/pdf", "content-length": String(pdf.length) }
  });
  const result = await fetchOfficialResource("https://cdn.cebraspe.org.br/exemplo.pdf", { fetchImpl });
  assert.equal(result.isPdf, true);
  assert.equal(result.bytes.subarray(0, 5).toString("ascii"), "%PDF-");
});
