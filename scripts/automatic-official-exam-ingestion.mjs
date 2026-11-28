#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";
import { isTrustedOfficialUrl } from "../src/lib/official-sources.js";
import { extractPdfPages, hasSuspiciousWordSpacing, importPdfToManifest, sha256 } from "./import-official-exam-pdf.mjs";

export const MAX_SOURCE_PAGES = 120;
export const MAX_DOCUMENTS_PER_RUN = 15;
export const MAX_SOURCE_SUBPAGES = 3;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const MIN_GABARITO_COVERAGE = 1.0;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const authHeaders = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
if (SERVICE_KEY && !SERVICE_KEY.startsWith("sb_secret_")) authHeaders.Authorization = "Bearer " + SERVICE_KEY;

export function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    nbsp: " ",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">"
  };
  // A substituição única impede decodificar novamente uma entidade produzida.
  return String(value || "").replace(/&(#x[a-f0-9]+|#[0-9]+|amp|nbsp|quot|apos|lt|gt);/gi, (entity, token) => {
    const normalized = String(token).toLowerCase();
    if (normalized in named) return named[normalized];
    const code = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number(normalized.slice(1));
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  });
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|section|article|main)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeDocumentLabel(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function safeOfficialUrl(value, base) {
  let url;
  try { url = base ? new URL(value, base) : new URL(value); } catch { return null; }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || !isTrustedOfficialUrl(url.href)
  ) return null;
  url.hash = "";
  return url.href;
}

export function extractOfficialPdfLinks(html, pageUrl) {
  const found = new Map();
  const source = String(html || "");
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = safeOfficialUrl(decodeHtmlEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]), pageUrl);
    if (!href) continue;
    const label = stripTags(match[2]).replace(/\s+/g, " ").trim().slice(0, 240);
    const signal = normalizeDocumentLabel(label + " " + href);
    const isPdf = /\.pdf(?:$|[?#])/i.test(href);
    const hasDocumentSignal = /\b(prova|caderno|gab(?:arito)?|respostas?|questoes|documentos?|arquivos?)\b/.test(signal);
    if (!isPdf && !hasDocumentSignal) continue;
    if (!found.has(href)) found.set(href, { url: href, label });
  }
  return [...found.values()];
}

