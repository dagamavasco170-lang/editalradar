#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
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

export function measureTextSpacing(value) {
  const text = String(value ?? "").normalize("NFC");
  const words = text.match(/\\p{L}+/gu) || [];
  const letterCount = (text.match(/\\p{L}/gu) || []).length;
  const spaceCount = (text.match(/\\s/gu) || []).length;
  const lengths = words.map(word => [...word].length);
  const longWordCount = lengths.filter(length => length >= 18).length;
  const veryLongWordCount = lengths.filter(length => length >= 28).length;
  const averageWordLength = words.length ? letterCount / words.length : 0;
  const spaceRatio = letterCount ? spaceCount / letterCount : 0;
  const joinedWordMarkers = words.filter(word => {
    if ([...word].length < 10 || [...word].length >= 28) return false;
    return /^(?:que|ele|ela|foi|teria|uma|dos|das|para|com|por|sem)\\p{L}{4,}$/iu.test(word)
      || /\\p{L}{3,}(?:que|dos|das|por|com|sem|para|uma|de|do|da|em|na|no|as|os)\\p{L}{3,}/iu.test(word)
      || /\\p{L}{4,}(?:os|as|do|da|dos|das|que|com|por|sem)$/iu.test(word);
  }).length;
  return { letterCount, wordCount: words.length, spaceCount, spaceRatio, averageWordLength, longWordCount, veryLongWordCount, joinedWordMarkers };
}

export function scoreTextSpacingQuality(value) {
  const metrics = measureTextSpacing(value);
  if (metrics.letterCount < 40 || !metrics.wordCount) return 0;
  let score = 100;
  score -= Math.max(0, metrics.averageWordLength - 5.2) * 8;
  score -= Math.min(36, metrics.longWordCount * 1.8 + metrics.veryLongWordCount * 5);
  score -= Math.min(30, metrics.joinedWordMarkers * 2.5);
  if (metrics.spaceRatio < 0.13) score -= (0.13 - metrics.spaceRatio) * 320;
  if (metrics.spaceRatio > 0.25) score -= (metrics.spaceRatio - 0.25) * 180;
  return Math.max(0, Math.round(score * 10) / 10);
}

