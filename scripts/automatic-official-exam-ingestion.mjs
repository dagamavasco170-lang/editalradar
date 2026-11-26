#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";
import { isTrustedOfficialUrl } from "../src/lib/official-sources.js";
import { extractPdfPages, importPdfToManifest, sha256 } from "./import-official-exam-pdf.mjs";

export const MAX_SOURCE_PAGES = 120;
export const MAX_DOCUMENTS_PER_RUN = 12;
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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, digits) => {
      const code = Number(digits);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, digits) => {
      const code = Number.parseInt(digits, 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function stripTags(value) {
  return decodeEntities(String(value || "")
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
  return decodeEntities(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function safeOfficialUrl(value, base) {
  let url;
  try { url = base ? new URL(value, base) : new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !isTrustedOfficialUrl(url.href)) return null;
  url.hash = "";
  return url.href;
}

export function extractOfficialPdfLinks(html, pageUrl) {
  const found = new Map();
  const source = String(html || "");
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = safeOfficialUrl(decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]), pageUrl);
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
    const rawHref = decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]);
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
    const residue = line
      .replace(/\b(?:\d{1,3}|ANULADA|[A-F]|X)\b/gi, "")
      .replace(/[\s|,;:.()\-–—/]+/g, "");
    if (residue) {
      // Cabeçalhos de cargo, páginas e textos auxiliares nunca são dados do gabarito.
      pendingNumbers = [];
      continue;
    }

    const isNumber = token => /^\d{1,3}$/.test(token);
    const isAnswer = token => allowed.has(token) || token === "X";

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

  for (const number of conflicts) answers.delete(number);
  return { answers, conflicts: [...conflicts], parsedCount: answers.size };
}

export function parseOfficialAnswerKey(text, questionFormat = "multiple_choice") {
  return parseAnswerRows(text, questionFormat);
}

export function parseOfficialAnswerKeyVariants(text, questionFormat = "multiple_choice") {
  const sections = [];
  let current = null;
  const headingPattern = /^(.+?)\s*[-–—]\s*(\d{1,2})\s*[-–—]\s*Turno\s+([\p{L}]+)\s*$/iu;

  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(headingPattern);
    if (heading) {
      if (current) sections.push(current);
      current = {
        role: heading[1].trim(),
        bookletNumber: String(Number(heading[2])),
        shift: heading[3].trim(),
        lines: []
      };
      continue;
    }
    if (current) current.lines.push(rawLine);
  }

  if (current) sections.push(current);
  return sections.map(section => {
    const parsed = parseAnswerRows(section.lines.join("\n"), questionFormat);
    return {
      role: section.role,
      bookletNumber: section.bookletNumber,
      shift: section.shift,
      answers: parsed.answers,
      conflicts: parsed.conflicts,
      parsedCount: parsed.parsedCount
    };
  }).filter(section => section.parsedCount > 0);
}

