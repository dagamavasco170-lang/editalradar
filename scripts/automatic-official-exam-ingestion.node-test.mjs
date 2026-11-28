import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAnswerKeyCoverage,
  compareQuestionNumberCoverage,
  enforceWholeBookletGate,
  classifyOfficialPdfLink,
  extractOfficialPdfLinks,
  extractOfficialSubpageLinks,
  fetchOfficialResource,
  decodeHtmlEntities,
  isPublicIpAddress,
  pairExamWithAnswerKey,
  parseOfficialAnswerKey,
  parseOfficialAnswerKeyVariants,
  selectAnswerKeySection,
  validateQuestionForAutoPublication,
  canPromoteStagedImport,
  isApprovedForQuestionReuse,
  isSourceEligibleForMode,
  variantIdentity
} from "./automatic-official-exam-ingestion.mjs";


test("decodes HTML entities once, without recursive ampersand decoding", () => {
  assert.equal(decodeHtmlEntities("&amp;#x2e; &amp;amp; &#x2e; &gt;"), "&#x2e; &amp; . >");
});

test("classifies only public IPv4 and global-unicast IPv6 as routable", () => {
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1",
    "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "2002::1"
  ]) assert.equal(isPublicIpAddress(address), false, address);
});

test("pins each official redirect hop to a freshly validated public DNS address", async () => {
  const resolvedHosts = [];
  const requests = [];
  const response = await fetchOfficialResource(
    "https://cdn.cebraspe.org.br/prova.pdf",
    {
      lookupImpl: async hostname => {
        resolvedHosts.push(hostname);
        return [{ address: hostname.startsWith("cdn.") ? "93.184.216.34" : "93.184.216.35", family: 4 }];
      },
      requestImpl: async (url, options) => {
        requests.push({ url, address: options.address, family: options.family });
        if (url.endsWith("/prova.pdf")) {
          return { statusCode: 302, headers: { location: "https://www.cebraspe.org.br/arquivo.pdf" }, bytes: Buffer.alloc(0) };
        }
        return {
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          bytes: Buffer.from("%PDF-1.7\\nfixture")
        };
      }
    }
  );
  assert.equal(response.isPdf, true);
  assert.equal(response.url, "https://www.cebraspe.org.br/arquivo.pdf");
  assert.deepEqual(resolvedHosts, ["cdn.cebraspe.org.br", "www.cebraspe.org.br"]);
  assert.deepEqual(requests.map(item => item.address), ["93.184.216.34", "93.184.216.35"]);
});

test("retries transient 504 responses up to three attempts before accepting an official PDF", async () => {
  let requests = 0;
  const response = await fetchOfficialResource(
    "https://cdn.cebraspe.org.br/prova.pdf",
    {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: async () => {
        requests += 1;
        if (requests < 3) {
          return {
            statusCode: 504,
            headers: { "content-type": "text/plain" },
            bytes: Buffer.from("upstream gateway timeout")
          };
        }
        return {
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          bytes: Buffer.from("%PDF-1.7\\nfixture")
        };
      }
    }
  );
  assert.equal(requests, 3);
  assert.equal(response.isPdf, true);
});

test("blocks an official hostname when any DNS answer is private or reserved", async () => {
  let requested = false;
  await assert.rejects(
    fetchOfficialResource("https://cdn.cebraspe.org.br/prova.pdf", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ],
      requestImpl: async () => {
        requested = true;
        throw new Error("A conexão não deveria acontecer.");
      }
    }),
    /SSRF_BLOCKED/
  );
  assert.equal(requested, false);
});

test("rejects a nonstandard HTTPS port even on an approved official host", async () => {
  await assert.rejects(
    fetchOfficialResource("https://cdn.cebraspe.org.br:8443/prova.pdf"),
    /URL inicial não é HTTPS/
  );
});

