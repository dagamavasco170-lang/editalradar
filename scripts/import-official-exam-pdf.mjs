#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedOfficialUrl } from "../src/lib/official-sources.js";

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const MAX_OCR_PAGES = 60;
export const MAX_BARE_QUESTION_LOOKAHEAD_LINES = 180;
const RIGHTS_BASES = new Set([
  "official_publication", "public_domain", "permission_granted", "cc_by", "cc_by_sa", "other_reviewed"
]);

export function normalizeQuestionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function selectPdfOcrPages(pages = [], maxPages = MAX_OCR_PAGES) {
  const candidates = (Array.isArray(pages) ? pages : [])
    .filter(page => String(page?.text || "").replace(/\s/g, "").length < 40);
  const limit = Math.max(1, Math.min(MAX_PDF_PAGES, Number(maxPages) || MAX_OCR_PAGES));
  if (candidates.length <= limit) return candidates;
  if (limit === 1) return [candidates[0]];
  const indices = new Set(Array.from({ length: limit }, (_, index) =>
    Math.round(index * (candidates.length - 1) / (limit - 1))
  ));
  return [...indices].sort((a,b)=>a-b).map(index=>candidates[index]);
}

function parseQuestionStart(line, questionFormat = "multiple_choice") {
  const item = String(line).match(/^\s*ITEM\s+0*(\d{1,3})\s*[:.)-]?\s*(.*)$/iu);
  if (item) return { number: Number(item[1]), rest: item[2] || "", kind: "true_false", style: "item_marker" };
  const labelled = String(line).match(/^\s*QUEST(?:Ã|A)O(?:\s+N[º°.]?)?\s*0*(\d{1,3})\s*[:.)-]?\s*(.*)$/iu);
  if (labelled) return { number: Number(labelled[1]), rest: labelled[2] || "", kind: "multiple_choice" };
  const numbered = String(line).match(/^\s*0*(\d{1,3})\s*[.)-]\s*(.*)$/u);
  if (numbered) {
    return {
      number: Number(numbered[1]),
      rest: numbered[2] || "",
      kind: questionFormat === "true_false" ? "true_false" : "multiple_choice",
      style: questionFormat === "true_false" ? "numbered_item" : "multiple_choice"
    };
  }
  if (questionFormat === "true_false") {
    const bareItem = String(line).match(/^\s*0*(\d{1,3})(?:\s+(.*\S))?\s*$/u);
    if (bareItem) return { number: Number(bareItem[1]), rest: bareItem[2] || "", kind: "true_false", style: "numbered_item" };
  } else {
    // FGV e outras bancas imprimem o número isolado em uma linha e iniciam
    // o enunciado somente na linha seguinte. A validação contextual abaixo
    // exige uma sequência real de alternativas A/B/C antes de aceitar o número.
    const bareNumber = String(line).match(/^\s*0*(\d{1,3})\s*$/u);
    if (bareNumber) return {
      number: Number(bareNumber[1]),
      rest: "",
      kind: "multiple_choice",
      style: "bare_multiple_choice"
    };
  }
  return null;
}

function isTrueFalseCommandLine(line) {
  return /^\s*(?:a respeito|no que se refere|acerca de|acerca da|acerca do|em relação|em relacao|com relação|com relacao|considerando|julgue|no tocante|quanto a|no âmbito|no ambito|a propósito|a proposito|relativamente|com base|de acordo com|à luz|a luz|diante de)\b/i.test(String(line || ""));
}