export function selectAnswerKeySection(examLink, record, sections) {
  const examSignal = normalizeDocumentLabel([
    examLink?.label,
    examLink?.url,
    record?.role_name,
    record?.exam_name
  ].join(" "));
  const examVariant = variantIdentity([examLink?.label, examLink?.url].join(" "));
  const matches = (Array.isArray(sections) ? sections : []).filter(section => {
    const role = normalizeDocumentLabel(section.role);
    const roleWords = role.split(" ").filter(word => word.length > 2);
    const roleMatches = Boolean(role) && (
      examSignal.includes(role) || (roleWords.length >= 2 && roleWords.every(word => examSignal.includes(word)))
    );
    const variantMatches = !examVariant || String(section.bookletNumber) === String(Number(examVariant));
    return roleMatches && variantMatches;
  });
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

export function validateQuestionForAutoPublication(question, answer, questionFormat, { ocrAllowed = false } = {}) {
  const reasons = [];
  const prompt = String(question?.prompt || "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  const ids = options.map(option => String(option?.id || "").toLowerCase());
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
  if (/\b(figura|imagem|grafico|tabela|mapa|charge|tirinha|texto a seguir|texto acima)\b/i.test(prompt)) {
    reasons.push("enunciado depende de figura, tabela, gráfico ou texto externo");
  }
  return { approved: reasons.length === 0, reasons, checks: {
    completePrompt: prompt.length >= 20 && prompt.length <= 5000,
    optionsValid: options.length >= 2 && options.length <= 6 && new Set(ids).size === ids.length,
    answerKeyMatches: options.some(option => String(option?.id || "").toLowerCase() === String(answer || "").toLowerCase()),
    parserTextOnly: !question?.ocr_used || ocrAllowed,
    noVisualDependency: !reasons.some(reason => reason.includes("visual") || reason.includes("figura"))
  }};
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

async function loadRegisteredSources() {
  const staticRows = contestContexts();
  if (!authConfigured()) return staticRows;
  const query = new URLSearchParams({
    select: "board,exam_name,exam_year,discipline,role_name,source_url,exam_url,answer_key_url,notes",
    published: "eq.true",
    order: "exam_year.desc",
    limit: "300"
  });
  let rows = [];
  try {
    rows = await supabaseRest("study_exam_sources?" + query.toString()) || [];
  } catch (error) {
    if (!/study_exam_sources|schema cache|does not exist|HTTP 404/i.test(error.message)) throw error;
    console.warn("Tabela de fontes de provas ainda indisponível; usando somente os registros oficiais presentes no catálogo local.");
  }
  const unique = new Map();
  for (const row of [...rows, ...staticRows]) {
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

export async function fetchOfficialResource(initialUrl, { fetchImpl = fetch, maxBytes = MAX_HTML_BYTES, attempts = 2 } = {}) {
  let startUrl = safeOfficialUrl(initialUrl);
  if (!startUrl) throw new Error("URL inicial não é HTTPS ou não pertence a um host oficial autorizado.");
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      let currentUrl = startUrl;
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "EditalRadar-OfficialExamIngestion/1.0",
            Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9"
          },
          signal: AbortSignal.timeout(25000)
        });
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
        const bytes = await readBoundedBody(response, maxBytes);
        return {
          url: finalUrl,
          contentType: String(response.headers.get("content-type") || "").toLowerCase(),
          bytes,
          isPdf: bytes.subarray(0, 5).toString("ascii") === "%PDF-"
        };
      }
    } catch (error) {
      lastError = error;
      if (/HTTP_429|SOURCE_RESTRICTED|não pertence|não autorizado|redirecionamento/i.test(error.message)) throw error;
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

async function processDocument(record, examLink, keyLink, mode, runId, report, fetchImpl = fetch) {
  const proof = await fetchOfficialResource(examLink.url, { fetchImpl, maxBytes: MAX_PDF_BYTES });
  if (!proof.isPdf) throw new Error("O link identificado como prova não retornou um PDF válido.");
  const answerKeyFile = await fetchOfficialResource(keyLink.url, { fetchImpl, maxBytes: MAX_PDF_BYTES });
  if (!answerKeyFile.isPdf) throw new Error("O link identificado como gabarito não retornou um PDF válido.");
  const sourcePage = await fetchOfficialResource(record.source_url, { fetchImpl, maxBytes: MAX_HTML_BYTES });
  if (sourcePage.isPdf) throw new Error("A página oficial de origem retornou um PDF, não uma página de descoberta.");
  const sourceText = stripTags(sourcePage.bytes.toString("utf8"));
  if (!isDefinitiveAnswerKey(keyLink.label + " " + keyLink.url, sourceText, record.notes)) {
    throw new Error("Não foi encontrada evidência inequívoca de que o gabarito é definitivo.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "editalradar-official-ingestion-"));
  try {
    const proofPath = path.join(tempDir, "exam.pdf");
    const keyPath = path.join(tempDir, "answer-key.pdf");
    await writeFile(proofPath, proof.bytes, { flag: "wx" });
    await writeFile(keyPath, answerKeyFile.bytes, { flag: "wx" });
    const proofHash = sha256(proof.bytes);
    const keyHash = sha256(answerKeyFile.bytes);
    const questionFormat = questionFormatFor(record, examLink);
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
    const manifest = await importPdfToManifest({ pdfPath: proofPath, metadata });
    const keyExtraction = await extractPdfPages(keyPath, questionFormat, { splitColumns: false });
    if (keyExtraction.pages.some(page => page.ocrUsed)) {
      throw new Error("O gabarito definitivo depende de OCR; a resposta não será presumida.");
    }
    const definitiveText = keyExtraction.pages.map(page => page.text).join("\n");
    if (!isDefinitiveAnswerKey(keyLink.label + " " + keyLink.url, definitiveText + " " + sourceText, record.notes)) {
      throw new Error("O conteúdo do PDF não confirmou o caráter definitivo do gabarito.");
    }
    const answerKeySections = parseOfficialAnswerKeyVariants(definitiveText, questionFormat);
    let parsedKey;
    if (answerKeySections.length) {
      const matchedSection = selectAnswerKeySection(examLink, record, answerKeySections);
      if (!matchedSection) {
        const error = new Error("O gabarito definitivo consolidado não contém uma única seção que corresponda ao cargo e caderno desta prova.");
        error.code = "UNMATCHED_ANSWER_KEY_SECTION";
        throw error;
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
    const questions = manifest.imports;
    if (!questions.length) throw new Error("O parser não identificou questões objetivas válidas.");
    const coverage = calculateAnswerKeyCoverage(questions, parsedKey.answers);
    const missingAnswers = questions.filter(question => !parsedKey.answers.has(Number(question.source_question_number)));
    if (missingAnswers.length || coverage < MIN_GABARITO_COVERAGE) {
      throw new Error(
        "Correspondência prova/gabarito insuficiente: " + Math.round(coverage * 100)
        + "% do gabarito associado e " + missingAnswers.length + " questão(ões) sem resposta definitiva."
      );
    }
    const output = [];
    for (const question of questions) {
      const officialAnswer = parsedKey.answers.get(Number(question.source_question_number));
      if (!officialAnswer || officialAnswer === "ANULADA") {
        report.annulledOrMissing += 1;
        continue;
      }
      const answer = officialAnswer.toLowerCase();
      const validation = validateQuestionForAutoPublication(question, answer, questionFormat);
      if (!validation.approved) {
        report.quarantined += 1;
        report.quarantineReasons.push({ question: question.source_question_number, reasons: validation.reasons });
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
          sourceHostValidated: true
        }
      });
    }
    if (mode === "publish" && output.length) {
      if (!runId) throw new Error("Execução de publicação sem identificador de auditoria.");
      for (const item of output) {
        const staged = await stageAndPublish(record, item, proof, answerKeyFile, runId);
        if (staged === "published") report.published += 1;
        else if (staged === "duplicate") report.duplicates += 1;
      }
    } else {
      report.readyToPublish += output.length;
    }
    report.processedDocuments += 1;
    report.questionsExtracted += questions.length;
    return { status: output.length ? "eligible" : "quarantined", extracted: questions.length, eligible: output.length, coverage };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
    rights_basis: "official_publication",
    official_release_verified: true,
    rights_holder: record.board,
    license_proof_url: null,
    source_terms_url: null,
    source_restrictions: "",
    source_license: null,
    source_attribution: record.board + " — prova oficial publicada em " + record.source_url,
    rights_review_status: "accepted",
    status: "pending",
    review_notes: "Autovalidação integral concluída; gabarito definitivo oficial conferido. Execução " + runId,
    created_by: null,
    gabarito_source_url: answerKeyFile.url,
    gabarito_document_sha256: evidence.answerKeySha256,
    auto_validation_score: 100,
    auto_validation_evidence: evidence,
    auto_reviewed_at: new Date().toISOString(),
    automation_run_id: runId
  };
  const query = new URLSearchParams({ on_conflict: "board,exam_name,exam_year,fingerprint" });
  let inserted;
  try {
    inserted = await supabaseRest("study_exam_question_imports?" + query.toString(), {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
  } catch (error) {
    if (/HTTP 409|duplicate key|unique constraint/i.test(error.message)) return "duplicate";
    throw error;
  }
  if (!Array.isArray(inserted) || !inserted.length || !inserted[0].id) return "duplicate";
  const publishedId = await supabaseRest("rpc/publish_study_exam_question_import_automated", {
    method: "POST",
    body: JSON.stringify({
      p_import_id: inserted[0].id,
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
    duplicates: 0,
    quarantined: 0,
    annulledOrMissing: 0,
    failures: [],
    quarantineReasons: [],
    unmatchedDocuments: [],
    sourceDiagnostics: []
  };
}

export async function runAutomaticOfficialExamIngestion({ mode = "dry-run", limit = MAX_DOCUMENTS_PER_RUN, fetchImpl = fetch } = {}) {
  if (!["dry-run", "publish"].includes(mode)) throw new Error("Modo inválido; use dry-run ou publish.");
  if (mode === "publish") {
    if (process.env.EXAM_IMPORT_AUTOPUBLISH_ENABLED !== "true") {
      throw new Error("Autopublicação bloqueada: EXAM_IMPORT_AUTOPUBLISH_ENABLED precisa ser true.");
    }
    if (!authConfigured()) throw new Error("Publicação exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }
  const report = createReport(mode);
  const rows = await loadRegisteredSources();
  const cache = new Map();
  const maxDocs = Math.max(1, Math.min(MAX_DOCUMENTS_PER_RUN, Number(limit) || MAX_DOCUMENTS_PER_RUN));
  let runCreated = false;
  if (mode === "publish") {
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
                reason: String(error?.message || error).slice(0, 500)
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
      }
      await sleep(500);
    }
  } finally {
    report.completedAt = new Date().toISOString();
    if (runCreated) {
      const status = report.failures.length ? (report.published ? "partial" : "failed") : "completed";
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
    console.log("Uso: node scripts/automatic-official-exam-ingestion.mjs [--mode dry-run|publish] [--limit 1..12]");
    return;
  }
  const report = await runAutomaticOfficialExamIngestion(args);
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(process.env.GITHUB_OUTPUT, "published=" + report.published + "\nready=" + report.readyToPublish + "\nfailures=" + report.failures.length + "\n");
  }
  if (process.env.INGESTION_REPORT_PATH) {
    await import("node:fs/promises").then(fs => fs.mkdir(path.dirname(process.env.INGESTION_REPORT_PATH), { recursive: true }));
    await writeFile(process.env.INGESTION_REPORT_PATH, output + "\n", { flag: "w" });
  }
  if (report.mode === "publish" && report.failures.length && report.processedDocuments === 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
