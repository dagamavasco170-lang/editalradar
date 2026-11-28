import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportManifest,
  normalizeQuestionText,
  hasSuspiciousWordSpacing,
  scoreTextSpacingQuality,
  parseTesseractTsv,
  parseExamPages,
  splitPdfColumns,
  sha256,
  scoreQuestionExtraction
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

test("prioriza a extração PDF com mais números de questão distintos", () => {
  const layoutQuestions = [
    { source_question_number: 1 },
    { source_question_number: 2 },
    { source_question_number: 2 }
  ];
  const rawQuestions = [
    { source_question_number: 1 },
    { source_question_number: 2 },
    { source_question_number: 3 }
  ];
  assert.ok(scoreQuestionExtraction(rawQuestions) > scoreQuestionExtraction(layoutQuestions));
});

test("detecta palavras coladas e mantém compostos legítimos", () => {
  const extracted = "Oácidofosfórico(H3PO4)podeserobtido principalmente pormeio de dois processos industriais, sendo o processo úmido o mais utilizado no mundo. Ele consiste nareação darochafática (Ca3(PO4)2) moída com o ácido sulfúrico (H2SO4) concentrado. Como subproduto dessa reação exotérmica, forma-seo sulfato decálcio di-hidratado (CaSO4.2H2O) que, posteriormente, é separado por filtração.";
  const corrected = "O ácido fosfórico (H₃PO₄) pode ser obtido principalmente por meio de dois processos industriais, sendo o processo úmido o mais utilizado no mundo. Ele consiste na reação da rocha fosfática (Ca₃(PO₄)₂) moída com o ácido sulfúrico (H₂SO₄) concentrado. Como subproduto dessa reação exotérmica, forma-se o sulfato de cálcio di-hidratado (CaSO₄·2H₂O), que posteriormente é separado por filtração.";
  assert.equal(hasSuspiciousWordSpacing(extracted), true);
  assert.equal(hasSuspiciousWordSpacing(corrected), false);
  assert.ok(scoreTextSpacingQuality(corrected) > scoreTextSpacingQuality(extracted));
  const legitimateCompound = "A palavra Donaudampfschifffahrselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft aparece como exemplo de composto alemão em um texto corretamente espaçado.";
  assert.equal(hasSuspiciousWordSpacing(legitimateCompound), false);
});