export function splitPdfColumns(pageText, questionFormat = "multiple_choice") {
  const lines = String(pageText || "").replace(/\r/g, "").split("\n");
  const positions = [];
  for (const line of lines) {
    const match = line.match(/^(.*?\S)( {4,})(\S.*)$/);
    if (match) positions.push(match[1].length + match[2].length);
  }
  if (positions.length < 4) return { text: String(pageText || ""), split: false };

  const sorted = [...positions].sort((a, b) => a - b);
  const boundary = sorted[Math.floor(sorted.length / 2)];
  if (!Number.isFinite(boundary) || boundary < 12) return { text: String(pageText || ""), split: false };

  const left = [];
  const right = [];
  let splitRows = 0;
  for (const line of lines) {
    const leftPart = line.slice(0, boundary);
    const rightPart = line.slice(boundary);
    const hasLeft = Boolean(leftPart.trim());
    const hasRight = Boolean(rightPart.trim());
    const gapAtBoundary = /\s{2,}$/.test(leftPart);

    if (hasRight && (!hasLeft || gapAtBoundary)) {
      left.push(leftPart.trimEnd());
      right.push(rightPart.trim());
      if (hasLeft) splitRows += 1;
    } else {
      left.push(line.trimEnd());
      right.push("");
    }
  }

  const leftHasItems = left.some(line => parseQuestionStart(line, questionFormat));
  const rightHasItems = right.some(line => parseQuestionStart(line, questionFormat));
  if (!leftHasItems || !rightHasItems || splitRows < 3) {
    return { text: String(pageText || ""), split: false };
  }

  return {
    text: left.join("\n") + "\n\n" + right.join("\n"),
    split: true
  };
}

function parseOption(line) {
  const match = String(line).match(/^\s*(?:\(([A-F])\)|([A-F])[\).:-])\s*(.*?)\s*$/iu);
  if (!match) return null;
  return { id: String(match[1] || match[2]).toLowerCase(), text: String(match[3] || "").trim() };
}