export function extractOfficialSubpageLinks(html, pageUrl) {
  const found = new Map();
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const rawHref = decodeHtmlEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]);
    const url = safeOfficialUrl(rawHref, pageUrl);
    if (!url || /\.pdf(?:$|[?#])/i.test(url) || url === pageUrl) continue;
    const label = stripTags(match[2]).replace(/\s+/g, " ").trim().slice(0, 240);
    const normalizedLabel = normalizeDocumentLabel(label);
    const normalizedUrl = normalizeDocumentLabel(url);
    // Não seguir formulários de inscrição/recursos ou outras áreas operacionais,
    // mesmo que a URL do concurso contenha o termo "provas".
    if (/\b(inscricao|inscricoes|solicitacao|recurso|recursos|login|resultado|edital|home)\b/.test(normalizedUrl)) continue;
    if (!/\b(provas?|cadernos?|gabaritos?|respostas?|questoes|documentos?|arquivos?)\b/.test(normalizedLabel)) continue;
    if (!found.has(url)) found.set(url, { url, label });
  }
  return [...found.values()];
}

export function classifyOfficialPdfLink(link, pageText = "", notes = "") {
  const signal = normalizeDocumentLabel([link?.label, link?.url, pageText, notes].join(" "));
  const linkSignal = normalizeDocumentLabel([link?.label, link?.url].join(" "));
  const pageSignal = normalizeDocumentLabel(pageText);
  const isPdf = /\.pdf(?:$|[?#])/i.test(String(link?.url || ""));
  if (/\b(gab(?:arito)?|respostas?)\b/.test(linkSignal)) {
    if (/\b(preliminar|provisorio|rascunho)\b/.test(linkSignal)) return "preliminary_answer_key";
    return isDefinitiveAnswerKey(linkSignal, pageText, notes) ? "definitive_answer_key" : "unconfirmed_answer_key";
  }
  if (/\b(edital|convocacao|homologacao|resultado|retificacao|cronograma|comunicado|recurso|inscricao)\b/.test(linkSignal)) return "other";
  if (/\b(prova|caderno|questoes|questao objetiva)\b/.test(linkSignal)) return "exam_pdf";
  if (isPdf
    && /\btipo\s+[1-9][a-z]?\b/.test(linkSignal)
    && /\b(prova objetiva|caderno de prova|cadernos de prova|provas objetivas)\b/.test(pageSignal)) {
    return "exam_pdf";
  }
  if (/\b(prova|caderno)\b/.test(signal) && isPdf) return "exam_pdf";
  return "other";
}

export function isDefinitiveAnswerKey(linkSignal, pageText = "", notes = "") {
  const linkEvidence = normalizeDocumentLabel(linkSignal);
  const contextEvidence = normalizeDocumentLabel([pageText, notes].join(" "));
  const preliminary = /\b(preliminar|provisorio|rascunho)\b/;
  const definitive = /\b(definitivo|definitiva|final|pos recurso|apos recurso|resultado dos recursos)\b/;

  // O rótulo do próprio arquivo é a evidência mais específica. Notas genéricas
  // sobre etapas preliminares do concurso não anulam um PDF explicitamente final.
  if (preliminary.test(linkEvidence)) return false;
  if (definitive.test(linkEvidence)) return true;
  if (preliminary.test(contextEvidence) && definitive.test(contextEvidence)) return false;
  return definitive.test(contextEvidence) && !preliminary.test(contextEvidence);
}

function parseAnswerRows(text, questionFormat = "multiple_choice") {
  const answers = new Map();
  const conflicts = new Set();
  const allowed = questionFormat === "true_false"
    ? new Set(["C", "E", "ANULADA", "X"])
    : new Set(["A", "B", "C", "D", "E", "F", "ANULADA", "X"]);
  let pendingNumbers = [];

  const add = (numberValue, answerValue) => {
    const number = Number(numberValue);
    let answer = String(answerValue || "").toUpperCase();
    if (answer === "*") answer = "ANULADA";
    if (!Number.isInteger(number) || number < 1 || number > 300 || !allowed.has(answer)) return;
    const previous = answers.get(number);
    if (previous && previous !== answer) conflicts.add(number);
    else answers.set(number, answer === "X" ? "ANULADA" : answer);
  };

  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim()
      .replace(/^(?:gabarito(?:s)?(?:\s+definitivo(?:s)?)?\s*[:\-]?\s*)/i, "")
      .replace(/^(?:quest(?:a|ã)o|item)\s*/i, "")
      .replace(/\*/g, " ANULADA ");
    if (!line || line.length > 1200) {
      pendingNumbers = [];
      continue;
    }

    const tokens = (line.match(/\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi) || [])
      .map(token => token.toUpperCase());
    if (!tokens.length) continue;
    const isNumber = token => /^\d{1,3}$/.test(token);
    const isAnswer = token => allowed.has(token) || token === "X";
    const residue = line
      .replace(/\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi, "")
      .replace(/[^A-Za-z0-9]/g, "");

    // Only accept aligned rows when their residual text has no letters/numbers.
    if (pendingNumbers.length && tokens.every(isAnswer)
      && pendingNumbers.length === tokens.length) {
      pendingNumbers.forEach((number, index) => add(number, tokens[index]));
      pendingNumbers = [];
      continue;
    }
    // FGV tables may have OCR residue around a complete row of question numbers.
    // Preserve the row if its tokens are unambiguously all numbers; the answer
    // row can then be aligned even when text extraction adds stray characters.
    if (tokens.length >= 5 && tokens.every(isNumber)) {
      pendingNumbers = tokens;
      continue;
    }

    if (residue) {
      pendingNumbers = [];
      continue;
    }

    if (tokens.length >= 2 && tokens.length % 2 === 0
      && tokens.every((token, index) => index % 2 === 0 ? isNumber(token) : isAnswer(token))) {
      for (let index = 0; index < tokens.length; index += 2) add(tokens[index], tokens[index + 1]);
      pendingNumbers = [];
      continue;
    }

    if (tokens.every(isNumber)) {
      pendingNumbers = tokens;
      continue;
    }

    if (tokens.every(isAnswer) && pendingNumbers.length === tokens.length) {
      pendingNumbers.forEach((number, index) => add(number, tokens[index]));
      pendingNumbers = [];
      continue;
    }

    if (tokens.every(isAnswer) && pendingNumbers.length === 1 && tokens.length === 1) {
      add(pendingNumbers[0], tokens[0]);
      pendingNumbers = [];
      continue;
    }

    pendingNumbers = [];
  }

  // FGV extraction can split a compact table into isolated lines (number then answer).
  // Only single-token lines are paired, and page headers are explicitly ignored.
  if (answers.size < 5) {
    const streamAnswers = new Map();
    let pendingNumber = null;
    for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
      const line = rawLine.trim().replace(/\*/g, " ANULADA ").toUpperCase();
      if (!line || /\bP[AÁ]GINA\s+\d+\s+DE\s+\d+\b/.test(line)) { pendingNumber = null; continue; }
      const tokens = (line.match(/\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi) || []).map(token => token.toUpperCase());
      const residue = line.replace(/\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi, "").replace(/[^A-Za-z0-9]/g, "");
      if (residue || tokens.length !== 1) { pendingNumber = null; continue; }
      const token = tokens[0];
      if (/^\d{1,3}$/.test(token)) {
        const number = Number(token);
        pendingNumber = number >= 1 && number <= 300 ? number : null;
        continue;
      }
      const isStreamAnswer = token => allowed.has(token) || token === "X";
      if (pendingNumber !== null && isStreamAnswer(token)) {
        const previous = streamAnswers.get(pendingNumber);
        if (previous && previous !== token) streamAnswers.delete(pendingNumber);
        else streamAnswers.set(pendingNumber, token === "X" ? "ANULADA" : token);
      }
      pendingNumber = null;
    }
    if (streamAnswers.size > answers.size) {
      answers.clear();
      for (const [number, answer] of streamAnswers) answers.set(number, answer);
      conflicts.clear();
    }
  }

  for (const number of conflicts) answers.delete(number);
  return { answers, conflicts: [...conflicts], parsedCount: answers.size };
}

export function parseOfficialAnswerKey(text, questionFormat = "multiple_choice") {
  return parseAnswerRows(text, questionFormat);
}

export function parseOfficialAnswerKeyVariants(text, questionFormat = "multiple_choice") {
  const sections = [];
  let current = null;
  const normalizeHeadingLine = value => String(value || "")
    .normalize("NFC")
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const headingPattern = /^(?:p[aá]gina\s+\d+\s+de\s+\d+\s*)?(.+?)\s*-\s*(\d{1,2})\s*-\s*turno\s+([\p{L}]+)\s*$/iu;
  const lines = String(text || "").replace(/\r/g, "").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeHeadingLine(lines[index]);
    let heading = line.match(headingPattern);
    const mayBeWrappedHeading = /(?:-\s*\d{1,2}\s*-|\bturno)\s*$/iu.test(line);
    if (!heading && mayBeWrappedHeading && index + 1 < lines.length) {
      const joined = normalizeHeadingLine(line + " " + lines[index + 1]);
      heading = joined.match(headingPattern);
      if (heading) index += 1;
    }
    if (heading) {
      if (current) sections.push(current);
      let role = heading[1].trim();
      role = role.replace(/^p[aá]gina\s+\d+\s+de\s+\d+\s+/iu, "").trim();
      current = {
        role,
        bookletNumber: String(Number(heading[2])),
        shift: heading[3].trim(),
        lines: []
      };
      continue;
    }
    if (current) current.lines.push(lines[index]);
  }

  if (current) sections.push(current);
  return sections.map(section => {
    const sectionText = section.lines.join("\n");
    let parsed = parseAnswerRows(sectionText, questionFormat);

    // FGV consolidated keys may expose a clean two-row matrix (question numbers,
    // then alternatives) while the general parser rejects the PDF's column spacing.
    // Use this strict positional fallback only when the general parser found nothing.
    if (parsed.parsedCount === 0) {
      const allowed = questionFormat === "true_false" ? new Set(["C", "E", "X", "*"]) : new Set(["A", "B", "C", "D", "E", "F", "X", "*"]);
      const rows = String(sectionText).replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
      const recovered = new Map();
      const conflicts = new Set();
      const addAligned = (numbers, values) => {
        if (numbers.length < 5 || numbers.length !== values.length) return false;
        numbers.forEach((number, index) => {
          const answer = values[index] === "*" || values[index] === "X" ? "ANULADA" : values[index];
          const previous = recovered.get(Number(number));
          if (previous && previous !== answer) conflicts.add(Number(number));
          else recovered.set(Number(number), answer);
        });
        return true;
      };
      for (let index = 0; index + 1 < rows.length; index += 1) {
        const numberTokens = rows[index].match(/\d{1,3}/g) || [];
        const numberResidue = rows[index].replace(/\d{1,3}/g, "").replace(/[\s|.,;:_-]/g, "");
        if (numberTokens.length < 5 || numberResidue) continue;
        const answerTokens = rows[index + 1].toUpperCase().match(/[A-FX*]/g) || [];
        const answerResidue = rows[index + 1].toUpperCase().replace(/[A-FX*]/g, "").replace(/[\s|.,;:_-]/g, "");
        if (answerResidue || !answerTokens.every(token => allowed.has(token))) continue;
        if (addAligned(numberTokens, answerTokens)) index += 1;
      }
      for (const number of conflicts) recovered.delete(number);
      if (recovered.size) parsed = { answers: recovered, conflicts: [...conflicts], parsedCount: recovered.size };
    }

    return {
      role: section.role,
      bookletNumber: section.bookletNumber,
      shift: section.shift,
      answers: parsed.answers,
      conflicts: parsed.conflicts,
      parsedCount: parsed.parsedCount,
      sampleLines: section.lines.slice(0, 24).map(line => String(line).trim()).filter(Boolean)
    };
  });
}

export function selectAnswerKeySection(examLink, record, sections) {
  const documentSignal = normalizeDocumentLabel([examLink?.label, examLink?.url].join(" "));
  const registeredRole = normalizeDocumentLabel(record?.role_name || "");
  const registeredRoleWords = registeredRole.split(" ").filter(word => word.length > 2);
  const roleCandidates = (Array.isArray(sections) ? sections : []).filter(section => {
    const role = normalizeDocumentLabel(section.role);
    const roleWords = role.split(" ").filter(word => word.length > 2);
    return Boolean(role) && (
      documentSignal.includes(role)
      || (roleWords.length >= 2 && roleWords.every(word => documentSignal.includes(word)))
    );
  });

  // O nome do PDF é a evidência de cargo mais específica. Só recorremos ao
  // campo geral do concurso quando ele aponta para um único cargo/seção.
  let roleMatches = roleCandidates;
  if (!roleMatches.length && registeredRoleWords.length >= 2) {
    roleMatches = (Array.isArray(sections) ? sections : []).filter(section => {
      const roleWords = normalizeDocumentLabel(section.role).split(" ").filter(word => word.length > 2);
      return roleWords.length >= 2 && roleWords.every(word => registeredRoleWords.includes(word));
    });
  }

  const examVariant = variantIdentity([examLink?.label, examLink?.url].join(" "));
  const matches = roleMatches.filter(section =>
    !examVariant || String(section.bookletNumber) === String(Number(examVariant))
  );
  return matches.length === 1 ? matches[0] : null;
}