test("rejeita questão com palavras coladas e registra o motivo", () => {
  const diagnostics = [];
  const pages = [{
    page: 14,
    text: [
      "QUESTÃO 17",
      "Oácidofosfórico(H3PO4)podeserobtido principalmente pormeio de dois processos industriais, sendo o processo úmido o mais utilizado no mundo.",
      "(A) Primeira alternativa com texto suficientemente extenso para a validação da questão.",
      "(B) Segunda alternativa com texto suficientemente extenso para a validação da questão.",
      "(C) Terceira alternativa com texto suficientemente extenso para a validação da questão.",
      "(D) Quarta alternativa com texto suficientemente extenso para a validação da questão."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, { diagnostics });
  assert.equal(rows.length, 0);
  assert.ok(diagnostics.some(item => item.questionNumber === 17
    && item.rejectionReasons.includes("suspicious_word_spacing")));
});

test("interpreta confiança do OCR e reconstrói linhas a partir do TSV do Tesseract", () => {
  const tsv = [
    "level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext",
    "5\\t1\\t1\\t1\\t1\\t1\\t10\\t10\\t20\\t10\\t96.50\\tO",
    "5\\t1\\t1\\t1\\t1\\t2\\t35\\t10\\t20\\t10\\t94.50\\tácido",
    "5\\t1\\t1\\t1\\t1\\t3\\t60\\t10\\t20\\t10\\t92.00\\tfosfórico",
    "5\\t1\\t1\\t1\\t2\\t1\\t10\\t30\\t20\\t10\\t98.00\\tPode"
  ].join("\n");
  const parsed = parseTesseractTsv(tsv);
  assert.equal(parsed.text, "O ácido fosfórico\\nPode");
  assert.equal(parsed.words, 4);
  assert.equal(parsed.meanConfidence, 95.25);
});

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


test("FGV não confunde artigo A no início do enunciado com alternativa", () => {
  const pages = [{
    page: 6,
    text: [
      "7",
      "A Polícia Civil do Paraná atende crianças e adolescentes vítimas de crimes.",
      "O objetivo é que as vítimas sejam atendidas com profissionalismo e cuidado.",
      "(A) Primeira alternativa com conteúdo suficientemente extenso para validação.",
      "(B) Segunda alternativa com conteúdo suficientemente extenso para validação.",
      "(C) Terceira alternativa com conteúdo suficientemente extenso para validação.",
      "(D) Quarta alternativa com conteúdo suficientemente extenso para validação.",
      "(E) Quinta alternativa com conteúdo suficientemente extenso para validação."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, {
    allowNumberedMultipleChoice: false,
    allowBareOptions: false
  });
  assert.equal(rows.length, 1);
  assert.match(rows[0].prompt, /^A Polícia Civil do Paraná/);
  assert.deepEqual(rows[0].options.map(option => option.id), ["a", "b", "c", "d", "e"]);
});

test("FGV ignora numeração interna no formato número-ponto-texto", () => {
  const pages = [{
    page: 3,
    text: [
      "1",
      "Leia a descrição e assinale a alternativa que interpreta corretamente as informações apresentadas no texto.",
      "21. O número vinte e um aparece como referência interna no enunciado.",
      "A) Primeira alternativa com conteúdo textual suficientemente extenso.",
      "B) Segunda alternativa com conteúdo textual suficientemente extenso.",
      "C) Terceira alternativa com conteúdo textual suficientemente extenso.",
      "D) Quarta alternativa com conteúdo textual suficientemente extenso.",
      "2",
      "Analise o segundo enunciado e assinale a alternativa que apresenta a conclusão adequada.",
      "A) Primeira alternativa com conteúdo textual suficientemente extenso.",
      "B) Segunda alternativa com conteúdo textual suficientemente extenso.",
      "C) Terceira alternativa com conteúdo textual suficientemente extenso.",
      "D) Quarta alternativa com conteúdo textual suficientemente extenso."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, { allowNumberedMultipleChoice: false });
  assert.deepEqual(rows.map(row => row.source_question_number), [1, 2]);
});

test("registra o motivo estrutural de uma questão rejeitada", () => {
  const diagnostics = [];
  const rows = parseExamPages([{
    page: 8,
    text: [
      "7",
      "Curto.",
      "A) Primeira alternativa suficientemente identificável.",
      "B) Segunda alternativa suficientemente identificável.",
      "C) Terceira alternativa suficientemente identificável."
    ].join("\n")
  }], documentHash, { allowNumberedMultipleChoice: false, diagnostics });
  assert.equal(rows.length, 0);
  assert.ok(diagnostics.some(item =>
    item.questionNumber === 7 && item.rejectionReasons.includes("prompt_too_short")
  ));
});

test("não marca um trecho textual incluído no enunciado como dependência visual", () => {
  const rows = parseExamPages([{
    page: 10,
    text: [
      "QUESTÃO 22",
      "Leia o texto a seguir: A segurança pública exige integração entre instituições e transparência na atuação estatal.",
      "O texto destaca a importância da cooperação e da prevenção para a proteção da sociedade.",
      "(A) A integração institucional contribui para a prevenção e a proteção social.",
      "(B) A atuação isolada substitui a cooperação entre as instituições públicas.",
      "(C) A transparência impede a prestação de serviços de segurança pública.",
      "(D) A prevenção dispensa o planejamento das políticas públicas."
    ].join("\n")
  }], documentHash);
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].review_notes, /dependência de imagem|dependência visual/i);
});

test("reconhece questões FGV com o número isolado antes do enunciado", () => {
  const pages = [{
    page: 3,
    text: [
      "3",
      "CNS201 - AGENTE DE POLÍCIA JUDICIÁRIA – TARDE TIPO 1 – PÁGINA 4",
      "1",
      "Leia o texto a seguir e assinale a alternativa que apresenta a interpretação correta do trecho.",
      "A) Primeira alternativa com conteúdo textual suficientemente extenso.",
      "B) Segunda alternativa com conteúdo textual suficientemente extenso.",
      "C) Terceira alternativa com conteúdo textual suficientemente extenso.",
      "D) Quarta alternativa com conteúdo textual suficientemente extenso.",
      "E) Quinta alternativa com conteúdo textual suficientemente extenso.",
      "2",
      "Observe a seguir o cartaz de campanha e assinale a alternativa correta sobre os componentes verbais e visuais.",
      "A) Primeira alternativa com conteúdo textual suficientemente extenso.",
      "B) Segunda alternativa com conteúdo textual suficientemente extenso.",
      "C) Terceira alternativa com conteúdo textual suficientemente extenso.",
      "D) Quarta alternativa com conteúdo textual suficientemente extenso.",
      "E) Quinta alternativa com conteúdo textual suficientemente extenso."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.source_question_number), [1, 2]);
  assert.equal(rows[0].options.length, 5);
  assert.match(rows[1].review_notes, /dependência de imagem/);
});

test("reconhece questão FGV com enunciado longo antes das alternativas", () => {
  const longPrompt = Array.from({ length: 70 }, (_, index) =>
    "Trecho de enunciado longo número " + (index + 1) + " com conteúdo textual da questão."
  );
  const pages = [{
    page: 21,
    text: [
      "66",
      ...longPrompt,
      "(A) Primeira alternativa com conteúdo suficientemente extenso.",
      "(B) Segunda alternativa com conteúdo suficientemente extenso.",
      "(C) Terceira alternativa com conteúdo suficientemente extenso.",
      "(D) Quarta alternativa com conteúdo suficientemente extenso.",
      "(E) Quinta alternativa com conteúdo suficientemente extenso."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_question_number, 66);
  assert.equal(rows[0].options.length, 5);
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
  assert.match(rows[0].prompt, /NO QUE SE REFERE AOS FUNDAMENTOS/);
  assert.match(rows[0].prompt, /Na APS, longitudinalidade/);
  assert.equal(rows[1].source_question_number, 2);
  assert.match(rows[1].prompt, /A RESPEITO DA POLÍTICA NACIONAL/);
  assert.match(rows[1].prompt, /A equipe de atenção básica/);
  assert.equal(rows[2].source_question_number, 3);
  assert.match(rows[2].prompt, /A respeito do acolhimento/);
  assert.match(rows[2].prompt, /O acolhimento implica escuta qualificada/);
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



test("separa colunas de texto extraído com layout e mantém ordem das questões", () => {
  const layout = [
    "A respeito da evolução dos sistemas de saúde, julgue os itens.          Em relação à regulação econômica, julgue os itens.",
    "1 A primeira afirmação trata do sistema de saúde brasileiro.            9 A nona afirmação trata da regulação econômica.",
    "2 A segunda afirmação descreve o desenvolvimento do SUS.                10 A décima afirmação trata de planos de saúde.",
    "3 A terceira afirmação descreve a cobertura assistencial.                11 A décima primeira afirmação trata das operadoras.",
    "4 A quarta afirmação descreve a rede hospitalar pública.                  12 A décima segunda afirmação trata da fiscalização."
  ].join("\n");
  const separated = splitPdfColumns(layout, "true_false");
  assert.equal(separated.split, true);
  const rows = parseExamPages([{ page: 1, text: separated.text }], documentHash, { questionFormat: "true_false" });
  assert.deepEqual(rows.map(item => item.source_question_number), [1, 2, 3, 4, 9, 10, 11, 12]);
  assert.doesNotMatch(rows[3].prompt, /nona afirmação/);
  assert.match(rows[4].prompt, /nona afirmação/);
});




test("mantém itens Cebraspe numerados com ponto no formato Certo/Errado", () => {
  const pages = [{
    page: 6,
    text: [
      "1. A administração pública deve observar os princípios constitucionais expressos.",
      "2) A publicidade é princípio que admite exceções previstas no ordenamento jurídico."
    ].join("\n")
  }];
  const rows = parseExamPages(pages, documentHash, { questionFormat: "true_false" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.source_question_number), [1, 2]);
  assert.ok(rows.every(row => row.options.map(option => option.id).join(",") === "c,e"));
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