function parseBareOption(line) {
  const match = String(line).match(/^\s*([A-F])\s+(\S.*)$/u);
  if (!match || !/^[“"'‘«A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/u.test(match[2])) return null;
  return { id: match[1].toLowerCase(), text: match[2].trim() };
}

function hasFollowingBareOptionSequence(lines, startIndex) {
  let expected = "b";
  let matched = 0;
  const end = Math.min(lines.length, startIndex + MAX_BARE_QUESTION_LOOKAHEAD_LINES + 1);
  for (let index = startIndex + 1; index < end; index += 1) {
    if (parseQuestionStart(lines[index])) break;
    const option = parseOption(lines[index]) || parseBareOption(lines[index]);
    if (!option || option.id !== expected) continue;
    matched += 1;
    expected = String.fromCharCode(expected.charCodeAt(0) + 1);
    if (matched >= 2) return true;
  }
  return false;
}

function hasQuestionOptionSequenceAfterNumber(lines, startIndex) {
  const end = Math.min(lines.length, startIndex + MAX_BARE_QUESTION_LOOKAHEAD_LINES + 1);
  for (let index = startIndex + 1; index < end; index += 1) {
    if (parseQuestionStart(lines[index])) break;
    const option = parseOption(lines[index]) || parseBareOption(lines[index]);
    if (option?.id === "a" && hasFollowingBareOptionSequence(lines, index)) return true;
  }
  return false;
}

export function parseExamPages(pages, documentSha256, { questionFormat = "multiple_choice" } = {}) {
  const parsed = [];
  const seenFingerprints = new Set();
  const seenQuestionNumbers = new Set();
  let current = null;
  let activeCommandLines = [];

  const flush = () => {
    if (!current) return;
    const prompt = current.promptLines.join(" ").replace(/\s+/g, " ").trim();
    let options = current.options
      .map((item) => ({ id: item.id, text: item.text.replace(/\s+/g, " ").trim() }))
      .filter((item) => item.text.length >= 2);
    if (!options.length && questionFormat === "true_false" && current.kind === "true_false") {
      options = [{ id: "c", text: "Certo" }, { id: "e", text: "Errado" }];
    }
    const issues = [];
    if (prompt.length < 20) issues.push("Enunciado curto ou não identificado com segurança.");
    if (prompt.length > 5000) issues.push("Enunciado excede 5.000 caracteres.");
    if (options.length < 2 || options.length > 6) issues.push("Quantidade de alternativas fora do intervalo de 2 a 6.");
    if (new Set(options.map((item) => item.id)).size !== options.length) issues.push("Identificadores de alternativas repetidos.");
    const optionIds = options.map((item) => item.id);
    const validMultipleChoiceIds = optionIds.every((id, index) => id === String.fromCharCode(97 + index));
    const validTrueFalseIds = current.kind === "true_false"
      && questionFormat === "true_false"
      && optionIds.join(",") === "c,e";
    if (!validMultipleChoiceIds && !validTrueFalseIds) {
      issues.push("Identificadores de alternativas não correspondem ao formato declarado.");
    }
    if (/(figura|imagem|gráfico|grafico|tabela|mapa|charge|tirinha|cartaz|cartum|fotografia|ilustra[cç][aã]o|texto a seguir)/i.test(prompt)) {
      issues.push("Possível dependência de imagem, tabela, mapa ou texto externo; conferir o PDF visualmente.");
    }

    if (prompt.length >= 20 && prompt.length <= 5000 && options.length >= 2 && options.length <= 6
      && !issues.some((item) => item.includes("Identificadores") || item.includes("sequência contínua"))) {
      const canonical = normalizeQuestionText(prompt + " " + options.map((item) => item.id + " " + item.text).join(" "));
      const fingerprint = sha256(canonical);
      const sourceItemKey = current.page + ":" + current.number;
      if (!seenFingerprints.has(fingerprint) && !seenQuestionNumbers.has(sourceItemKey)) {
        parsed.push({
          source_page: current.page,
          source_question_number: current.number,
          prompt,
          options,
          suggested_answer: null,
          fingerprint,
          ocr_used: Boolean(current.ocrUsed),
          review_notes: issues.join(" ") || "Extração automática estruturada; gabarito deve corresponder à publicação definitiva."
        });
        seenFingerprints.add(fingerprint);
        seenQuestionNumbers.add(sourceItemKey);
      }
    }
    current = null;
  };

  for (const page of pages) {
    const pageNumber = Number(page.page);
    if (current && page.ocrUsed) current.ocrUsed = true;
    const lines = String(page.text || "").replace(/\r/g, "").split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      let start = parseQuestionStart(line, questionFormat);
      if (start?.style === "bare_multiple_choice"
        && !hasQuestionOptionSequenceAfterNumber(lines, lineIndex)) {
        start = null;
      }
      if (start && start.number > 0) {
        flush();
        current = {
          number: start.number,
          kind: start.kind,
          startStyle: start.style || "multiple_choice",
          page: pageNumber,
          ocrUsed: Boolean(page.ocrUsed),
          promptLines: questionFormat === "true_false" && start.style === "numbered_item"
            ? [...activeCommandLines]
            : [],
          options: []
        };
        if (start.style === "item_marker") activeCommandLines = [];
        if (start.rest.trim()) current.promptLines.push(start.rest.trim());
        continue;
      }
      if (questionFormat === "true_false"
        && current?.startStyle !== "item_marker"
        && isTrueFalseCommandLine(line)) {
        if (current && current.promptLines.some(value => value.trim())) {
          flush();
        }
        activeCommandLines = [String(line).trim()];
        continue;
      }
      if (!current) {
        if (questionFormat === "true_false" && isTrueFalseCommandLine(line)) {
          activeCommandLines = [String(line).trim()];
        }
        continue;
      }
      let option = parseOption(line);
      if (!option && current.kind !== "true_false") {
        const bareOption = parseBareOption(line);
        const expectedId = String.fromCharCode(97 + current.options.length);
        const firstBareSequence = current.options.length === 0
          && bareOption?.id === "a"
          && hasFollowingBareOptionSequence(lines, lineIndex);
        const nextBareOption = current.options.length > 0 && bareOption?.id === expectedId;
        if (firstBareSequence || nextBareOption) option = bareOption;
      }
      if (option) {
        current.options.push(option);
      } else if (current.options.length) {
        if (line.trim()) current.options[current.options.length - 1].text += " " + line.trim();
      } else if (line.trim() && !(current.kind === "true_false" && /^\s*GABARITO\s*:/i.test(line))) {
        current.promptLines.push(line.trim());
      }
    }
  }
  flush();
  return parsed;
}

function validateMetadata(metadata) {
  const required = ["board", "exam_name", "exam_year", "discipline", "source_url", "exam_pdf_url"];
  for (const field of required) {
    if (metadata?.[field] === undefined || String(metadata[field]).trim() === "") {
      throw new Error("Metadado obrigatório ausente: " + field);
    }
  }
  const year = Number(metadata.exam_year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("Ano da prova inválido.");
  }
  for (const field of ["source_url", "exam_pdf_url", "source_terms_url"]) {
    if (!metadata[field]) continue;
    let url;
    try { url = new URL(metadata[field]); } catch { throw new Error("URL inválida em " + field + "."); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error(field + " deve ser uma URL HTTPS sem credenciais.");
    }
    if ((field === "source_url" || field === "exam_pdf_url") && !isTrustedOfficialUrl(url.href)) {
      throw new Error(field + " precisa pertencer ao domínio oficial da banca/órgão ou a um provedor oficial autorizado.");
    }
  }
  const rightsBasis = String(metadata.rights_basis || "official_publication");
  if (!RIGHTS_BASES.has(rightsBasis)) throw new Error("Fundamento de reutilização não reconhecido.");
  const questionFormat = String(metadata.question_format || "multiple_choice");
  if (!["multiple_choice", "true_false"].includes(questionFormat)) {
    throw new Error("Formato de questão não reconhecido; use multiple_choice ou true_false.");
  }
  if (rightsBasis === "official_publication" && metadata.official_release_verified !== true) {
    throw new Error("Confirme official_release_verified=true somente após verificar a publicação no domínio oficial da banca/órgão.");
  }
  return { ...metadata, exam_year: year, rights_basis: rightsBasis, question_format: questionFormat };
}

export function buildImportManifest(metadata, documentSha256, questions, warnings = []) {
  if (!/^[0-9a-f]{64}$/.test(String(documentSha256 || ""))) {
    throw new Error("Hash SHA-256 do documento inválido.");
  }
  const verifiedMetadata = validateMetadata(metadata);
  return {
    format: "editalradar-exam-import-v1",
    generated_at: new Date().toISOString(),
    metadata: {
      board: String(verifiedMetadata.board).trim(),
      exam_name: String(verifiedMetadata.exam_name).trim(),
      exam_year: verifiedMetadata.exam_year,
      discipline: String(verifiedMetadata.discipline).trim(),
      topic: String(verifiedMetadata.topic || "A classificar").trim(),
      question_format: verifiedMetadata.question_format,
      role_name: String(verifiedMetadata.role_name || "").trim(),
      source_url: verifiedMetadata.source_url,
      exam_pdf_url: verifiedMetadata.exam_pdf_url,
      rights_basis: verifiedMetadata.rights_basis,
      rights_holder: verifiedMetadata.rights_holder || null,
      license_proof_url: verifiedMetadata.license_proof_url || null,
      source_terms_url: verifiedMetadata.source_terms_url || null,
      source_restrictions: verifiedMetadata.source_restrictions || "",
      source_license: verifiedMetadata.source_license || null,
      source_attribution: verifiedMetadata.source_attribution || null,
      official_release_verified: verifiedMetadata.official_release_verified === true
    },
    source_document_sha256: documentSha256,
    rights_review_status: "not_reviewed",
    publication_status: "pending_admin_review",
    warnings,
    imports: questions.map((question) => ({
      ...question,
      source_document_sha256: documentSha256,
      board: String(verifiedMetadata.board).trim(),
      exam_name: String(verifiedMetadata.exam_name).trim(),
      exam_year: verifiedMetadata.exam_year,
      discipline: String(verifiedMetadata.discipline).trim(),
      topic: String(verifiedMetadata.topic || "A classificar").trim(),
      question_format: verifiedMetadata.question_format,
      role_name: String(verifiedMetadata.role_name || "").trim(),
      source_url: verifiedMetadata.source_url,
      exam_pdf_url: verifiedMetadata.exam_pdf_url,
      rights_basis: verifiedMetadata.rights_basis,
      rights_review_status: "not_reviewed",
      status: "pending"
    }))
  };
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    encoding: options.encoding || "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 20000,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export function scoreQuestionExtraction(questions = []) {
  const numbers = (Array.isArray(questions) ? questions : [])
    .map(question => Number(question?.source_question_number))
    .filter(number => Number.isInteger(number) && number >= 1 && number <= 300);
  const uniqueNumbers = new Set(numbers);
  const duplicateCount = numbers.length - uniqueNumbers.size;
  // A new, distinct item is more informative than repeating an already-seen number.
  return uniqueNumbers.size * 1000 - duplicateCount * 100 + numbers.length;
}

export async function extractPdfPages(pdfPath, questionFormat = "multiple_choice", { splitColumns = true } = {}) {
  const info = command("pdfinfo", [pdfPath]);
  const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  if (!pageCount || pageCount > MAX_PDF_PAGES) {
    throw new Error("PDF sem paginação identificável ou acima do limite de " + MAX_PDF_PAGES + " páginas.");
  }
  const allText = command("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"]);
  const pageTexts = allText.split("\f");
  while (pageTexts.length < pageCount) pageTexts.push("");
  const columnWarnings = [];
  const layoutPages = pageTexts.slice(0, pageCount).map((text, index) => {
    const layout = splitColumns
      ? splitPdfColumns(text, questionFormat)
      : { text, split: false };
    if (layout.split) columnWarnings.push(index + 1);
    return { page: index + 1, text: layout.text, extractionMode: "layout", columnsSplit: layout.split };
  });

  // Compare Poppler's physical layout with its content-stream order. This can
  // recover independently flowing columns without relaxing question validation.
  let pages = layoutPages;
  const extractionSelection = {
    mode: "layout",
    layoutScore: scoreQuestionExtraction(parseExamPages(layoutPages, "0".repeat(64), { questionFormat })),
    rawScore: null
  };
  try {
    const rawText = command("pdftotext", ["-raw", "-enc", "UTF-8", pdfPath, "-"]);
    const rawPageTexts = rawText.split("\f");
    while (rawPageTexts.length < pageCount) rawPageTexts.push("");
    const rawPages = rawPageTexts.slice(0, pageCount).map((text, index) => ({
      page: index + 1, text, extractionMode: "raw", columnsSplit: false
    }));
    const rawScore = scoreQuestionExtraction(parseExamPages(rawPages, "0".repeat(64), { questionFormat }));
    extractionSelection.rawScore = rawScore;
    if (rawScore > extractionSelection.layoutScore) {
      pages = rawPages;
      extractionSelection.mode = "raw";
      columnWarnings.length = 0;
    }
  } catch {
    // -raw is optional; preserve -layout when unavailable.
  }
  for (const page of pages) {
    page.layoutScore = extractionSelection.layoutScore;
    page.rawScore = extractionSelection.rawScore;
  }
  const sparsePages = pages.filter((page) => page.text.replace(/\s/g, "").length < 40);
  const selectedOcrPages = selectPdfOcrPages(pages, MAX_OCR_PAGES);
  const warnings = columnWarnings.length
    ? ["Layout de duas colunas detectado e separado nas páginas: " + columnWarnings.join(", ") + ". Revise visualmente a ordem e o conteúdo."]
    : [];

  if (selectedOcrPages.length) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "editalradar-pdf-"));
    try {
      let ocrCount = 0;
      for (const page of selectedOcrPages) {
        const prefix = path.join(tempDir, "page-" + page.page);
        try {
          command("pdftoppm", ["-f", String(page.page), "-l", String(page.page), "-r", "120", "-singlefile", "-png", pdfPath, prefix], { timeout: 12000 });
          const imagePath = prefix + ".png";
          if (!existsSync(imagePath)) continue;
          const ocrText = command("tesseract", [imagePath, "stdout", "-l", "por+eng", "--psm", "6"], { timeout: 8000 });
          if (ocrText.trim().length > page.text.trim().length) {
            page.text = ocrText;
            page.ocrUsed = true;
            ocrCount += 1;
          }
        } catch {
          warnings.push("OCR indisponível ou falhou na página " + page.page + "; revisão visual necessária.");
        }
      }
      if (sparsePages.length > MAX_OCR_PAGES) {
        warnings.push("Limite de OCR aplicado: " + MAX_OCR_PAGES + " de " + sparsePages.length + " páginas sem camada textual foram processadas, com amostragem distribuída. Documento não deve ser considerado integralmente extraído.");
      }
      if (ocrCount) warnings.push(String(ocrCount) + " página(s) sem camada textual receberam OCR em português/inglês a 120 DPI.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return { pages, warnings, pageCount, extractionSelection };
}

export async function importPdfToManifest({ pdfPath, metadata }) {
  const stats = statSync(pdfPath);
  if (!stats.isFile() || stats.size < 8 || stats.size > MAX_PDF_BYTES) {
    throw new Error("PDF deve ser arquivo local entre 8 bytes e 25 MB.");
  }
  const header = await readFile(pdfPath);
  if (header.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("O arquivo informado não possui assinatura PDF válida.");
  }
  const documentSha256 = sha256(header);
  const { pages, warnings, extractionSelection } = await extractPdfPages(pdfPath, metadata.question_format || "multiple_choice");
  const questions = parseExamPages(pages, documentSha256, {
    questionFormat: metadata.question_format || "multiple_choice"
  });
  if (!questions.length) {
    throw new Error("Nenhuma questão objetiva foi identificada. Não foi gerado manifesto; revise o PDF ou faça importação assistida.");
  }
  if (warnings.some((warning) => warning.startsWith("Limite de OCR aplicado"))) {
    warnings.push("A extração está incompleta; valide todas as páginas antes de inserir os itens no banco.");
  }
  const manifest = buildImportManifest(metadata, documentSha256, questions, warnings);
  manifest.extractionDiagnostics = pages.map(page => {
    const lines = String(page.text || "").replace(/\r/g, "").split("\n");
    const starts = [];
    for (let index = 0; index < lines.length; index += 1) {
      const candidate = parseQuestionStart(lines[index], metadata.question_format || "multiple_choice");
      if (candidate && candidate.number > 0) {
        starts.push({
          line: index + 1,
          number: candidate.number,
          style: candidate.style || "multiple_choice",
          acceptedByParser: candidate.style !== "bare_multiple_choice"
            || hasQuestionOptionSequenceAfterNumber(lines, index)
        });
      }
    }
    return {
      page: Number(page.page),
      characters: String(page.text || "").length,
      ocrUsed: Boolean(page.ocrUsed),
      extractionMode: page.extractionMode || extractionSelection?.mode || "layout",
      columnsSplit: Boolean(page.columnsSplit),
      layoutScore: page.layoutScore ?? extractionSelection?.layoutScore ?? null,
      rawScore: page.rawScore ?? extractionSelection?.rawScore ?? null,
      questionStartCandidates: starts,
      optionLabelLines: lines.reduce((count, line) =>
        count + (parseOption(line) || parseBareOption(line) ? 1 : 0), 0)
    };
  });
  manifest.extractionSelection = extractionSelection;
  return manifest;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--pdf") result.pdfPath = argv[++index];
    else if (argv[index] === "--metadata") result.metadataPath = argv[++index];
    else if (argv[index] === "--out") result.outputPath = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") result.help = true;
    else throw new Error("Argumento desconhecido: " + argv[index]);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Uso: node scripts/import-official-exam-pdf.mjs --pdf prova.pdf --metadata prova.json [--out manifesto.json]");
    return;
  }
  if (!args.pdfPath || !args.metadataPath) {
    throw new Error("Informe --pdf e --metadata. Use --help para ver o formato.");
  }
  const metadata = JSON.parse(await readFile(args.metadataPath, "utf8"));
  const manifest = await importPdfToManifest({ pdfPath: args.pdfPath, metadata });
  const output = JSON.stringify(manifest, null, 2) + "\n";
  if (args.outputPath) {
    await writeFile(args.outputPath, output, { encoding: "utf8", flag: "wx" });
    console.log("Manifesto criado em " + args.outputPath + " com " + manifest.imports.length + " questão(ões) em revisão.");
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