export function calculateAnswerKeyCoverage(questions, answerMap) {
  const questionNumbers = new Set((Array.isArray(questions) ? questions : [])
    .map(question => Number(question?.source_question_number))
    .filter(number => Number.isInteger(number) && number > 0));
  const entries = answerMap instanceof Map ? [...answerMap.entries()] : [];
  const validAnswers = entries.filter(([, answer]) => answer !== "ANULADA");
  if (!validAnswers.length) return 0;
  return validAnswers.filter(([number]) => questionNumbers.has(Number(number))).length / validAnswers.length;
}

export function compareQuestionNumberCoverage(questions, answerMap) {
  const expectedNumbers = answerMap instanceof Map
    ? [...answerMap.keys()].map(Number).filter(number => Number.isInteger(number) && number > 0).sort((a, b) => a - b)
    : [];
  const extractedNumbers = (Array.isArray(questions) ? questions : [])
    .map(question => Number(question?.source_question_number))
    .filter(number => Number.isInteger(number) && number > 0);
  const expectedSet = new Set(expectedNumbers);
  const extractedSet = new Set(extractedNumbers);
  const seen = new Set();
  const duplicateSet = new Set();
  for (const number of extractedNumbers) {
    if (seen.has(number)) duplicateSet.add(number);
    seen.add(number);
  }
  const missing = expectedNumbers.filter(number => !extractedSet.has(number));
  const unexpected = [...extractedSet].filter(number => !expectedSet.has(number)).sort((a, b) => a - b);
  const duplicates = [...duplicateSet].sort((a, b) => a - b);
  const complete = expectedNumbers.length > 0
    && expectedSet.size === expectedNumbers.length
    && extractedNumbers.length === (Array.isArray(questions) ? questions.length : 0)
    && extractedNumbers.length === expectedNumbers.length
    && extractedSet.size === expectedSet.size
    && missing.length === 0
    && unexpected.length === 0
    && duplicates.length === 0;
  return {
    complete,
    expectedCount: expectedNumbers.length,
    extractedCount: extractedNumbers.length,
    uniqueExtractedCount: extractedSet.size,
    missing,
    unexpected,
    duplicates
  };
}

export function enforceWholeBookletGate(validatedQuestions, { allowValidatedSubset = false } = {}) {
  const items = Array.isArray(validatedQuestions) ? validatedQuestions : [];
  const rejected = items.filter(item => !item?.approved);
  const approved = items.length - rejected.length;
  if (allowValidatedSubset && approved > 0 && rejected.length > 0) {
    return {
      approved: true,
      total: items.length,
      rejected: rejected.length,
      eligible: approved,
      mode: "validated_subset"
    };
  }
  return { approved: items.length > 0 && rejected.length === 0, total: items.length, rejected: rejected.length };
}