test("extractOfficialPdfLinks keeps only HTTPS links on approved official hosts", () => {
  const html = `
    <a href="/arquivos/caderno-prova.pdf">Caderno de prova</a>
    <a href="https://evil.example/prova.pdf">Prova externa</a>
    <a href="http://cdn.cebraspe.org.br/prova.pdf">HTTP inseguro</a>
    <a href="https://cdn.cebraspe.org.br/arquivos/gabarito-definitivo.pdf">Gabarito definitivo</a>\n    <a href="https://cdn.cebraspe.org.br/concursos/TREGO08_Gab_Definitivo_001_1.PDF">Arquivo</a>\n    <a href="https://cdn.cebraspe.org.br/concursos/abc123456789.pdf">Arquivo 123</a>
  `;
  const links = extractOfficialPdfLinks(html, "https://www.cebraspe.org.br/concursos/exemplo");
  assert.equal(links.length, 4);
  assert.ok(links.some(link => link.url === "https://www.cebraspe.org.br/arquivos/caderno-prova.pdf"));
  assert.ok(links.some(link => link.url.includes("gabarito-definitivo.pdf")));
  assert.ok(links.some(link => link.url.includes("Gab_Definitivo")));
  assert.ok(links.some(link => link.url.includes("abc123456789.pdf")));
});