export function hasSuspiciousWordSpacing(value) {
  const metrics = measureTextSpacing(value);
  if (metrics.letterCount < 120 || metrics.wordCount < 8) return false;
  return metrics.veryLongWordCount >= 2
    || (metrics.veryLongWordCount >= 1 && metrics.joinedWordMarkers >= 2 && metrics.averageWordLength >= 5.4)
    || (metrics.longWordCount >= 4 && metrics.averageWordLength >= 5.4)
    || (metrics.joinedWordMarkers >= 3 && metrics.averageWordLength >= 5.4)
    || (metrics.joinedWordMarkers >= 2 && metrics.averageWordLength >= 5.8)
    || (metrics.averageWordLength >= 8.5 && metrics.spaceRatio < 0.18)
    || (metrics.spaceRatio < 0.095 && metrics.averageWordLength >= 5.5);
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

function hasFollowingBareOptionSequence(lines, startIndex, {
  questionFormat = "multiple_choice",
  allowNumberedMultipleChoice = true,
  allowBareOptions = true
} = {}) {
  let expected = "b";
  let matched = 0;
  const end = Math.min(lines.length, startIndex + MAX_BARE_QUESTION_LOOKAHEAD_LINES + 1);
  for (let index = startIndex + 1; index < end; index += 1) {
    const nextStart = parseQuestionStart(lines[index], questionFormat);
    if (nextStart && (allowNumberedMultipleChoice || nextStart.style !== "multiple_choice")) break;
    const option = parseOption(lines[index]) || (allowBareOptions ? parseBareOption(lines[index]) : null);
    if (!option || option.id !== expected) continue;
    matched += 1;
    expected = String.fromCharCode(expected.charCodeAt(0) + 1);
    if (matched >= 2) return true;
  }
  return false;
}

function hasQuestionOptionSequenceAfterNumber(lines, startIndex, options = {}) {
  const end = Math.min(lines.length, startIndex + MAX_BARE_QUESTION_LOOKAHEAD_LINES + 1);
  for (let index = startIndex + 1; index < end; index += 1) {
    const nextStart = parseQuestionStart(lines[index], options.questionFormat || "multiple_choice");
    if (nextStart && (options.allowNumberedMultipleChoice !== false || nextStart.style !== "multiple_choice")) break;
    const option = parseOption(lines[index]) || (options.allowBareOptions !== false ? parseBareOption(lines[index]) : null);
    if (option?.id === "a" && hasFollowingBareOptionSequence(lines, index, options)) return true;
  }
  return false;
}

export function parseExamPages(pages, documentSha256, {
  questionFormat = "multiple_choice",
  allowNumberedMultipleChoice = true,
  allowBareOptions = true,
  diagnostics = null
} = {}) {
  const parsed = [];
  const seenFingerprints = new Set();
  const seenQuestionNumbers = new Set();
  let current = null;
  let activeCommandLines = [];

  const addDiagnostic = entry => {
    if (Array.isArray(diagnostics)) diagnostics.push(entry);
  };

  const flush = () => {
    if (!current) return;
    const prompt = current.promptLines.join(" ").replace(/\s+/g, " ").trim();
    let options = current.options
      .map(item => ({ id: item.id, text: item.text.replace(/\s+/g, " ").trim() }))
      .filter(item => item.text.length >= 2);
    if (!options.length && questionFormat === "true_false" && current.kind === "true_false") {
      options = [{ id: "c", text: "Certo" }, { id: "e", text: "Errado" }];
    }

    const issues = [];
    const rejectionReasons = [];
    const spacingText = [prompt, ...options.map(item => item.text)].join(" ");
    const spacingMetrics = measureTextSpacing(spacingText);
    const suspiciousWordSpacing = hasSuspiciousWordSpacing(spacingText);
    if (suspiciousWordSpacing) {
      issues.push("Espaçamento entre palavras suspeito; OCR ou revisão visual necessária.");
      rejectionReasons.push("suspicious_word_spacing");
    }
    if (prompt.length < 20) {
      issues.push("Enunciado curto ou não identificado com segurança.");
      rejectionReasons.push("prompt_too_short");
    }
    if (prompt.length > 5000) {
      issues.push("Enunciado excede 5.000 caracteres.");
      rejectionReasons.push("prompt_too_long");
    }
    if (options.length < 2 || options.length > 6) {
      issues.push("Quantidade de alternativas fora do intervalo de 2 a 6.");
      rejectionReasons.push("option_count_out_of_range");
    }
    const uniqueOptionIds = new Set(options.map(item => item.id));
    if (uniqueOptionIds.size !== options.length) {
      issues.push("Identificadores de alternativas repetidos.");
      rejectionReasons.push("duplicate_option_ids");
    }

    const optionIds = options.map(item => item.id);
    const validMultipleChoiceIds = optionIds.every((id, index) => id === String.fromCharCode(97 + index));
    const validTrueFalseIds = current.kind === "true_false"
      && questionFormat === "true_false"
      && optionIds.join(",") === "c,e";
    if (!validMultipleChoiceIds && !validTrueFalseIds) {
      issues.push("Identificadores de alternativas não correspondem ao formato declarado.");
      rejectionReasons.push("invalid_option_sequence");
    }

    const hasVisualDependency = /(figura|imagem|gráfico|grafico|tabela|mapa|charge|tirinha|cartaz|cartum|fotografia|ilustra[cç][aã]o)/i.test(prompt);
    if (hasVisualDependency) {
      issues.push("Possível dependência de imagem, tabela, mapa ou texto externo; conferir o PDF visualmente.");
    }

    const structurallyEligible = prompt.length >= 20 && prompt.length <= 5000
      && options.length >= 2 && options.length <= 6
      && uniqueOptionIds.size === options.length
      && (validMultipleChoiceIds || validTrueFalseIds)
      && !suspiciousWordSpacing;

    const entry = {
      page: Number(current.page),
      questionNumber: Number(current.number),
      startStyle: current.startStyle,
      promptLength: prompt.length,
      optionCount: options.length,
      optionIds,
      spacingQuality: scoreTextSpacingQuality(spacingText),
      spacingMetrics,
      hasVisualDependency,
      ocrUsed: Boolean(current.ocrUsed),
      accepted: false,
      rejectionReasons
    };

    if (structurallyEligible) {
      const canonical = normalizeQuestionText(prompt + " " + options.map(item => item.id + " " + item.text).join(" "));
      const fingerprint = sha256(canonical);
      const sourceItemKey = current.page + ":" + current.number;
      if (seenFingerprints.has(fingerprint)) {
        entry.rejectionReasons.push("duplicate_fingerprint");
      } else if (seenQuestionNumbers.has(sourceItemKey)) {
        entry.rejectionReasons.push("duplicate_source_page_number");
      } else {
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
        entry.accepted = true;
      }
    }
    addDiagnostic(entry);
    current = null;
  };

  for (const page of pages) {
    const pageNumber = Number(page.page);
    if (current && page.ocrUsed) current.ocrUsed = true;
    const lines = String(page.text || "").replace(/\r/g, "").split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      let start = parseQuestionStart(line, questionFormat);

      if (start?.style === "multiple_choice" && !allowNumberedMultipleChoice) {
        addDiagnostic({
          page: pageNumber,
          questionNumber: Number(start.number),
          startStyle: start.style,
          accepted: false,
          rejectionReasons: ["numbered_marker_not_allowed_for_board"]
        });
        start = null;
      }

      if (start?.style === "bare_multiple_choice"
        && !hasQuestionOptionSequenceAfterNumber(lines, lineIndex, { questionFormat, allowNumberedMultipleChoice, allowBareOptions })) {
        addDiagnostic({
          page: pageNumber,
          questionNumber: Number(start.number),
          startStyle: start.style,
          accepted: false,
          rejectionReasons: ["no_following_option_sequence"]
        });
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
        if (current && current.promptLines.some(value => value.trim())) flush();
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
        const bareOption = allowBareOptions ? parseBareOption(line) : null;
        const expectedId = String.fromCharCode(97 + current.options.length);
        const firstBareSequence = current.options.length === 0
          && bareOption?.id === "a"
          && hasFollowingBareOptionSequence(lines, lineIndex, { questionFormat, allowNumberedMultipleChoice, allowBareOptions });
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

export async function extractPdfPages(pdfPath, questionFormat = "multiple_choice", { splitColumns = true, allowNumberedMultipleChoice = true, allowBareOptions = true } = {}) {
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

  // Compare both question coverage and textual integrity. A PDF extraction that
  // finds more question numbers but glues words together must not win.
  const layoutQuestions = parseExamPages(layoutPages, "0".repeat(64), { questionFormat, allowNumberedMultipleChoice, allowBareOptions });
  const averageQuestionSpacing = questions => {
    const scores = questions.map(question => scoreTextSpacingQuality(
      [question.prompt, ...(question.options || []).map(option => option.text)].join(" ")
    )).filter(score => score > 0);
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 10) / 10 : 0;
  };
  let pages = layoutPages;
  const extractionSelection = {
    mode: "layout",
    layoutScore: scoreQuestionExtraction(layoutQuestions),
    layoutTextQuality: averageQuestionSpacing(layoutQuestions),
    rawScore: null,
    rawTextQuality: null
  };
  try {
    const rawText = command("pdftotext", ["-raw", "-enc", "UTF-8", pdfPath, "-"]);
    const rawPageTexts = rawText.split("\f");
    while (rawPageTexts.length < pageCount) rawPageTexts.push("");
    const rawPages = rawPageTexts.slice(0, pageCount).map((text, index) => ({
      page: index + 1, text, extractionMode: "raw", columnsSplit: false
    }));
    const rawQuestions = parseExamPages(rawPages, "0".repeat(64), { questionFormat, allowNumberedMultipleChoice, allowBareOptions });
    const rawScore = scoreQuestionExtraction(rawQuestions);
    const rawTextQuality = averageQuestionSpacing(rawQuestions);
    extractionSelection.rawScore = rawScore;
    extractionSelection.rawTextQuality = rawTextQuality;
    if (rawScore > extractionSelection.layoutScore
      || (rawScore === extractionSelection.layoutScore && rawTextQuality > extractionSelection.layoutTextQuality + 1)) {
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
  const sparsePages = pages.filter(page => page.text.replace(/\\s/g, "").length < 40);
  const spacingDiagnostics = [];
  parseExamPages(pages, "0".repeat(64), {
    questionFormat, allowNumberedMultipleChoice, allowBareOptions, diagnostics: spacingDiagnostics
  });
  const spacingSuspectNumbers = new Set(spacingDiagnostics
    .filter(item => item.rejectionReasons?.includes("suspicious_word_spacing"))
    .map(item => Number(item.page)));
  const sparsePageNumbers = new Set(sparsePages.map(page => Number(page.page)));
  const ocrCandidates = pages.filter(page => sparsePageNumbers.has(Number(page.page)) || spacingSuspectNumbers.has(Number(page.page)));
  const selectedOcrPages = ocrCandidates.length <= MAX_OCR_PAGES
    ? ocrCandidates
    : Array.from({ length: MAX_OCR_PAGES }, (_, index) => ocrCandidates[
      Math.round(index * (ocrCandidates.length - 1) / (MAX_OCR_PAGES - 1))
    ]);
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
          command("pdftoppm", ["-f", String(page.page), "-l", String(page.page), "-r", "180", "-singlefile", "-png", pdfPath, prefix], { timeout: 16000 });
          const imagePath = prefix + ".png";
          if (!existsSync(imagePath)) continue;
          const ocrText = command("tesseract", [imagePath, "stdout", "-l", "por+eng", "--psm", "6"], { timeout: 10000 });
          const originalLength = page.text.trim().length;
          const ocrLength = ocrText.trim().length;
          const isSparse = sparsePageNumbers.has(Number(page.page));
          const originalQuality = scoreTextSpacingQuality(page.text);
          const ocrQuality = scoreTextSpacingQuality(ocrText);
          const ocrHasEnoughContent = ocrLength >= (isSparse ? Math.max(40, originalLength + 1) : Math.max(100, originalLength * 0.65));
          const improvesSpacing = ocrQuality >= originalQuality + 2;
          if (ocrHasEnoughContent && (isSparse || improvesSpacing)) {
            page.text = ocrText;
            page.ocrUsed = true;
            ocrCount += 1;
          }
        } catch {
          warnings.push("OCR indisponível ou falhou na página " + page.page + "; revisão visual necessária.");
        }
      }
      if (ocrCandidates.length > MAX_OCR_PAGES) {
        warnings.push("Limite de OCR aplicado: " + MAX_OCR_PAGES + " de " + ocrCandidates.length + " páginas sem texto suficiente ou com espaçamento suspeito foram processadas, com amostragem distribuída. Questões ainda suspeitas serão rejeitadas.");
      }
      if (ocrCount) warnings.push(String(ocrCount) + " página(s) receberam OCR em português/inglês a 180 DPI para recuperar texto ou espaços entre palavras.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return { pages, warnings, pageCount, extractionSelection };
}

export async function importPdfToManifest({ pdfPath, metadata }) {
  let inputHandle = null;
  let tempDir = null;
  try {
    // Open once and inspect the same descriptor; never stat and then reopen an
    // attacker-controlled path. The parser receives only a private immutable copy.
    const inputFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    inputHandle = await open(pdfPath, inputFlags);
    const stats = await inputHandle.stat();
    if (!stats.isFile() || stats.size < 8 || stats.size > MAX_PDF_BYTES) {
      throw new Error("PDF deve ser arquivo local entre 8 bytes e 25 MB.");
    }
    const header = await inputHandle.readFile();
    await inputHandle.close();
    inputHandle = null;
    if (header.length !== stats.size) {
      throw new Error("O PDF foi alterado durante a leitura; a importação foi interrompida.");
    }
    if (header.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("O arquivo informado não possui assinatura PDF válida.");
    }
    const documentSha256 = sha256(header);
    tempDir = await mkdtemp(path.join(os.tmpdir(), "editalradar-pdf-input-"));
    const safePdfPath = path.join(tempDir, "validated-input.pdf");
    const outputFlags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0);
    const safeHandle = await open(safePdfPath, outputFlags, 0o600);
    try {
      await safeHandle.writeFile(header);
      await safeHandle.sync();
    } finally {
      await safeHandle.close();
    }
  const isFgvBoard = /fgv/i.test(String(metadata.board || ""));
  const allowNumberedMultipleChoice = !isFgvBoard;
  const allowBareOptions = !isFgvBoard;
  const { pages, warnings, extractionSelection } = await extractPdfPages(
    safePdfPath,
    metadata.question_format || "multiple_choice",
    { allowNumberedMultipleChoice, allowBareOptions }
  );
  const questionParsingDiagnostics = [];
  const questions = parseExamPages(pages, documentSha256, {
    questionFormat: metadata.question_format || "multiple_choice",
    allowNumberedMultipleChoice,
    allowBareOptions,
    diagnostics: questionParsingDiagnostics
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
          acceptedByParser: (allowNumberedMultipleChoice || candidate.style !== "multiple_choice")
            && (candidate.style !== "bare_multiple_choice"
              || hasQuestionOptionSequenceAfterNumber(lines, index, {
                questionFormat: metadata.question_format || "multiple_choice",
                allowNumberedMultipleChoice,
                allowBareOptions
              }))
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
        count + (parseOption(line) || (allowBareOptions && parseBareOption(line)) ? 1 : 0), 0)
    };
  });
  manifest.extractionSelection = extractionSelection;
  manifest.questionParsingDiagnostics = questionParsingDiagnostics;
  return manifest;
  } finally {
    if (inputHandle) await inputHandle.close().catch(() => {});
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
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