export function validateQuestionForAutoPublication(question, answer, questionFormat, { ocrAllowed = false } = {}) {
  const reasons = [];
  const prompt = String(question?.prompt || "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  const ids = options.map(option => String(option?.id || "").toLowerCase());
  const spacingValid = !hasSuspiciousWordSpacing([prompt, ...options.map(option => option?.text || "")].join(" "));
  if (!spacingValid) reasons.push("espaçamento entre palavras inválido ou suspeito");
  if (prompt.length < 20 || prompt.length > 5000) reasons.push("enunciado fora do limite");
  if (options.length < 2 || options.length > 6) reasons.push("quantidade de alternativas inválida");
  if (new Set(ids).size !== ids.length) reasons.push("alternativas duplicadas");
  const sequential = ids.every((id, index) => id === String.fromCharCode(97 + index));
  const trueFalse = questionFormat === "true_false" && ids.join(",") === "c,e";
  if (!sequential && !trueFalse) reasons.push("identificadores de alternativas inconsistentes");
  if (!options.some(option => String(option?.id || "").toLowerCase() === String(answer || "").toLowerCase())) {
    reasons.push("gabarito não corresponde a uma alternativa");
  }
  if (question?.ocr_used && !ocrAllowed) reasons.push("questão depende de OCR sem confiança visual mensurável");
  const notes = normalizeDocumentLabel(question?.review_notes || "");
  if (/imagem|figura|grafico|tabela|mapa|charge|tirinha|texto externo|extracao incompleta|revisao visual/.test(notes)) {
    reasons.push("possível dependência de conteúdo visual ou externo");
  }
  if (/\b(figura|imagem|grafico|tabela|mapa|charge|tirinha|texto acima)\b/i.test(prompt)) {
    reasons.push("enunciado depende de figura, tabela, gráfico ou texto externo");
  }
  return { approved: reasons.length === 0, reasons, checks: {
    completePrompt: prompt.length >= 20 && prompt.length <= 5000,
    optionsValid: options.length >= 2 && options.length <= 6 && new Set(ids).size === ids.length,
    answerKeyMatches: options.some(option => String(option?.id || "").toLowerCase() === String(answer || "").toLowerCase()),
    parserTextOnly: !question?.ocr_used || ocrAllowed,
    textSpacingValid: spacingValid,
    noVisualDependency: !reasons.some(reason => reason.includes("visual") || reason.includes("figura"))
  }};
}

export function isApprovedForQuestionReuse(record) {
  if (
    !record
    || record.question_reuse_status !== "approved"
    || !["official_publication", "permission_granted", "public_domain", "cc_by", "cc_by_sa"].includes(record.question_reuse_basis)
  ) return false;

  // Questões de provas oficiais publicadas podem ser classificadas em nível de fonte
  // com base no ato oficial; não se exige autorização nem assinatura por questão.
  if (record.question_reuse_basis === "official_publication") {
    return record.published === true && Boolean(safeOfficialUrl(record.source_url));
  }

  // Demais bases dependem de evidência documentada da licença/autorização.
  return Boolean(
    (safeOfficialUrl(record.question_reuse_proof_url) || safeOfficialUrl(record.question_reuse_terms_url))
    && typeof record.question_reuse_reviewed_by === "string"
    && record.question_reuse_reviewed_by.length > 0
    && typeof record.question_reuse_reviewed_at === "string"
    && Number.isFinite(Date.parse(record.question_reuse_reviewed_at))
  );
}

export function isSourceEligibleForMode(record, mode) {
  if (!["dry-run", "stage", "publish"].includes(mode)) return false;
  return mode !== "publish" || isApprovedForQuestionReuse(record);
}

export function canPromoteStagedImport(existing) {
  return Boolean(
    existing
    && existing.status === "pending"
    && existing.rights_review_status === "not_reviewed"
    && existing.rights_basis === "official_publication"
    && existing.official_release_verified === true
    && (existing.published_question_id === null || existing.published_question_id === undefined)
  );
}

function inferBoard(value) {
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { return ""; }
  if (host.includes("cebraspe.org.br")) return "Cebraspe";
  if (host === "conhecimento.fgv.br" || host.endsWith(".fgv.br")) return "FGV";
  if (host.includes("concursosfcc.com.br")) return "FCC";
  if (host.includes("vunesp.com.br")) return "Vunesp";
  if (host.includes("institutoaocp.org.br")) return "Instituto AOCP";
  if (host.includes("ibfc.org.br")) return "IBFC";
  if (host.includes("quadrix.org.br")) return "Quadrix";
  if (host.includes("igeduc.org.br") || host.includes("igeduc.selecao.net.br")) return "IGEDUC";
  if (host.includes("fundacaolasalle.org.br")) return "Fundação La Salle";
  return "";
}

function inferYear(value) {
  const match = String(value || "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function contestContexts() {
  const rows = [];
  for (const contest of concursos) {
    const sourceUrl = safeOfficialUrl(contest.sourceUrl);
    if (!sourceUrl) continue;
    const status = normalizeDocumentLabel(contest.status || "");
    if (!/prova realizada|provas realizadas|prova aplicada|provas aplicadas|gabarito|resultado preliminar da prova|resultado definitivo da prova/.test(status)) continue;
    if (/prova em \d|provas em \d/.test(status)) continue;
    const board = inferBoard(sourceUrl);
    const examYear = inferYear([contest.vinculo, contest.atoOficial, contest.status, sourceUrl].join(" "));
    if (!board || !examYear) continue;
    rows.push({
      board,
      exam_name: String(contest.vinculo || (String(contest.orgao || "") + " — " + String(contest.cargo || ""))).slice(0, 180),
      exam_year: examYear,
      discipline: "Diversas disciplinas",
      topic: "Provas anteriores",
      role_name: String(contest.cargo || "").slice(0, 180),
      source_url: sourceUrl,
      exam_url: null,
      answer_key_url: null,
      notes: String(contest.observacao || "").slice(0, 2000)
    });
  }
  return rows;
}

function authConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

async function supabaseRest(endpoint, init = {}) {
  if (!authConfigured()) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários para acessar o catálogo de fontes.");
  const url = SUPABASE_URL + "/rest/v1/" + endpoint;
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error("Supabase REST HTTP " + response.status + ": " + body.slice(0, 600));
  return body ? JSON.parse(body) : null;
}

async function loadRegisteredSources(mode = "dry-run") {
  const configuredSources = JSON.parse(await readFile(new URL("./official-exam-sources.json", import.meta.url), "utf8"));
  const staticRows = [
    ...contestContexts(),
    ...(Array.isArray(configuredSources) ? configuredSources : [])
  ];
  const query = new URLSearchParams({
    select: "id,board,exam_name,exam_year,discipline,role_name,source_url,exam_url,answer_key_url,notes,published,question_reuse_status,question_reuse_basis,question_reuse_proof_url,question_reuse_terms_url,question_reuse_rights_holder,question_reuse_restrictions,question_reuse_review_notes,question_reuse_reviewed_by,question_reuse_reviewed_at,last_ingested_at",
    published: "eq.true",
    order: "last_ingested_at.asc.nullsfirst,exam_year.desc",
    limit: "300"
  });
  let rows = [];
  if (authConfigured()) {
    try {
      rows = await supabaseRest("study_exam_sources?" + query.toString()) || [];
    } catch (error) {
      if (!/study_exam_sources|schema cache|does not exist|HTTP 404/i.test(error.message)) throw error;
      console.warn("Tabela de fontes de provas ainda indisponível; usando apenas fontes locais verificadas.");
    }
  }
  const unique = new Map();
  for (const row of [...rows, ...staticRows]) {
    // Revisão de reutilização é uma decisão por fonte, não uma autorização por questão.
    // dry-run e stage processam as fontes oficiais; somente publish exige decisão explícita.
    if (!isSourceEligibleForMode(row, mode)) continue;
    const pageUrl = safeOfficialUrl(row.source_url);
    const examYear = Number(row.exam_year);
    if (!pageUrl || !row.board || !row.exam_name || !Number.isInteger(examYear) || examYear < 1900 || examYear > 2200) continue;
    const key = [row.board, row.exam_name, examYear, pageUrl].join("|").toLowerCase();
    if (!unique.has(key)) unique.set(key, {
      ...row,
      source_url: pageUrl,
      exam_year: examYear,
      discipline: String(row.discipline || "Diversas disciplinas").slice(0, 100),
      topic: String(row.topic || "Provas anteriores").slice(0, 160),
      exam_url: row.exam_url ? safeOfficialUrl(row.exam_url) : null,
      answer_key_url: row.answer_key_url ? safeOfficialUrl(row.answer_key_url) : null
    });
  }
  return [...unique.values()].slice(0, MAX_SOURCE_PAGES);
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Documento excede o limite de " + maxBytes + " bytes.");
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("Documento excede o limite de " + maxBytes + " bytes.");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("Limite de tamanho excedido.").catch(() => {});
        throw new Error("Documento excede o limite de " + maxBytes + " bytes.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

const blockedIPv4 = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
]) blockedIPv4.addSubnet(subnet, prefix, "ipv4");

const blockedIPv6 = new BlockList();
for (const [subnet, prefix] of [
  ["2001:0::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["3fff::", 20], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
]) blockedIPv6.addSubnet(subnet, prefix, "ipv6");

export function isPublicIpAddress(address) {
  const family = isIP(String(address || ""));
  if (family === 4) return !blockedIPv4.check(address, "ipv4");
  if (family !== 6) return false;
  const firstGroup = Number.parseInt(String(address).split(":")[0] || "0", 16);
  if (!Number.isInteger(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff) return false;
  return !blockedIPv6.check(address, "ipv6");
}

function responseHeaders(headers = {}) {
  return {
    get(name) {
      const value = headers[String(name).toLowerCase()];
      return Array.isArray(value) ? String(value[0] ?? "") : value == null ? null : String(value);
    }
  };
}

async function requestPinnedHttpsResponse(targetUrl, { address, family, maxBytes, timeoutMs = 25000 }) {
  const url = new URL(targetUrl);
  if (url.protocol !== "https:" || !isPublicIpAddress(address)) {
    throw new Error("SSRF_BLOCKED: destino HTTPS ou endereço de rede não público.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      servername: url.hostname,
      headers: {
        "User-Agent": "EditalRadar-OfficialExamIngestion/1.0",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9"
      },
      // Pin the resolved IP while preserving hostname-based TLS SNI and Host.
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      }
    }, response => {
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > maxBytes) {
        const error = new Error("Documento excede o limite de " + maxBytes + " bytes.");
        response.destroy();
        request.destroy();
        finish(reject, error);
        return;
      }
      response.on("data", chunk => {
        if (settled) return;
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          const error = new Error("Documento excede o limite de " + maxBytes + " bytes.");
          response.destroy();
          request.destroy();
          finish(reject, error);
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => finish(resolve, {
        statusCode: response.statusCode || 0,
        headers: response.headers,
        bytes: Buffer.concat(chunks, size)
      }));
      response.on("error", error => finish(reject, error));
      response.on("aborted", () => finish(reject, new Error("A conexão da fonte oficial foi interrompida.")));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Tempo limite ao baixar a fonte oficial.")));
    request.on("error", error => finish(reject, error));
    request.end();
  });
}

async function requestOfficialHop(targetUrl, { fetchImpl, lookupImpl, requestImpl, maxBytes }) {
  // fetchImpl is an explicit test seam. Production uses the pinned HTTPS transport.
  if (typeof fetchImpl === "function") {
    const response = await fetchImpl(targetUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "EditalRadar-OfficialExamIngestion/1.0",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9"
      },
      signal: AbortSignal.timeout(25000)
    });
    const redirected = [301, 302, 303, 307, 308].includes(response.status);
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      url: response.url || targetUrl,
      bytes: redirected ? Buffer.alloc(0) : await readBoundedBody(response, maxBytes)
    };
  }

  const url = new URL(targetUrl);
  let addresses;
  try {
    addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("DNS_LOOKUP_FAILED: não foi possível resolver o host oficial.");
  }
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some(record => !isPublicIpAddress(record?.address))) {
    throw new Error("SSRF_BLOCKED: DNS do host oficial retornou endereço IP não público.");
  }
  const selected = addresses[0];
  const response = await requestImpl(targetUrl, {
    address: selected.address,
    family: selected.family,
    maxBytes,
    timeoutMs: 25000
  });
  const status = Number(response.statusCode || 0);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders(response.headers),
    url: targetUrl,
    bytes: Buffer.isBuffer(response.bytes) ? response.bytes : Buffer.from(response.bytes || "")
  };
}

async function writeValidatedDownloadedPdf(directory, filename, resource, maxBytes = MAX_PDF_BYTES) {
  if (!["exam.pdf", "answer-key.pdf"].includes(filename)) {
    throw new Error("Nome de arquivo temporário não permitido.");
  }
  const bytes = resource?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > maxBytes
    || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Documento remoto não passou pela validação de tamanho e assinatura PDF.");
  }
  const destination = path.join(directory, filename);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0);
  const handle = await open(destination, flags, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return destination;
}