test("discovers only official intermediate pages for exams and answer keys", () => {
  const html = `
    <a href="/concursos/sesau_al_26/provas">Provas e gabaritos</a>
    <a href="/concursos/sesau_al_26/edital">Edital</a>
    <a href="/concursos/sesau_al_26/inscricoes">Inscrições e provas</a>
    <a href="https://evil.example/provas">Provas em outro site</a>
    <a href="/concursos/sesau_al_26/gabarito.pdf">Gabarito PDF</a>
  `;
  const links = extractOfficialSubpageLinks(html, "https://www.cebraspe.org.br/concursos/sesau_al_26");
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://www.cebraspe.org.br/concursos/sesau_al_26/provas");
});
test("classifies prova, cadernos FGV, definitive and preliminary answer keys", () => {
  assert.equal(classifyOfficialPdfLink({ label: "Caderno de prova", url: "https://cdn.cebraspe.org.br/prova.pdf" }), "exam_pdf");
  assert.equal(classifyOfficialPdfLink({ label: "Tipo 1", url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-tipo-1.pdf" }, "Prova objetiva e cadernos de prova do concurso"), "exam_pdf");
  assert.equal(classifyOfficialPdfLink({ label: "Tipo 2", url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-tipo-2.pdf" }, "Prova objetiva e cadernos de prova do concurso"), "exam_pdf");
  assert.equal(classifyOfficialPdfLink({ label: "Gabarito definitivo", url: "https://cdn.cebraspe.org.br/gab_def.pdf" }), "definitive_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "Gabarito Oficial Definitivo da Prova Objetiva", url: "https://conhecimento.fgv.br/sites/default/files/concursos/gabaritos-definitivos-v3.pdf" }, "A etapa de gabarito preliminar já foi publicada"), "definitive_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "TREGO08_Gab_Definitivo_001_1.PDF", url: "https://cdn.cebraspe.org.br/TREGO08_Gab_Definitivo_001_1.PDF" }), "definitive_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "Gabarito preliminar", url: "https://cdn.cebraspe.org.br/gab_preliminar.pdf" }), "preliminary_answer_key");
  assert.equal(classifyOfficialPdfLink({ label: "Resultado Preliminar da Prova Objetiva", url: "https://cdn.cebraspe.org.br/resultado.pdf" }, "Prova objetiva"), "other");
  assert.equal(classifyOfficialPdfLink({ label: "Edital", url: "https://cdn.cebraspe.org.br/edital.pdf" }), "other");
});

test("extracts a booklet variant from caderno and answer-key labels", () => {
  assert.equal(variantIdentity("Caderno tipo A"), "a");
  assert.equal(variantIdentity("Prova tipo B"), "b");
  assert.equal(variantIdentity("Gabarito tipo A definitivo"), "a");
  assert.equal(variantIdentity("TREGO08_Gab_Definitivo_001_1.PDF"), "");
});

test("one consolidated official answer key is only a candidate until its section is matched", () => {
  const answerKey = {
    label: "Gabarito Oficial Definitivo",
    url: "https://conhecimento.fgv.br/sites/default/files/concursos/gabaritos-definitivos-v3.pdf"
  };
  const examA = { label: "Tipo 1", url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-1.pdf" };
  const examB = { label: "Tipo 2", url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-2.pdf" };
  assert.equal(pairExamWithAnswerKey(examA, [answerKey], 15).requiresSectionMatch, true);
  assert.equal(pairExamWithAnswerKey(examB, [answerKey], 15).requiresSectionMatch, true);
  assert.equal(pairExamWithAnswerKey(examA, [{ label: "Gabarito tipo 2 definitivo", url: "https://cdn.cebraspe.org.br/gabarito-tipo-2-definitivo.pdf" }], 2), null);
  assert.equal(pairExamWithAnswerKey(examA, [{ label: "Gabarito tipo 1 definitivo", url: "https://cdn.cebraspe.org.br/gabarito-tipo-1-definitivo.pdf" }], 2).label, "Gabarito tipo 1 definitivo");
});

test("parses consolidated final keys by role and booklet, including annulled items", () => {
  const text = `
GABARITOS DEFINITIVOS — POLÍCIA CIVIL DO ESTADO DO PARANÁ
Agente de Polícia Judiciária - 1 - Turno Tarde
1
D
2
B
3
*
Agente de Polícia Judiciária - 2 - Turno Tarde
1
E
2
A
3
C
Delegado de Polícia - 1 - Turno Tarde
1
A
2
C
3
D
Papiloscopista Policial - 1 - Turno Tarde
1
B
2
D
3
A
`;
  const sections = parseOfficialAnswerKeyVariants(text);
  assert.equal(sections.length, 4);
  assert.equal(sections[0].answers.get(1), "D");
  assert.equal(sections[0].answers.get(2), "B");
  assert.equal(sections[0].answers.get(3), "ANULADA");
  assert.equal(sections[1].answers.get(1), "E");
  assert.equal(sections[2].answers.get(2), "C");

  const record = {
    role_name: "Delegado de Polícia, Agente de Polícia Judiciária e Papiloscopista Policial",
    exam_name: "Polícia Civil do Estado do Paraná"
  };
  const agentType1 = {
    label: "Tipo 1",
    url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-1.pdf"
  };
  const agentType2 = {
    label: "Tipo 2",
    url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-agente-de-policia-judiciaria-cns201-tipo-2.pdf"
  };
  const delegateType1 = {
    label: "Tipo 1",
    url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns101-delegado-de-policia-cns101-tipo-1.pdf"
  };
  assert.equal(selectAnswerKeySection(agentType1, record, sections)?.bookletNumber, "1");
  assert.equal(selectAnswerKeySection(agentType2, record, sections)?.answers.get(1), "E");
  assert.equal(selectAnswerKeySection(delegateType1, record, sections)?.role, "Delegado de Polícia");
  const papiloscopistaType1 = {
    label: "Tipo 1",
    url: "https://conhecimento.fgv.br/sites/default/files/concursos/cns201-papiloscopista-policial-cns201-tipo-1.pdf"
  };
  assert.equal(selectAnswerKeySection(papiloscopistaType1, record, sections)?.role, "Papiloscopista Policial");
  assert.equal(selectAnswerKeySection({ label: "Tipo 4", url: "https://conhecimento.fgv.br/cns201-agente-de-policia-judiciaria-tipo-4.pdf" }, record, sections), null);
});

test("recognizes wrapped and typographic section headings in consolidated answer keys", () => {
  const sections = parseOfficialAnswerKeyVariants([
    "Agente de Polícia Judiciária – 1 – Turno Tarde",
    "1",
    "D",
    "2",
    "B",
    "Delegado de Polícia - 1 -",
    "Turno Tarde",
    "1",
    "C",
    "2",
    "A"
  ].join("\n"));
  assert.equal(sections.length, 2);
  assert.equal(sections[0].role, "Agente de Polícia Judiciária");
  assert.equal(sections[0].answers.get(1), "D");
  assert.equal(sections[1].role, "Delegado de Polícia");
  assert.equal(sections[1].answers.get(2), "A");
});

test("parses FGV answer-key tables with rows of question numbers and aligned answers", () => {
  const answerValues = ["D", "B", "C", "E", "A", "B", "D", "E", "C", "A", "D", "C", "E", "D", "B", "B", "C", "A", "C", "A"];
  answerValues[12] = "*";
  const text = [
    "Agente de Polícia Judiciária - 1 - Turno Tarde",
    "Página 1 de 7",
    Array.from({ length: 20 }, (_, index) => index + 1).join("   "),
    answerValues.join("   "),
    Array.from({ length: 20 }, (_, index) => index + 21).join("   "),
    Array.from({ length: 20 }, (_, index) => ["A", "B", "C", "D", "E"][index % 5]).join("   ")
  ].join("\n");
  const parsed = parseOfficialAnswerKey(text);
  assert.equal(parsed.parsedCount, 40);
  assert.equal(parsed.answers.get(1), "D");
  assert.equal(parsed.answers.get(13), "ANULADA");
  assert.equal(parsed.answers.get(20), "A");
  assert.equal(parsed.answers.get(40), "E");
});

test("keeps aligned FGV answer rows when OCR leaves non-token residue", () => {
  const numbers = Array.from({ length: 20 }, (_, i) => String(i + 1)).join("   ");
  const answers = Array.from({ length: 20 }, (_, i) => ["D", "B", "C", "E", "A"][i % 5]).join("   ");
  const parsed = parseOfficialAnswerKey(numbers + "  | OCR\n" + answers + "  | OCR");
  assert.equal(parsed.parsedCount, 20);
  assert.equal(parsed.answers.get(1), "D");
  assert.equal(parsed.answers.get(20), "A");
});

test("recovers FGV answer keys when PDF extraction puts each number and answer on separate lines", () => {
  const text = ["Agente de Polícia Judiciária - 1 - Turno Tarde", "Página 1 de 7", ...Array.from({ length: 20 }, (_, i) => [String(i + 1), i === 12 ? "*" : ["D","B","C","E","A"][i % 5]]).flat()].join("\n");
  const parsed = parseOfficialAnswerKey(text);
  assert.equal(parsed.parsedCount, 20);
  assert.equal(parsed.answers.get(1), "D");
  assert.equal(parsed.answers.get(13), "ANULADA");
  assert.equal(parsed.answers.get(20), "A");
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

test("auto-publication gate accepts a textual passage included after 'texto a seguir'", () => {
  const question = {
    prompt: "Leia o texto a seguir: A segurança pública exige integração entre instituições, transparência administrativa e atuação preventiva. O trecho descreve como a cooperação institucional contribui para proteger a sociedade e melhorar a prestação de serviços.",
    options: [
      { id: "a", text: "A cooperação institucional fortalece a prevenção e a proteção social." },
      { id: "b", text: "A atuação isolada elimina a necessidade de planejamento." },
      { id: "c", text: "A transparência impede a prestação de serviços públicos." },
      { id: "d", text: "A prevenção dispensa a integração entre instituições." }
    ],
    ocr_used: false,
    review_notes: "Extração automática estruturada."
  };
  const result = validateQuestionForAutoPublication(question, "a", "multiple_choice");
  assert.equal(result.approved, true);
});

test("auto-publication gate accepts OCR only when the caller confirms high confidence and spacing", () => {
  const question = {
    prompt: "O candidato deverá analisar a situação descrita e identificar, com fundamento na legislação aplicável, a providência administrativa adequada para a solução do caso concreto apresentado.",
    options: [
      { id: "a", text: "Adotar a providência prevista na norma aplicável ao caso concreto." },
      { id: "b", text: "Ignorar a legislação e decidir com base apenas na preferência pessoal." },
      { id: "c", text: "Delegar a decisão sem verificar a competência administrativa." },
      { id: "d", text: "Suspender automaticamente todos os atos do procedimento." }
    ],
    ocr_used: true,
    ocr_confidence: 96,
    review_notes: "Extração estruturada com OCR de alta confiança."
  };
  const result = validateQuestionForAutoPublication(question, "a", "multiple_choice", { ocrAllowed: question.ocr_confidence >= 92 });
  assert.equal(result.approved, true);
  assert.equal(result.checks.parserTextOnly, true);
  assert.equal(result.checks.textSpacingValid, true);
});

test("auto-publication gate blocks text with joined words even when options and key are valid", () => {
  const question = {
    prompt: "Oácidofosfórico(H3PO4)podeserobtido principalmente pormeio de dois processos industriais, sendo o processo úmido o mais utilizado no mundo. Ele consiste nareação darochafática (Ca3(PO4)2) moída com o ácido sulfúrico (H2SO4) concentrado. Como subproduto dessa reação exotérmica, forma-seo sulfato decálcio di-hidratado (CaSO4.2H2O) que, posteriormente, é separado por filtração.",
    options: [
      { id: "a", text: "Adotar a providência prevista na norma aplicável ao caso concreto." },
      { id: "b", text: "Ignorar a legislação e decidir com base apenas na preferência pessoal." },
      { id: "c", text: "Delegar a decisão sem verificar a competência administrativa." },
      { id: "d", text: "Suspender automaticamente todos os atos do procedimento." }
    ],
    ocr_used: false,
    review_notes: "Extração automática estruturada."
  };
  const result = validateQuestionForAutoPublication(question, "a", "multiple_choice");
  assert.equal(result.approved, false);
  assert.equal(result.checks.textSpacingValid, false);
  assert.ok(result.reasons.some(reason => reason.includes("espaçamento")));
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

test("whole-booklet gate remains strict by default", () => {
  assert.deepEqual(enforceWholeBookletGate([{ approved: true }, { approved: false }, { approved: true }]), { approved: false, total: 3, rejected: 1 });
  assert.deepEqual(enforceWholeBookletGate([{ approved: true }, { approved: true }]), { approved: true, total: 2, rejected: 0 });
});

test("allows only individually approved questions when exact booklet coverage is proven", () => {
  assert.deepEqual(
    enforceWholeBookletGate(
      [{ approved: true }, { approved: false }, { approved: true }],
      { allowValidatedSubset: true }
    ),
    { approved: true, total: 3, rejected: 1, eligible: 2, mode: "validated_subset" }
  );
  assert.deepEqual(
    enforceWholeBookletGate([{ approved: false }, { approved: false }], { allowValidatedSubset: true }),
    { approved: false, total: 2, rejected: 2 }
  );
});

test("requires an exact unique number set including annulled answer-key positions", () => {
  const answerMap = new Map([[1, "A"], [2, "ANULADA"], [3, "C"]]);
  assert.equal(compareQuestionNumberCoverage([
    { source_question_number: 1 },
    { source_question_number: 2 },
    { source_question_number: 3 }
  ], answerMap).complete, true);
  const missing = compareQuestionNumberCoverage([
    { source_question_number: 1 },
    { source_question_number: 3 }
  ], answerMap);
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missing, [2]);
  const duplicate = compareQuestionNumberCoverage([
    { source_question_number: 1 },
    { source_question_number: 2 },
    { source_question_number: 2 }
  ], answerMap);
  assert.equal(duplicate.complete, false);
  assert.deepEqual(duplicate.duplicates, [2]);
});


test("parses answer-key rows with extracted table pipe and bullet separators", () => {
  const parsed = parseOfficialAnswerKey("1 | D | 2 | B\n3 · C · 4 · E\n5 • A • 6 • ANULADA");
  assert.equal(parsed.conflicts.length, 0);
  assert.equal(parsed.parsedCount, 6);
  assert.equal(parsed.answers.get(1), "D");
  assert.equal(parsed.answers.get(2), "B");
  assert.equal(parsed.answers.get(3), "C");
  assert.equal(parsed.answers.get(4), "E");
  assert.equal(parsed.answers.get(5), "A");
  assert.equal(parsed.answers.get(6), "ANULADA");
});

test("recovers FGV aligned answer rows with annulled asterisks", () => {
  const text = [
    "Agente de Polícia Judiciária - 1 - turno manhã",
    "1    2    3    4    5    6   7    8    9    10 11 12 13 14 15               16   17   18   19   20",
    "D    B    C    E    A    B    D    E    C      A   D    C    E    D    B    B    C    A    C    A",
    "21   22   23   24   25   26   27   28   29    30   31   32   33   34   35   36   37   38   39   40",
    "D    E    C    E    B    D    C    B    A      E   A    C    D    E    D    C    D    B    B    E",
    "41   42   43   44   45   46   47   48   49    50   51   52   53   54   55   56   57   58   59   60",
    "B    D    E    D    C    A    A    C    *      D    E   B    E    D    B    D    D    B    A    E"
  ].join("\n");
  const sections = parseOfficialAnswerKeyVariants(text, "multiple_choice");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].parsedCount, 60);
  assert.equal(sections[0].answers.get(49), "ANULADA");
  assert.equal(sections[0].answers.get(48), "C");
});


test("official-publication sources are approved at source level without per-question permission", () => {
  const officialSource = {
    published: true,
    source_url: "https://conhecimento.fgv.br/concursos/teste",
    question_reuse_status: "approved",
    question_reuse_basis: "official_publication",
    question_reuse_proof_url: null,
    question_reuse_terms_url: null,
    question_reuse_reviewed_by: null,
    question_reuse_reviewed_at: null
  };
  assert.equal(isApprovedForQuestionReuse(officialSource), true);
  assert.equal(isApprovedForQuestionReuse({ ...officialSource, published: false }), false);
  assert.equal(isApprovedForQuestionReuse({ ...officialSource, source_url: "https://example.invalid/prova" }), false);
  assert.equal(isApprovedForQuestionReuse({ ...officialSource, question_reuse_status: "link_only" }), false);
});

test("licensed and permission-based sources still require source-level evidence and review", () => {
  const licensedSource = {
    published: true,
    source_url: "https://conhecimento.fgv.br/concursos/teste",
    question_reuse_status: "approved",
    question_reuse_basis: "cc_by",
    question_reuse_proof_url: "https://conhecimento.fgv.br/termos/licenca",
    question_reuse_terms_url: null,
    question_reuse_reviewed_by: "22222222-2222-2222-2222-222222222222",
    question_reuse_reviewed_at: "2026-11-28T00:00:00.000Z"
  };
  assert.equal(isApprovedForQuestionReuse(licensedSource), true);
  assert.equal(isApprovedForQuestionReuse({ ...licensedSource, question_reuse_reviewed_by: null }), false);
  assert.equal(isApprovedForQuestionReuse({ ...licensedSource, question_reuse_proof_url: null }), false);
});


test("link-only official sources are eligible for dry-run and private staging, not publication", () => {
  const source = {
    question_reuse_status: "link_only",
    question_reuse_basis: null,
    question_reuse_proof_url: null,
    question_reuse_terms_url: null,
    question_reuse_reviewed_by: null,
    question_reuse_reviewed_at: null
  };
  assert.equal(isSourceEligibleForMode(source, "dry-run"), true);
  assert.equal(isSourceEligibleForMode(source, "stage"), true);
  assert.equal(isSourceEligibleForMode(source, "publish"), false);
  assert.equal(isSourceEligibleForMode(source, "invalid"), false);
});


test("only promotes unreviewed pending official-publication imports", () => {
  const staged = {
    id: 42,
    status: "pending",
    rights_review_status: "not_reviewed",
    rights_basis: "official_publication",
    official_release_verified: true,
    published_question_id: null
  };
  assert.equal(canPromoteStagedImport(staged), true);
  assert.equal(canPromoteStagedImport({ ...staged, status: "published" }), false);
  assert.equal(canPromoteStagedImport({ ...staged, status: "rejected" }), false);
  assert.equal(canPromoteStagedImport({ ...staged, rights_review_status: "accepted" }), false);
  assert.equal(canPromoteStagedImport({ ...staged, rights_review_status: "rejected" }), false);
  assert.equal(canPromoteStagedImport({ ...staged, rights_basis: "permission_granted" }), false);
  assert.equal(canPromoteStagedImport({ ...staged, official_release_verified: false }), false);
  assert.equal(canPromoteStagedImport({ ...staged, published_question_id: 999 }), false);
  assert.equal(canPromoteStagedImport(null), false);
});