export async function fetchOfficialResource(initialUrl, {
  fetchImpl = null,
  lookupImpl = lookup,
  requestImpl = requestPinnedHttpsResponse,
  maxBytes = MAX_HTML_BYTES,
  attempts = 3
} = {}) {
  const startUrl = safeOfficialUrl(initialUrl);
  if (!startUrl) throw new Error("URL inicial não é HTTPS ou não pertence a um host oficial autorizado.");
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      let currentUrl = startUrl;
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await requestOfficialHop(currentUrl, { fetchImpl, lookupImpl, requestImpl, maxBytes });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects === MAX_REDIRECTS) throw new Error("Limite de redirecionamentos oficiais excedido.");
          const location = response.headers.get("location");
          const nextUrl = location ? safeOfficialUrl(location, currentUrl) : null;
          if (!nextUrl) throw new Error("Redirecionamento para destino não autorizado; coleta interrompida.");
          currentUrl = nextUrl;
          continue;
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          throw new Error("HTTP_429: limite da fonte atingido (Retry-After " + (retryAfter || "não informado") + "); a fonte será retomada no próximo ciclo.");
        }
        if ([401, 403].includes(response.status)) throw new Error("SOURCE_RESTRICTED: a fonte exige acesso adicional ou restringiu a coleta.");
        if (response.status >= 500 && attempt < attempts) {
          await sleep(attempt * 1500);
          break;
        }
        if (!response.ok) throw new Error("Fonte oficial respondeu HTTP " + response.status + ".");
        const finalUrl = safeOfficialUrl(response.url || currentUrl);
        if (!finalUrl) throw new Error("Resposta terminou fora da lista de hosts oficiais.");
        const bytes = response.bytes;
        return {
          url: finalUrl,
          contentType: String(response.headers.get("content-type") || "").toLowerCase(),
          bytes,
          isPdf: bytes.subarray(0, 5).toString("ascii") === "%PDF-"
        };
      }
    } catch (error) {
      lastError = error;
      if (/SSRF_BLOCKED|HTTP_429|SOURCE_RESTRICTED|não pertence|não autorizado|redirecionamento/i.test(error.message)) throw error;
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }
  throw lastError || new Error("Não foi possível obter a fonte oficial.");
}

function resolveExamAndKeyLinks(record, links, pageText) {
  const classified = links.map(link => ({ ...link, kind: classifyOfficialPdfLink(link, pageText, record.notes) }));
  const exams = [];
  const keys = [];
  if (record.exam_url) exams.push({ url: record.exam_url, label: record.exam_name + " prova oficial", kind: "exam_pdf" });
  if (record.answer_key_url && isDefinitiveAnswerKey(record.answer_key_url, pageText, record.notes)) {
    keys.push({ url: record.answer_key_url, label: record.exam_name + " gabarito definitivo", kind: "definitive_answer_key" });
  }
  for (const link of classified) {
    if (link.kind === "exam_pdf" && !exams.some(item => item.url === link.url)) exams.push(link);
    if (link.kind === "definitive_answer_key" && !keys.some(item => item.url === link.url)) keys.push(link);
  }
  return { exams, keys };
}

export function variantIdentity(value) {
  const text = normalizeDocumentLabel(value);
  const match = text.match(/\b(?:caderno|prova)\s+tipo\s+([a-z0-9]{1,4})\b|\b(?:tipo|caderno|prova|versao)\s+([a-z0-9]{1,4})\b/);
  return match ? (match[1] || match[2]) : "";
}

export function pairExamWithAnswerKey(exam, keys, examCount = 1) {
  if (keys.length === 1) {
    const examVariant = variantIdentity(exam.label + " " + exam.url);
    const keyVariant = variantIdentity(keys[0].label + " " + keys[0].url);
    if (keyVariant && keyVariant !== examVariant) return null;
    if (Number(examCount) > 1) {
      // Um único PDF pode conter seções por cargo e caderno. A associação
      // só será aceita depois de localizar exatamente uma seção no conteúdo.
      return { ...keys[0], requiresSectionMatch: true };
    }
    return keys[0];
  }
  const variant = variantIdentity(exam.label + " " + exam.url);
  if (!variant) return null;
  const matches = keys.filter(key => variantIdentity(key.label + " " + key.url) === variant);
  return matches.length === 1 ? matches[0] : null;
}

function questionFormatFor(record, examLink) {
  const signal = normalizeDocumentLabel([record.board, record.exam_name, examLink.label, examLink.url].join(" "));
  return /cebraspe|certo errado|certo ou errado|julgue os itens/.test(signal) ? "true_false" : "multiple_choice";
}

function validateContext(record) {
  const year = Number(record.exam_year);
  return Boolean(
    record.board && String(record.board).trim().length >= 2
    && record.exam_name && String(record.exam_name).trim().length >= 2
    && Number.isInteger(year) && year >= 1900 && year <= 2200
    && record.discipline && String(record.discipline).trim().length >= 2
    && safeOfficialUrl(record.source_url)
  );
}

async function processDocument(record, examLink, keyLink, mode, runId, report, fetchImpl = null) {
  const diagnostic = { examUrl: examLink.url, answerKeyUrl: keyLink.url, stage: "download_exam", extractedQuestions: 0, answerKeyPages: null, answerKeySections: [], parsedAnswers: 0 };
  let stage = diagnostic.stage;
  let proof;
  let answerKeyFile;
  let sourcePage;
  let sourceText = "";
  try {
    proof = await fetchOfficialResource(examLink.url, { fetchImpl, maxBytes: MAX_PDF_BYTES });
    if (!proof.isPdf) throw new Error("O link identificado como prova não retornou um PDF válido.");
    stage = diagnostic.stage = "download_answer_key";
    answerKeyFile = await fetchOfficialResource(keyLink.url, { fetchImpl, maxBytes: MAX_PDF_BYTES });
    if (!answerKeyFile.isPdf) throw new Error("O link identificado como gabarito não retornou um PDF válido.");
    stage = diagnostic.stage = "validate_source";
    sourcePage = await fetchOfficialResource(record.source_url, { fetchImpl, maxBytes: MAX_HTML_BYTES });
    if (sourcePage.isPdf) throw new Error("A página oficial de origem retornou um PDF, não uma página de descoberta.");
    sourceText = stripTags(sourcePage.bytes.toString("utf8"));
    if (!isDefinitiveAnswerKey(keyLink.label + " " + keyLink.url, sourceText, record.notes)) {
      throw new Error("Não foi encontrada evidência inequívoca de que o gabarito é definitivo.");
    }
  } catch (error) {
    report.documentDiagnostics.push({
      ...diagnostic,
      stage,
      status: "failed",
      error: String(error?.message || error).slice(0, 1600)
    });
    throw error;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "editalradar-official-ingestion-"));
  try {
    const proofPath = await writeValidatedDownloadedPdf(tempDir, "exam.pdf", proof);
    const keyPath = await writeValidatedDownloadedPdf(tempDir, "answer-key.pdf", answerKeyFile);
    const proofHash = sha256(proof.bytes);
    const keyHash = sha256(answerKeyFile.bytes);
    const questionFormat = questionFormatFor(record, examLink);
    diagnostic.questionFormat = questionFormat;
    const metadata = {
      board: record.board,
      exam_name: record.exam_name,
      exam_year: Number(record.exam_year),
      discipline: record.discipline,
      topic: record.topic || "Provas anteriores",
      role_name: record.role_name || "",
      question_format: questionFormat,
      source_url: record.source_url,
      exam_pdf_url: proof.url,
      rights_basis: "official_publication",
      official_release_verified: true,
      source_terms_url: null,
      source_restrictions: ""
    };
    stage = diagnostic.stage = "extract_exam_pdf";
    const manifest = await importPdfToManifest({ pdfPath: proofPath, metadata });
    diagnostic.extractedQuestions = Array.isArray(manifest?.imports) ? manifest.imports.length : 0;
    diagnostic.extractionDiagnostics = Array.isArray(manifest?.extractionDiagnostics) ? manifest.extractionDiagnostics : [];
    diagnostic.questionParsingDiagnostics = Array.isArray(manifest?.questionParsingDiagnostics) ? manifest.questionParsingDiagnostics : [];
    stage = diagnostic.stage = "extract_answer_key";
    const keyExtraction = await extractPdfPages(keyPath, questionFormat, { splitColumns: false });
    diagnostic.answerKeyPages = Array.isArray(keyExtraction?.pages) ? keyExtraction.pages.length : null;
    if (keyExtraction.pages.some(page => page.ocrUsed)) {
      throw new Error("O gabarito definitivo depende de OCR; a resposta não será presumida.");
    }
    const definitiveText = keyExtraction.pages.map(page => page.text).join("\n");
    if (!isDefinitiveAnswerKey(keyLink.label + " " + keyLink.url, definitiveText + " " + sourceText, record.notes)) {
      throw new Error("O conteúdo do PDF não confirmou o caráter definitivo do gabarito.");
    }
    stage = diagnostic.stage = "parse_answer_key";
    const answerKeySections = parseOfficialAnswerKeyVariants(definitiveText, questionFormat);
    diagnostic.answerKeySections = answerKeySections.map(section => ({ role: section.role, bookletNumber: section.bookletNumber, shift: section.shift, parsedCount: section.parsedCount, sampleLines: section.sampleLines }));
    let parsedKey;
    if (answerKeySections.length) {
      const matchedSection = selectAnswerKeySection(examLink, record, answerKeySections);
      if (!matchedSection) {
        const candidates = definitiveText.split("\n")
          .map(line => line.trim())
          .filter(line => /agente|delegado|papiloscopista|turno/i.test(line))
          .slice(0, 12);
        const sectionDiagnostics = answerKeySections.slice(0, 20).map(section => ({
          role: section.role,
          bookletNumber: section.bookletNumber,
          shift: section.shift,
          parsedCount: section.parsedCount
        }));
        const debugExam = {
          label: examLink.label,
          roleName: record.role_name || "",
          variant: variantIdentity([examLink.label, examLink.url].join(" ")),
          normalizedSignal: normalizeDocumentLabel([examLink.label, examLink.url, record.role_name, record.exam_name].join(" "))
        };
        const error = new Error(
          "O gabarito definitivo consolidado não contém uma única seção que corresponda ao cargo e caderno desta prova. "
          + "Exame: " + JSON.stringify(debugExam).slice(0, 700)
          + " | Seções: " + JSON.stringify(sectionDiagnostics).slice(0, 1800)
          + " | Cabeçalhos: " + candidates.join(" | ").slice(0, 500)
        );
        error.code = "UNMATCHED_ANSWER_KEY_SECTION";
        throw error;
      }
      if (!matchedSection.parsedCount) {
        // Diagnóstico estrutural, sem divulgar o texto integral do gabarito nos logs.
        const tokenPattern = /\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi;
        const structuralSamples = matchedSection.sampleLines.slice(0, 12).map(line => {
          const tokens = (String(line).match(tokenPattern) || []).map(token => token.toUpperCase());
          return { length: String(line).length, tokens, separatorShape: String(line).replace(tokenPattern, "#").replace(/[A-Za-zÀ-ÿ]+/g, "T").slice(0, 140) };
        });
        throw new Error(
          "A seção do gabarito foi localizada (" + matchedSection.role + ", caderno "
          + matchedSection.bookletNumber + "), mas nenhuma resposta foi extraída do bloco. "
          + "Diagnóstico estrutural: " + JSON.stringify(structuralSamples).slice(0, 1600)
        );
      }
      parsedKey = {
        answers: matchedSection.answers,
        conflicts: matchedSection.conflicts,
        parsedCount: matchedSection.parsedCount,
        selectedSection: {
          role: matchedSection.role,
          bookletNumber: matchedSection.bookletNumber,
          shift: matchedSection.shift
        }
      };
    } else {
      if (keyLink.requiresSectionMatch) {
        const error = new Error("O gabarito único exige associação por seção, mas o PDF não expõe seções identificáveis.");
        error.code = "UNMATCHED_ANSWER_KEY_SECTION";
        throw error;
      }
      parsedKey = parseOfficialAnswerKey(definitiveText, questionFormat);
    }
    if (parsedKey.conflicts.length) throw new Error("O gabarito contém respostas conflitantes para questões: " + parsedKey.conflicts.join(", "));
    stage = diagnostic.stage = "validate_question_answer_matching";
    diagnostic.parsedAnswers = parsedKey.parsedCount;
    const questions = manifest.imports;
    if (!questions.length) throw new Error("O parser não identificou questões objetivas válidas.");
    diagnostic.extractedQuestionNumbers = questions
      .map(question => Number(question.source_question_number))
      .filter(number => Number.isInteger(number) && number > 0)
      .sort((a, b) => a - b);
    diagnostic.extractedQuestionPages = [...new Set(questions.map(question => Number(question.source_page)).filter(Number.isInteger))].sort((a, b) => a - b);
    diagnostic.answerKeyQuestionNumbers = [...parsedKey.answers.keys()].map(Number).sort((a, b) => a - b);
    const coverage = calculateAnswerKeyCoverage(questions, parsedKey.answers);
    const numberCoverage = compareQuestionNumberCoverage(questions, parsedKey.answers);
    diagnostic.questionNumberCompleteness = numberCoverage;
    const missingAnswers = questions.filter(question => !parsedKey.answers.has(Number(question.source_question_number)));
    if (missingAnswers.length || coverage < MIN_GABARITO_COVERAGE || !numberCoverage.complete) {
      throw new Error(
        "Correspondência prova/gabarito insuficiente: " + Math.round(coverage * 100)
        + "% do gabarito associado, " + missingAnswers.length + " questão(ões) sem resposta definitiva"
        + "; conjunto numérico completo: " + numberCoverage.complete
        + "; faltantes: " + numberCoverage.missing.join(",")
        + "; duplicados: " + numberCoverage.duplicates.join(",")
        + "; inesperados: " + numberCoverage.unexpected.join(",") + "."
      );
    }
    stage = diagnostic.stage = "validate_questions";
    const output = [];
    const validations = [];
    for (const question of questions) {
      const officialAnswer = parsedKey.answers.get(Number(question.source_question_number));
      if (!officialAnswer || officialAnswer === "ANULADA") {
        report.annulledOrMissing += 1;
        continue;
      }
      const answer = officialAnswer.toLowerCase();
      const ocrAllowed = Boolean(question.ocr_used && Number(question.ocr_confidence) >= 92);
      const validation = validateQuestionForAutoPublication(question, answer, questionFormat, { ocrAllowed });
      validations.push({ approved: validation.approved, questionNumber: question.source_question_number, reasons: validation.reasons });
      if (!validation.approved) {
        report.quarantined += 1;
        report.quarantineReasons.push({ booklet: examLink.url, question: question.source_question_number, reasons: validation.reasons });
        continue;
      }
      output.push({
        question,
        answer,
        evidence: {
          checks: validation.checks,
          gabaritoCoverage: Number(coverage.toFixed(4)),
          proofSha256: proofHash,
          answerKeySha256: keyHash,
          proofUrl: proof.url,
          answerKeyUrl: answerKeyFile.url,
          answerKeyType: "official_final",
          answerKeySection: parsedKey.selectedSection || null,
          parser: "editalradar-exam-parser-v1",
          parserOcrUsed: Boolean(question.ocr_used),
          parserOcrConfidence: Number(question.ocr_confidence) || null,
          sourceHostValidated: true
        }
      });
    }
    // When the exact complete question-number set is matched to the definitive
    // answer key, keep individually approved text-only questions eligible while
    // quarantining only items that depend on visual material or untrusted OCR.
    const bookletGate = enforceWholeBookletGate(validations, {
      allowValidatedSubset: numberCoverage.complete && coverage >= MIN_GABARITO_COVERAGE
    });
    diagnostic.validationSummary = {
      totalValidated: bookletGate.total,
      rejected: bookletGate.rejected,
      eligible: bookletGate.eligible ?? (bookletGate.total - bookletGate.rejected),
      mode: bookletGate.mode || (bookletGate.approved ? "all_questions_validated" : "blocked"),
      questionNumberSetComplete: numberCoverage.complete
    };
    if (!bookletGate.approved) {
      report.quarantined += output.length;
      report.quarantineReasons.push({
        booklet: examLink.url,
        reason: "Caderno bloqueado: a validação individual não aprovou nenhuma questão, ou o conjunto numérico não está completo.",
        rejectedQuestions: bookletGate.rejected,
        totalQuestions: bookletGate.total
      });
      output.length = 0;
    }
    if (mode === "stage" && output.length) {
      if (!runId) throw new Error("Pré-cadastro sem identificador de auditoria.");
      for (const item of output) {
        const result = await stageExamQuestion(record, item, proof, answerKeyFile, runId);
        if (result === "staged") report.staged += 1;
        else if (result === "duplicate") report.duplicates += 1;
      }
    } else if (mode === "publish" && output.length) {
      if (!runId) throw new Error("Execução de publicação sem identificador de auditoria.");
      for (const item of output) {
        const published = await stageAndPublish(record, item, proof, answerKeyFile, runId);
        if (published === "published") report.published += 1;
        else if (published === "duplicate") report.duplicates += 1;
      }
    } else {
      report.readyToPublish += output.length;
    }
    report.processedDocuments += 1;
    report.questionsExtracted += questions.length;
    diagnostic.stage = "completed";
    diagnostic.status = output.length
      ? (bookletGate.mode === "validated_subset" ? "eligible_with_quarantine" : "eligible")
      : "quarantined";
    diagnostic.eligibleQuestions = output.length;
    diagnostic.coverage = Number(coverage.toFixed(4));
    report.documentDiagnostics.push(diagnostic);
    return { status: output.length ? "eligible" : "quarantined", extracted: questions.length, eligible: output.length, coverage };
  } catch (error) {
    diagnostic.stage = stage;
    diagnostic.status = "failed";
    diagnostic.error = String(error?.message || error).slice(0, 1600);
    report.documentDiagnostics.push(diagnostic);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function upsertImportAtSourcePosition(row, { replacePublished = false } = {}) {
  const sourceLookup = new URLSearchParams({
    select: "id,status,rights_review_status,published_question_id",
    source_document_sha256: "eq." + row.source_document_sha256,
    source_page: "eq." + Number(row.source_page),
    source_question_number: "eq." + Number(row.source_question_number),
    limit: "2"
  });
  const existingRows = await supabaseRest("study_exam_question_imports?" + sourceLookup.toString());
  if (!Array.isArray(existingRows) || existingRows.length > 1) return null;

  if (existingRows.length === 1) {
    const existing = existingRows[0];
    if (existing.status === "rejected" || existing.rights_review_status === "restricted") return null;
    if (existing.status !== "pending" && !replacePublished) return null;
    const updatedRow = {
      ...row,
      published_question_id: null,
      reviewed_by: null,
      reviewed_at: null
    };
    const updated = await supabaseRest(
      "study_exam_question_imports?id=eq." + encodeURIComponent(existing.id),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(updatedRow)
      }
    );
    return Array.isArray(updated) && updated.length && updated[0].id
      ? updated[0].id
      : null;
  }

  const conflict = new URLSearchParams({ on_conflict: "board,exam_name,exam_year,fingerprint" });
  let inserted;
  try {
    inserted = await supabaseRest("study_exam_question_imports?" + conflict.toString(), {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
  } catch (error) {
    if (/HTTP 409|duplicate key|unique constraint/i.test(error.message)) return null;
    throw error;
  }
  return Array.isArray(inserted) && inserted.length && inserted[0].id
    ? inserted[0].id
    : null;
}

async function stageExamQuestion(record, item, proof, answerKeyFile, runId) {
  const question = item.question;
  const evidence = item.evidence;
  const row = {
    board: record.board,
    exam_name: record.exam_name,
    exam_year: Number(record.exam_year),
    discipline: record.discipline,
    topic: record.topic || "Provas anteriores",
    difficulty: "Intermediária",
    question_format: question.question_format || questionFormatFor(record, { label: record.exam_name, url: proof.url }),
    role_name: record.role_name || "",
    source_url: record.source_url,
    exam_pdf_url: proof.url,
    source_document_sha256: evidence.proofSha256,
    source_page: Number(question.source_page),
    source_question_number: Number(question.source_question_number),
    prompt: question.prompt,
    options: question.options,
    suggested_answer: item.answer,
    fingerprint: question.fingerprint,
    rights_basis: "official_publication",
    official_release_verified: true,
    rights_holder: record.board,
    license_proof_url: null,
    source_terms_url: null,
    source_restrictions: "",
    source_license: null,
    source_attribution: record.board + " — prova oficial publicada em " + record.source_url,
    rights_review_status: "not_reviewed",
    status: "pending",
    review_notes: "Extraída e validada tecnicamente em modo de pré-cadastro. A origem oficial e o gabarito foram conferidos; a avaliação de reutilização/publicação permanece pendente. Execução " + runId,
    created_by: null,
    gabarito_source_url: answerKeyFile.url,
    gabarito_document_sha256: evidence.answerKeySha256,
    auto_validation_score: 100,
    auto_validation_evidence: evidence,
    auto_reviewed_at: new Date().toISOString(),
    automation_run_id: runId
  };
  const importId = await upsertImportAtSourcePosition(row);
  return importId ? "staged" : "duplicate";
}

async function stageAndPublish(record, item, proof, answerKeyFile, runId) {
  const question = item.question;
  const evidence = item.evidence;
  const row = {
    board: record.board,
    exam_name: record.exam_name,
    exam_year: Number(record.exam_year),
    discipline: record.discipline,
    topic: record.topic || "Provas anteriores",
    difficulty: "Intermediária",
    question_format: question.question_format || questionFormatFor(record, { label: record.exam_name, url: proof.url }),
    role_name: record.role_name || "",
    source_url: record.source_url,
    exam_pdf_url: proof.url,
    source_document_sha256: evidence.proofSha256,
    source_page: Number(question.source_page),
    source_question_number: Number(question.source_question_number),
    prompt: question.prompt,
    options: question.options,
    suggested_answer: item.answer,
    fingerprint: question.fingerprint,
    rights_basis: record.question_reuse_basis,
    official_release_verified: true,
    rights_holder: record.question_reuse_rights_holder || record.board,
    license_proof_url: record.question_reuse_proof_url || null,
    source_terms_url: record.question_reuse_terms_url || null,
    source_restrictions: String(record.question_reuse_restrictions || "").slice(0, 2000),
    source_license: record.question_reuse_basis,
    source_attribution: record.board + " — prova oficial publicada em " + record.source_url,
    rights_review_status: "accepted",
    status: "pending",
    review_notes: "Reutilização aprovada em " + record.question_reuse_reviewed_at + ". " + String(record.question_reuse_review_notes || "").slice(0, 1000) + " Autovalidação integral e gabarito definitivo conferidos. Execução " + runId,
    created_by: null,
    gabarito_source_url: answerKeyFile.url,
    gabarito_document_sha256: evidence.answerKeySha256,
    auto_validation_score: 100,
    auto_validation_evidence: evidence,
    auto_reviewed_at: new Date().toISOString(),
    automation_run_id: runId
  };
  let importId = await upsertImportAtSourcePosition(row, { replacePublished: true });

  if (!importId) return "duplicate";

  const publishedId = await supabaseRest("rpc/publish_study_exam_question_import_automated", {
    method: "POST",
    body: JSON.stringify({
      p_import_id: importId,
      p_answer: item.answer,
      p_explanation: "Gabarito definitivo publicado pela banca organizadora. Consulte a publicação oficial: " + answerKeyFile.url,
      p_run_id: runId
    })
  });
  return publishedId ? "published" : "duplicate";
}

async function createRun(runId, mode) {
  const now = new Date().toISOString();
  await supabaseRest("study_exam_ingestion_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: runId,
      mode,
      status: "running",
      started_at: now,
      sources_checked: 0,
      documents_checked: 0,
      questions_extracted: 0,
      published_count: 0,
      staged_count: 0,
      duplicate_count: 0,
      quarantined_count: 0,
      failed_count: 0
    })
  });
}

async function finishRun(runId, report, status) {
  await supabaseRest("study_exam_ingestion_runs?id=eq." + encodeURIComponent(runId), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      completed_at: new Date().toISOString(),
      sources_checked: report.sourcesChecked,
      documents_checked: report.documentsChecked,
      questions_extracted: report.questionsExtracted,
      published_count: report.published,
      staged_count: report.staged,
      duplicate_count: report.duplicates,
      quarantined_count: report.quarantined + report.annulledOrMissing,
      failed_count: report.failures.length,
      report
    })
  });
}

function createReport(mode) {
  return {
    runId: randomUUID(),
    mode,
    startedAt: new Date().toISOString(),
    sourcesChecked: 0,
    documentsChecked: 0,
    processedDocuments: 0,
    questionsExtracted: 0,
    readyToPublish: 0,
    published: 0,
    staged: 0,
    duplicates: 0,
    quarantined: 0,
    annulledOrMissing: 0,
    failures: [],
    documentDiagnostics: [],
    quarantineReasons: [],
    unmatchedDocuments: [],
    sourceDiagnostics: []
  };
}

export async function runAutomaticOfficialExamIngestion({ mode = "dry-run", limit = MAX_DOCUMENTS_PER_RUN, fetchImpl = null } = {}) {
  if (!["dry-run", "stage", "publish"].includes(mode)) throw new Error("Modo inválido; use dry-run, stage ou publish.");
  if (mode === "publish") {
    if (process.env.EXAM_IMPORT_AUTOPUBLISH_ENABLED !== "true") {
      throw new Error("Autopublicação bloqueada: EXAM_IMPORT_AUTOPUBLISH_ENABLED precisa ser true.");
    }
    if (!authConfigured()) throw new Error("Publicação exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }
  const report = createReport(mode);
  const rows = await loadRegisteredSources(mode);
  const cache = new Map();
  const maxDocs = Math.max(1, Math.min(MAX_DOCUMENTS_PER_RUN, Number(limit) || MAX_DOCUMENTS_PER_RUN));
  let runCreated = false;
  if (mode === "publish" || mode === "stage") {
    await createRun(report.runId, mode);
    runCreated = true;
  }
  try {
    for (const record of rows) {
      if (report.documentsChecked >= maxDocs) break;
      if (!validateContext(record)) continue;
      report.sourcesChecked += 1;
      try {
        let page = cache.get(record.source_url);
        if (!page) {
          page = await fetchOfficialResource(record.source_url, { fetchImpl, maxBytes: MAX_HTML_BYTES });
          cache.set(record.source_url, page);
        }
        if (page.isPdf) continue;
        const html = new TextDecoder("utf-8").decode(page.bytes);
        const pageText = stripTags(html);
        const links = extractOfficialPdfLinks(html, page.url);
        const subpages = extractOfficialSubpageLinks(html, page.url).slice(0, MAX_SOURCE_SUBPAGES);
        const diagnostics = {
          source: record.source_url,
          mainPageUrl: page.url,
          directPdfLinks: links.length,
          subpagesDiscovered: subpages.length,
          subpagesVisited: 0,
          pdfLinksAfterExpansion: 0,
          examCandidates: 0,
          definitiveAnswerKeyCandidates: 0,
          unmatchedExams: 0
        };
        report.sourceDiagnostics.push(diagnostics);
        for (const subpage of subpages) {
          try {
            const subpageResource = await fetchOfficialResource(subpage.url, {
              fetchImpl,
              maxBytes: MAX_HTML_BYTES
            });
            if (subpageResource.isPdf) continue;
            diagnostics.subpagesVisited += 1;
            const subpageHtml = new TextDecoder("utf-8").decode(subpageResource.bytes);
            links.push(...extractOfficialPdfLinks(subpageHtml, subpageResource.url));
          } catch (error) {
            report.failures.push({
              source: subpage.url,
              reason: "Página intermediária oficial: " + String(error?.message || error).slice(0, 350)
            });
          }
          await sleep(250);
        }
        const uniqueLinks = [...new Map(links.map(link => [link.url, link])).values()];
        diagnostics.pdfLinksAfterExpansion = uniqueLinks.length;
        diagnostics.pdfLinkCandidates = uniqueLinks.slice(0, 30).map(link => ({
          label: link.label,
          url: link.url,
          kind: classifyOfficialPdfLink(link, pageText, record.notes)
        }));
        const { exams, keys } = resolveExamAndKeyLinks(record, uniqueLinks, pageText);
        diagnostics.examCandidates = exams.length;
        diagnostics.definitiveAnswerKeyCandidates = keys.length;
        for (const examLink of exams) {
          if (report.documentsChecked >= maxDocs) break;
          const keyLink = pairExamWithAnswerKey(examLink, keys, exams.length);
          if (!keyLink) {
            diagnostics.unmatchedExams += 1;
            report.unmatchedDocuments.push({
              source: record.source_url,
              proof: examLink.url,
              reason: "Não existe gabarito definitivo associado de forma inequívoca ao caderno."
            });
            continue;
          }
          report.documentsChecked += 1;
          try {
            await processDocument(record, examLink, keyLink, mode, report.runId, report, fetchImpl);
          } catch (error) {
            if (error?.code === "UNMATCHED_ANSWER_KEY_SECTION") {
              report.unmatchedDocuments.push({
                source: record.source_url,
                proof: examLink.url,
                answerKey: keyLink.url,
                reason: String(error?.message || error).slice(0, 1600)
              });
            } else {
              report.failures.push({
                source: record.source_url,
                proof: examLink.url,
                answerKey: keyLink.url,
                reason: String(error?.message || error).slice(0, 500)
              });
            }
          }
          await sleep(350);
        }
      } catch (error) {
        report.failures.push({ source: record.source_url, reason: String(error?.message || error).slice(0, 500) });
      } finally {
        // Marca cada fonte consultada para que o próximo ciclo avance para
        // outras bancas em vez de reprocessar indefinidamente a mesma lista.
        if (runCreated && record.id) {
          try {
            await supabaseRest("study_exam_sources?id=eq." + encodeURIComponent(record.id), {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ last_ingested_at: new Date().toISOString(), last_ingested_run: report.runId, updated_at: new Date().toISOString() })
            });
          } catch (error) {
            report.failures.push({
              source: record.source_url,
              reason: "Não foi possível atualizar o cursor da fonte: " + String(error?.message || error).slice(0, 350)
            });
          }
        }
      }
      await sleep(500);
    }
  } finally {
    report.completedAt = new Date().toISOString();
    if (runCreated) {
      const status = report.failures.length ? ((report.published || report.staged) ? "partial" : "failed") : "completed";
      await finishRun(report.runId, report, status);
    }
  }
  return report;
}

function parseArgs(argv) {
  const args = { mode: process.env.EXAM_IMPORT_MODE || "dry-run", limit: MAX_DOCUMENTS_PER_RUN };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mode") args.mode = argv[++index];
    else if (argv[index] === "--limit") args.limit = Number(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error("Argumento desconhecido: " + argv[index]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Uso: node scripts/automatic-official-exam-ingestion.mjs [--mode dry-run|stage|publish] [--limit 1..15]");
    return;
  }
  const report = await runAutomaticOfficialExamIngestion(args);
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(process.env.GITHUB_OUTPUT, "published=" + report.published + "\nstaged=" + report.staged + "\nready=" + report.readyToPublish + "\nfailures=" + report.failures.length + "\n");
  }
  if (process.env.INGESTION_REPORT_PATH) {
    await import("node:fs/promises").then(fs => fs.mkdir(path.dirname(process.env.INGESTION_REPORT_PATH), { recursive: true }));
    await writeFile(process.env.INGESTION_REPORT_PATH, output + "\n", { flag: "w" });
  }
  if (report.mode !== "dry-run" && report.failures.length && report.processedDocuments === 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
