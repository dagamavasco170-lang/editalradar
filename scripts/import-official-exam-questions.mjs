#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";
import { validateTrustedOfficialUrl, resolveTrustedOfficialUrl } from "./monitor-sources.mjs";
import { assertSupabaseServiceCredential } from "./supabase-credentials.mjs";
import { extractPdfPages, parseExamPages, sha256, normalizeQuestionText, MAX_PDF_BYTES } from "./import-official-exam-pdf.mjs";

export const MAX_SOURCE_PAGES = 120;
export const MAX_PDF_BYTES_PER_DOCUMENT = Math.min(MAX_PDF_BYTES, 25 * 1024 * 1024);
export const MAX_QUESTIONS_PER_RUN = 120;
export const MAX_REDIRECTS = 5;
export const MIN_ANSWER_KEY_MATCH_RATIO = 0.9;
export const AUTO_QUALITY_MINIMUM = 98;

const USER_AGENT = "EditalRadar-OfficialExamImporter/1.0 (+https://github.com/dagamavasco170-lang/editalradar)";
const RESTRICTED_REUSE_PATTERN = /\b(?:reprodu[cç][aã]o\s+(?:total|parcial)\s+(?:é|e)\s+proibida|proibida?\s+a\s+reprodu[cç][aã]o|reprodu[cç][aã]o\s+vedada|uso\s+comercial\s+proibido|redistribui[cç][aã]o\s+proibida)\b/i;
const PRELIMINARY_KEY_PATTERN = /\b(?:gabarito|respostas?)\s+(?:oficiais?\s+)?preliminar(?:es)?\b|\bpreliminar(?:es)?\s+(?:do\s+)?gabarito\b/i;
const FINAL_KEY_PATTERN = /\b(?:gabarito|respostas?)\s+(?:oficiais?\s+)?(?:definitiv[oa]s?|final(?:is)?)\b|\b(?:definitiv[oa]s?|final(?:is)?)\s+(?:do\s+)?gabarito\b/i;
const NON_STANDALONE_PATTERN = /\b(?:leia\s+o\s+texto|texto\s+(?:a\s+seguir|abaixo|acima|anexo)|com\s+base\s+no\s+texto|de\s+acordo\s+com\s+o\s+texto|observe\s+(?:a|o)\s+(?:figura|imagem|tabela|gr[aá]fico|mapa|charge|tirinha)|conforme\s+(?:a\s+)?figura|na\s+figura|no\s+gr[aá]fico|na\s+tabela|no\s+mapa|a\s+charge|a\s+tirinha|o\s+poema|a\s+imagem)\b/i;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function safeText(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseYear(...values) {
  for (const value of values) {
    const match = String(value || "").match(/\b(20\d{2})\b/);
    if (match) {
      const year = Number(match[1]);
      if (year >= 1900 && year <= 2200) return year;
    }
  }
  return null;
}

function inferBoard(value) {
  const explicit = safeText(value, 80);
  if (explicit) return explicit;
  return "Organizadora oficial";
}

export function inferBoardFromOfficialUrl(value) {
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { return "Organizadora oficial"; }
  if (host.includes("cebraspe")) return "Cebraspe";
  if (host.includes("fgv")) return "FGV";
  if (host.includes("fcc")) return "FCC";
  if (host.includes("vunesp")) return "Vunesp";
  if (host.includes("aocp")) return "Instituto AOCP";
  if (host.includes("ibfc")) return "IBFC";
  if (host.includes("quadrix")) return "Quadrix";
  if (host.includes("fundacaolasalle")) return "Fundação La Salle";
  if (host.includes("cesgranrio")) return "Fundação Cesgranrio";
  return "Organizadora oficial";
}

function officialPageHasExamEvidence(data = {}) {
  const source = [
    data.status, data.vinculo, data.observacao, data.notes, data.exam_name,
    data.title, data.cargo, data.orgao, data.gabarito, data.etapa
  ].map(value => String(value || "")).join(" ");
  if (/\b(?:gabarito|caderno\s+de\s+provas?|prova\s+(?:foi\s+)?(?:aplicada|realizada)|resultado\s+(?:preliminar|final)|homologa[cç][aã]o|etapa\s+objetiva\s+conclu[ií]da)\b/i.test(source)) {
    return true;
  }
  const dateMatch = source.match(/\bprova(?:\s+objetiva)?(?:\s+est[aá])?\s+prevista\s+para\s+(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/i);
  if (dateMatch) {
    const date = new Date(Date.UTC(Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1]), 23, 59, 59));
    return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
  }
  return false;
}

export function buildExamSourceCandidates({ catalog = [], officialSources = [], staticContests = concursos } = {}) {
  const bySource = new Map();
  const add = (raw, kind) => {
    if (!raw || typeof raw !== "object") return;
    const sourceUrl = raw.source_url || raw.sourceUrl || raw.exam_source_url;
    if (!sourceUrl) return;
    let safeUrl;
    try { safeUrl = validateTrustedOfficialUrl(sourceUrl).href; } catch { return; }

    const examName = safeText(
      raw.exam_name || raw.examName ||
      [raw.orgao || raw.organization, raw.vinculo || raw.edital || raw.cargo || raw.role_name || raw.role].filter(Boolean).join(" — "),
      180
    );
    const year = parseYear(raw.exam_year, raw.examYear, raw.ano, raw.vinculo, examName, raw.observacao, raw.notes);
    if (!examName || !year) return;
    if ((kind === "catalog" || kind === "static_catalog") && !officialPageHasExamEvidence(raw)) return;

    const board = inferBoard(raw.board || raw.banca || raw.bancaOrganizadora || raw.organizer)
      || inferBoardFromOfficialUrl(safeUrl);
    const candidate = {
      board: board === "Organizadora oficial" ? inferBoardFromOfficialUrl(safeUrl) : board,
      exam_name: examName,
      exam_year: year,
      discipline: safeText(raw.discipline || raw.disciplina || "Diversas disciplinas", 100),
      topic: "A classificar",
      difficulty: "Intermediária",
      role_name: safeText(raw.role_name || raw.cargo || raw.role || "", 180),
      source_url: safeUrl,
      exam_pdf_url: raw.exam_url || raw.exam_pdf_url || null,
      answer_key_url: raw.answer_key_url || raw.gabarito_url || null,
      answer_key_label: raw.answer_key_label || raw.gabarito_label || "",
      source_kind: kind
    };
    const key = [candidate.source_url, candidate.exam_name, candidate.exam_year].join("|");
    const previous = bySource.get(key);
    if (!previous || (candidate.exam_pdf_url && candidate.answer_key_url)) bySource.set(key, candidate);
  };

  for (const row of officialSources) add(row, "registered_official_exam");
  for (const row of catalog) add(row.data || row, "catalog");
  for (const row of staticContests || []) add(row, "static_catalog");
  return [...bySource.values()].slice(0, MAX_SOURCE_PAGES);
}

export function extractOfficialPdfLinks(html, pageUrl) {
  const found = new Map();
  const source = String(html || "");
  const anchors = source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);
  for (const match of anchors) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const rawHref = decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    const label = safeText(decodeEntities(match[2].replace(/<[^>]+>/g, " ")), 240);
    if (!rawHref) continue;
    try {
      const url = validateTrustedOfficialUrl(new URL(rawHref, pageUrl).href);
      const signal = (label + " " + url.pathname + " " + url.search).toLocaleLowerCase("pt-BR");
      if (!/\.pdf(?:$|[?#])|(?:prova|caderno|gabarito|respostas?).{0,30}\.pdf|\.pdf.{0,30}(?:prova|caderno|gabarito)/i.test(signal)) continue;
      const normalized = url.href;
      found.set(normalized, { url: normalized, label });
    } catch {
      // Links para terceiros e redirecionadores desconhecidos não entram na fila.
    }
  }
  return [...found.values()];
}

function variantToken(value) {
  const normalized = normalizeQuestionText(value);
  const match = normalized.match(/\b(?:tipo|caderno|prova|versao)\s+([a-z0-9]{1,4})\b/);
  return match ? match[1] : "";
}

export function pairExamAndAnswerPdfs(links, fallbackExamUrl = null, fallbackAnswerUrl = null, fallbackLabel = "") {
  const all = [...links];
  if (fallbackExamUrl && fallbackAnswerUrl) {
    try {
      all.push({ url: validateTrustedOfficialUrl(fallbackExamUrl).href, label: "Caderno oficial" });
      all.push({ url: validateTrustedOfficialUrl(fallbackAnswerUrl).href, label: fallbackLabel || "Gabarito definitivo" });
    } catch {
      // O par será ignorado se algum dos documentos não tiver origem oficial verificável.
    }
  }

  const unique = [...new Map(all.map(item => [item.url, item])).values()];
  const exams = unique.filter(item =>
    /\b(?:prova|caderno|questoes|questoes objetivas)\b/i.test(item.label + " " + item.url)
    && !/\b(?:gabarito|respostas?|preliminar)\b/i.test(item.label + " " + item.url)
  );
  const keys = unique.filter(item =>
    /\b(?:gabarito|respostas?)\b/i.test(item.label + " " + item.url)
    && !PRELIMINARY_KEY_PATTERN.test(item.label + " " + item.url)
  );
  const pairs = [];

  if (exams.length === 1 && keys.length === 1) {
    pairs.push({ exam: exams[0], answerKey: keys[0] });
  } else {
    for (const exam of exams) {
      const examVariant = variantToken(exam.label + " " + exam.url);
      const matched = keys.filter(key => {
        const keyVariant = variantToken(key.label + " " + key.url);
        return examVariant && keyVariant ? examVariant === keyVariant : !examVariant && !keyVariant && keys.length === 1;
      });
      if (matched.length === 1) pairs.push({ exam, answerKey: matched[0] });
    }
  }
  return [...new Map(pairs.map(pair => [pair.exam.url + "|" + pair.answerKey.url, pair])).values()];
}

function parseAnchorPageMetadata(html) {
  const source = String(html || "");
  const title = safeText(decodeEntities(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, " "), 240);
  const heading = safeText(decodeEntities(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, " "), 240);
  const visible = decodeEntities(source
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { title, heading, text: visible.slice(0, 60000) };
}

export async function readBoundedResponse(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) throw new Error("O documento oficial excede o limite de tamanho permitido.");
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("O documento oficial excede o limite de tamanho permitido.");
    return Buffer.from(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("O documento oficial excede o limite de tamanho permitido.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchOfficialDocument(url, { maxBytes = MAX_PDF_BYTES_PER_DOCUMENT, timeoutMs = 20000, fetchImpl = fetch, maxRedirects = MAX_REDIRECTS } = {}) {
  let currentUrl = validateTrustedOfficialUrl(url).href;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) throw new Error("A fonte oficial excedeu o limite de redirecionamentos.");
      currentUrl = resolveTrustedOfficialUrl(currentUrl, response.headers?.get?.("location"));
      continue;
    }
    if (response.status === 429) {
      const error = new Error("Fonte oficial limitou a coleta (HTTP 429); o item será tentado no próximo ciclo.");
      error.code = "SOURCE_RATE_LIMITED";
      error.retryAfter = response.headers?.get?.("retry-after") || "";
      throw error;
    }
    if (response.status === 403 || response.status === 401) {
      const error = new Error("A fonte oficial bloqueou o acesso automatizado; o sistema não tentará contornar o bloqueio.");
      error.code = "SOURCE_RESTRICTED";
      throw error;
    }
    if (!response.ok) throw new Error("Fonte oficial respondeu HTTP " + response.status + ".");
    const finalUrl = validateTrustedOfficialUrl(response.url || currentUrl).href;
    const bytes = await readBoundedResponse(response, maxBytes);
    return {
      bytes,
      contentType: String(response.headers?.get?.("content-type") || "").toLowerCase(),
      finalUrl,
      status: response.status
    };
  }
  throw new Error("Não foi possível baixar o documento oficial.");
}

export function parseOfficialAnswerKey(pages, context = "") {
  const text = (pages || []).map(page => String(page.text || "")).join("\n");
  const evidence = String(context || "") + "\n" + text;
  if (PRELIMINARY_KEY_PATTERN.test(evidence)) {
    return { valid: false, reason: "O documento identifica o gabarito como preliminar.", answers: new Map(), annulled: new Set() };
  }
  if (!FINAL_KEY_PATTERN.test(evidence)) {
    return { valid: false, reason: "Não foi possível confirmar que o gabarito é definitivo/final.", answers: new Map(), annulled: new Set() };
  }

  const answers = new Map();
  const conflicts = new Set();
  const annulled = new Set();
  for (const line of text.split(/\r?\n/)) {
    const annulledMatch = line.match(/\b(?:quest(?:ã|a)o|item)\s*0*(\d{1,3})\b[^\n]{0,80}\b(?:anulad[oa]|cancelad[oa])\b/i);
    if (annulledMatch) {
      annulled.add(Number(annulledMatch[1]));
      continue;
    }
    const pattern = /(?:^|\s)(?:quest(?:ã|a)o\s*)?0*(\d{1,3})\s*(?:[).:\-]\s*|\s+)([A-E])\b/giu;
    for (const match of line.matchAll(pattern)) {
      const number = Number(match[1]);
      const answer = String(match[2]).toLowerCase();
      if (!Number.isInteger(number) || number < 1 || number > 300) continue;
      if (/\b(?:anulad[oa]|cancelad[oa])\b/i.test(line)) {
        annulled.add(number);
        continue;
      }
      const previous = answers.get(number);
      if (previous && previous !== answer) conflicts.add(number);
      else answers.set(number, answer);
    }
  }
  for (const number of conflicts) answers.delete(number);
  return {
    valid: answers.size >= 5,
    reason: answers.size >= 5 ? "" : "O gabarito definitivo não contém linhas suficientes identificáveis automaticamente.",
    answers,
    annulled,
    conflicts
  };
}

export function validateQuestionForAutomaticPublication(question, answerKey, options = {}) {
  const prompt = safeText(question?.prompt, 5000);
  const alternatives = Array.isArray(question?.options) ? question.options : [];
  const answer = answerKey?.answers?.get(Number(question?.source_question_number)) || "";
  const ids = alternatives.map(option => String(option?.id || "").toLowerCase());
  const expectedIds = ids.map((_, index) => String.fromCharCode(97 + index));
  const uniqueTexts = new Set(alternatives.map(option => normalizeQuestionText(option?.text)));
  const hasVisualDependency = NON_STANDALONE_PATTERN.test(prompt)
    || /Possível dependência de imagem|figura|tabela|mapa|texto externo/i.test(String(question?.review_notes || ""));
  const textQuality = [prompt, ...alternatives.map(option => String(option?.text || ""))]
    .every(value => value.length >= 2 && !value.includes("\uFFFD") && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value));
  const hasOCR = Boolean(question?.ocr_used);
  const plausibleOCR = !hasOCR || (
    prompt.length >= 60
    && alternatives.every(option => String(option.text || "").length >= 12)
    && !/[|]{2,}|[_]{5,}|[^\p{L}\p{N}\s.,;:!?()[\]{}'"%ºª-]{5,}/u.test(prompt)
  );
  const structure = prompt.length >= 40 && prompt.length <= 5000
    && [4, 5].includes(alternatives.length)
    && ids.join(",") === expectedIds.join(",")
    && alternatives.every(option => String(option.text || "").trim().length >= 8 && String(option.text || "").trim().length <= 1200)
    && uniqueTexts.size === alternatives.length;
  const answerMatches = Boolean(answer && ids.includes(answer));
  const standalone = !hasVisualDependency && !NON_STANDALONE_PATTERN.test(prompt);
  const extractionIntegrity = textQuality && plausibleOCR;
  const checks = {
    source_official: options.sourceOfficial === true,
    answer_key_official: options.answerKeyOfficial === true,
    final_answer_key: answerKey?.valid === true,
    question_structure: structure,
    standalone_text: standalone,
    no_visual_dependency: !hasVisualDependency,
    answer_match: answerMatches,
    duplicate_free: options.duplicateFree === true,
    extraction_integrity: extractionIntegrity,
    source_restrictions_clear: options.sourceRestrictionsClear === true
  };
  const score = Object.values(checks).every(Boolean) ? (hasOCR ? 98 : 100) : 0;
  return {
    eligible: score >= AUTO_QUALITY_MINIMUM,
    score,
    answer,
    checks,
    reason: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(", ")
  };
}

async function supabaseRequest(url, serviceKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: serviceKey,
      ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + serviceKey }),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Supabase REST respondeu HTTP " + response.status + ": " + detail.slice(0, 500));
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function listAllRows(baseUrl, serviceKey, table, query, pageSize = 1000, maxRows = 20000) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const url = baseUrl + "/rest/v1/" + table + "?" + query;
    const result = await supabaseRequest(url + (query.includes("limit=") ? "" : "&limit=" + pageSize), serviceKey, {
      headers: { Range: offset + "-" + (offset + pageSize - 1), "Range-Unit": "items" }
    });
    if (!Array.isArray(result) || !result.length) break;
    rows.push(...result);
    if (result.length < pageSize) break;
  }
  return rows;
}

function buildQuery(params) {
  return new URLSearchParams(params).toString();
}

function extractFinalPairFromSourceRow(row) {
  if (!row?.exam_url || !row?.answer_key_url) return [];
  try {
    const exam = validateTrustedOfficialUrl(row.exam_url);
    const answerKey = validateTrustedOfficialUrl(row.answer_key_url);
    if (!/\.pdf(?:$|[?#])/i.test(exam.href) || !/\.pdf(?:$|[?#])/i.test(answerKey.href)) return [];
    return [{ exam: { url: exam.href, label: "Caderno de prova oficial" }, answerKey: { url: answerKey.href, label: safeText(row.answer_key_url, 240) } }];
  } catch {
    return [];
  }
}

async function scanOfficialPage(candidate, options = {}) {
  const page = await fetchOfficialDocument(candidate.source_url, {
    maxBytes: 4 * 1024 * 1024,
    timeoutMs: options.timeoutMs || 15000,
    fetchImpl: options.fetchImpl || fetch
  });
  if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(page.contentType)) {
    return { pairs: [], pageMetadata: { title: "", heading: "", text: "" }, pageUrl: page.finalUrl };
  }
  const html = page.bytes.toString("utf8");
  const metadata = parseAnchorPageMetadata(html);
  const links = extractOfficialPdfLinks(html, page.finalUrl);
  const pairs = pairExamAndAnswerPdfs(links);
  return { pairs, pageMetadata: metadata, pageUrl: page.finalUrl };
}

function buildMetadata(candidate, pageMetadata, pair) {
  const combined = [pageMetadata.title, pageMetadata.heading, pageMetadata.text].join(" ");
  const year = parseYear(candidate.exam_year, combined, pair.exam.label, pair.exam.url);
  const examName = candidate.exam_name || safeText(pageMetadata.heading || pageMetadata.title, 180);
  const sourceUrl = candidate.source_url;
  return {
    board: candidate.board || inferBoardFromOfficialUrl(sourceUrl),
    exam_name: examName,
    exam_year: year,
    discipline: candidate.discipline || "Diversas disciplinas",
    topic: candidate.topic || "A classificar",
    difficulty: candidate.difficulty || "Intermediária",
    role_name: candidate.role_name || "",
    source_url: sourceUrl,
    exam_pdf_url: pair.exam.url,
    rights_basis: "official_publication",
    official_release_verified: true,
    rights_holder: candidate.board || inferBoardFromOfficialUrl(sourceUrl),
    source_restrictions: "",
    answer_key_url: pair.answerKey.url
  };
}

async function persistRunStart(baseUrl, serviceKey) {
  const result = await supabaseRequest(baseUrl + "/rest/v1/study_exam_import_runs", serviceKey, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running" })
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.id) throw new Error("Não foi possível registrar o início da execução de importação.");
  return row.id;
}

async function persistRunFinish(baseUrl, serviceKey, runId, metrics, status, details) {
  await supabaseRequest(baseUrl + "/rest/v1/study_exam_import_runs?id=eq." + encodeURIComponent(runId), serviceKey, {
    method: "PATCH",
    body: JSON.stringify({
      ...metrics,
      status,
      summary: details,
      completed_at: new Date().toISOString()
    })
  });
}

async function publishQueuedImport(row, options, metrics) {
  const attempt = Math.min(3, Math.max(0, Number(row.auto_publish_attempts) || 0) + 1);
  await supabaseRequest(options.supabaseUrl + "/rest/v1/study_exam_question_imports?id=eq." + encodeURIComponent(row.id), options.serviceKey, {
    method: "PATCH",
    body: JSON.stringify({
      auto_publish_attempts: attempt,
      last_auto_publish_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });

  try {
    const result = await supabaseRequest(options.supabaseUrl + "/rest/v1/rpc/publish_study_exam_question_import", options.serviceKey, {
      method: "POST",
      body: JSON.stringify({
        p_import_id: row.id,
        p_answer: String(row.suggested_answer || ""),
        p_explanation: "Gabarito extraído do documento oficial definitivo da banca. Consulte a publicação original.",
        p_review_notes: "Aprovação automática: fonte oficial, prova e gabarito definitivo identificados; estrutura, integridade, autonomia textual e deduplicação validadas.",
        p_admin_confirmation: false,
        p_automated: true,
        p_auto_quality_score: Number(row.auto_quality_score),
        p_validation_checks: row.validation_checks
      })
    });
    if (result === null) {
      metrics.questions_skipped += 1;
      return "duplicate";
    }
    metrics.questions_published += 1;
    return "published";
  } catch (error) {
    if (attempt >= 3) {
      await supabaseRequest(options.supabaseUrl + "/rest/v1/study_exam_question_imports?id=eq." + encodeURIComponent(row.id), options.serviceKey, {
        method: "PATCH",
        body: JSON.stringify({
          status: "rejected",
          review_notes: safeText("Rejeitada automaticamente após três falhas de publicação: " + error.message, 4000),
          reviewed_at: new Date().toISOString(),
          review_method: "automated",
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});
    }
    throw error;
  }
}

async function retryPendingAutomaticImports(options, metrics) {
  const params = buildQuery({
    select: "id,suggested_answer,auto_quality_score,validation_checks,auto_publish_attempts",
    status: "eq.pending",
    review_method: "eq.automated",
    order: "created_at.asc",
    limit: "100"
  });
  const pending = await supabaseRequest(options.supabaseUrl + "/rest/v1/study_exam_question_imports?" + params, options.serviceKey);
  const errors = [];
  for (const row of pending || []) {
    metrics.questions_retried += 1;
    try {
      await publishQueuedImport(row, options, metrics);
    } catch (error) {
      errors.push({ import_id: row.id, error: safeText(error.message, 400) });
    }
  }
  return errors;
}

async function getExistingFingerprints(baseUrl, serviceKey, board, examName, examYear) {
  const params = buildQuery({
    select: "source_fingerprint",
    origin: "eq.exam_import",
    published: "eq.true",
    board: "eq." + board,
    exam_name: "eq." + examName,
    exam_year: "eq." + examYear,
    limit: "10000"
  });
  const rows = await supabaseRequest(baseUrl + "/rest/v1/study_questions?" + params, serviceKey);
  return new Set((rows || []).map(row => String(row.source_fingerprint || "")).filter(Boolean));
}

async function getExistingQueueFingerprints(baseUrl, serviceKey, board, examName, examYear) {
  const params = buildQuery({
    select: "fingerprint",
    board: "eq." + board,
    exam_name: "eq." + examName,
    exam_year: "eq." + examYear,
    limit: "10000"
  });
  const rows = await supabaseRequest(baseUrl + "/rest/v1/study_exam_question_imports?" + params, serviceKey);
  return new Set((rows || []).map(row => String(row.fingerprint || "")).filter(Boolean));
}

async function processPair(candidate, pair, pageMetadata, metrics, options) {
  const [examDocument, keyDocument] = await Promise.all([
    fetchOfficialDocument(pair.exam.url, options),
    fetchOfficialDocument(pair.answerKey.url, options)
  ]);
  metrics.pdfs_downloaded += 2;
  if (examDocument.bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    || keyDocument.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Um dos documentos encontrados não possui assinatura PDF válida.");
  }

  const examSha = sha256(examDocument.bytes);
  const answerKeySha = sha256(keyDocument.bytes);
  const directory = await mkdtemp(path.join(os.tmpdir(), "editalradar-auto-exam-"));
  try {
    const examPath = path.join(directory, "exam.pdf");
    const keyPath = path.join(directory, "answer-key.pdf");
    await Promise.all([
      writeFile(examPath, examDocument.bytes),
      writeFile(keyPath, keyDocument.bytes)
    ]);
    const [examExtraction, answerExtraction] = await Promise.all([
      extractPdfPages(examPath),
      extractPdfPages(keyPath)
    ]);
    if (examExtraction.warnings.some(item => item.startsWith("Limite de OCR aplicado"))
      || answerExtraction.warnings.some(item => item.startsWith("Limite de OCR aplicado"))) {
      metrics.questions_skipped += 1;
      return { published: 0, skipped: 1, reason: "OCR excedeu o limite de páginas; documento incompleto." };
    }

    const answerContext = pair.answerKey.label + " " + pair.answerKey.url;
    const key = parseOfficialAnswerKey(answerExtraction.pages, answerContext);
    if (!key.valid) {
      metrics.questions_skipped += 1;
      return { published: 0, skipped: 1, reason: key.reason };
    }

    const metadata = buildMetadata(candidate, pageMetadata, pair);
    if (!metadata.exam_year || !metadata.exam_name || metadata.exam_name.length < 2) {
      metrics.questions_skipped += 1;
      return { published: 0, skipped: 1, reason: "Não foi possível identificar com segurança o concurso e o ano." };
    }
    const questions = parseExamPages(examExtraction.pages, examSha, { questionFormat: "multiple_choice" });
    if (!questions.length || questions.length < 5) {
      metrics.questions_skipped += Math.max(1, questions.length);
      return { published: 0, skipped: Math.max(1, questions.length), reason: "O parser não encontrou ao menos cinco questões objetivas estruturadas." };
    }
    const covered = questions.filter(question => key.answers.has(question.source_question_number) || key.annulled.has(question.source_question_number)).length;
    if (covered / questions.length < MIN_ANSWER_KEY_MATCH_RATIO) {
      metrics.questions_skipped += questions.length;
      return { published: 0, skipped: questions.length, reason: "A correspondência entre questões e gabarito definitivo ficou abaixo de 90%." };
    }

    const existing = await getExistingFingerprints(options.supabaseUrl, options.serviceKey, metadata.board, metadata.exam_name, metadata.exam_year);
    const existingQueue = await getExistingQueueFingerprints(options.supabaseUrl, options.serviceKey, metadata.board, metadata.exam_name, metadata.exam_year);
    const localSeen = new Set();
    const pending = [];
    const skippedReasons = [];
    const pageRestriction = RESTRICTED_REUSE_PATTERN.test(pageMetadata.text || "");
    const examRestriction = RESTRICTED_REUSE_PATTERN.test(examExtraction.pages.map(page => page.text).join("\n"));
    const keyRestriction = RESTRICTED_REUSE_PATTERN.test(answerExtraction.pages.map(page => page.text).join("\n"));
    const sourceRestrictionsClear = !(pageRestriction || examRestriction || keyRestriction);

    for (const question of questions) {
      const answer = key.answers.get(question.source_question_number);
      if (!answer || key.annulled.has(question.source_question_number)) {
        metrics.questions_skipped += 1;
        continue;
      }
      const duplicateFree = !existing.has(question.fingerprint)
        && !existingQueue.has(question.fingerprint)
        && !localSeen.has(question.fingerprint);
      const validation = validateQuestionForAutomaticPublication(question, key, {
        sourceOfficial: Boolean(validateTrustedOfficialUrl(examDocument.finalUrl).href),
        answerKeyOfficial: Boolean(validateTrustedOfficialUrl(keyDocument.finalUrl).href),
        duplicateFree,
        sourceRestrictionsClear
      });
      if (!validation.eligible) {
        metrics.questions_skipped += 1;
        skippedReasons.push({
          question: question.source_question_number,
          reason: validation.reason || "A questão não alcançou a pontuação mínima."
        });
        continue;
      }
      localSeen.add(question.fingerprint);
      pending.push({
        board: metadata.board,
        exam_name: metadata.exam_name,
        exam_year: metadata.exam_year,
        discipline: metadata.discipline,
        topic: metadata.topic,
        difficulty: metadata.difficulty,
        role_name: metadata.role_name,
        source_url: candidate.source_url,
        exam_pdf_url: examDocument.finalUrl,
        answer_key_url: keyDocument.finalUrl,
        answer_key_sha256: answerKeySha,
        source_document_sha256: examSha,
        source_page: question.source_page,
        source_question_number: question.source_question_number,
        prompt: question.prompt,
        options: question.options,
        suggested_answer: answer,
        fingerprint: question.fingerprint,
        rights_basis: "official_publication",
        official_release_verified: true,
        rights_holder: metadata.rights_holder,
        license_proof_url: null,
        source_terms_url: null,
        source_restrictions: sourceRestrictionsClear ? "Nenhuma restrição expressa de reprodução identificada no material examinado." : "Restrição expressa encontrada; publicação automática bloqueada.",
        source_license: null,
        source_attribution: "Prova e gabarito publicados na fonte oficial da banca/órgão.",
        rights_review_status: "not_reviewed",
        review_method: "automated",
        auto_quality_score: validation.score,
        validation_checks: validation.checks,
        status: "pending",
        review_notes: safeText("Validação automática concluída. " + (question.ocr_used ? "OCR usado na página; pontuação mínima reforçada." : "Extração textual nativa.") + " " + question.review_notes, 4000),
        created_by: null
      });
    }

    metrics.questions_extracted += questions.length;
    if (!pending.length) {
      return { published: 0, skipped: questions.length, reason: skippedReasons.slice(0, 10) };
    }

    const availableSlots = Math.max(0, MAX_QUESTIONS_PER_RUN - metrics.questions_published);
    const boundedPending = pending.slice(0, availableSlots);
    metrics.questions_skipped += Math.max(0, pending.length - boundedPending.length);
    if (!boundedPending.length) return { published: 0, skipped: pending.length, reason: "Limite diário por execução alcançado." };
    const insertUrl = options.supabaseUrl + "/rest/v1/study_exam_question_imports?on_conflict=source_document_sha256,source_question_number";
    const insertedResponse = await supabaseRequest(insertUrl, options.serviceKey, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(boundedPending)
    });
    const inserted = Array.isArray(insertedResponse) ? insertedResponse : [];
    let published = 0;
    for (const row of inserted) {
      if (!row.suggested_answer) {
        metrics.questions_skipped += 1;
        continue;
      }
      const result = await publishQueuedImport(row, options, metrics);
      if (result === "published") published += 1;
    }
    metrics.questions_skipped += Math.max(0, pending.length - inserted.length);
    return { published, skipped: Math.max(0, pending.length - inserted.length), reason: skippedReasons.slice(0, 10) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runAutomaticExamImport(options = {}) {
  const supabaseUrl = String(options.supabaseUrl || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = String(options.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || new URL(supabaseUrl).protocol !== "https:" || !serviceKey) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY HTTPS para a ingestão automática.");
  }
  assertSupabaseServiceCredential(serviceKey);
  const runId = await persistRunStart(supabaseUrl, serviceKey);
  const metrics = {
    sources_scanned: 0, pages_scanned: 0, pdf_pairs_found: 0, pdfs_downloaded: 0,
    questions_extracted: 0, questions_published: 0, questions_retried: 0, questions_skipped: 0, errors_count: 0
  };
  const errors = [];
  try {
    errors.push(...await retryPendingAutomaticImports({ supabaseUrl, serviceKey }, metrics));
    const [officialRows, catalogRows] = await Promise.all([
      supabaseRequest(supabaseUrl + "/rest/v1/study_exam_sources?" + buildQuery({
        select: "board,exam_name,exam_year,discipline,role_name,source_url,exam_url,answer_key_url,notes",
        published: "eq.true", order: "exam_year.desc", limit: "500"
      }), serviceKey),
      supabaseRequest(supabaseUrl + "/rest/v1/contest_catalog?" + buildQuery({
        select: "data", deleted: "eq.false", limit: "1000"
      }), serviceKey)
    ]);
    const candidates = buildExamSourceCandidates({ catalog: catalogRows || [], officialSources: officialRows || [] });
    metrics.sources_scanned = candidates.length;
    const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 3));
    const queue = [];
    for (let index = 0; index < candidates.length; index += concurrency) {
      const batch = candidates.slice(index, index + concurrency);
      const outcomes = await Promise.all(batch.map(async candidate => {
        try {
          let pageMetadata = { title: "", heading: "", text: "" };
          let pairs = extractFinalPairFromSourceRow((officialRows || []).find(row =>
            row.source_url === candidate.source_url
            && row.exam_name === candidate.exam_name
            && Number(row.exam_year) === candidate.exam_year
          ) || {});
          if (!pairs.length) {
            const scanned = await scanOfficialPage(candidate, options);
            metrics.pages_scanned += 1;
            pageMetadata = scanned.pageMetadata;
            pairs = scanned.pairs;
          }
          return { candidate, pageMetadata, pairs };
        } catch (error) {
          errors.push({ source: candidate.source_url, error: safeText(error.message, 400) });
          return { candidate, pageMetadata: { title: "", heading: "", text: "" }, pairs: [] };
        }
      }));
      queue.push(...outcomes);
    }

    const pairQueue = [];
    const seenPairs = new Set();
    for (const entry of queue) {
      for (const pair of entry.pairs) {
        const key = pair.exam.url + "|" + pair.answerKey.url;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        pairQueue.push({ ...entry, pair });
      }
    }
    metrics.pdf_pairs_found = pairQueue.length;

    const pairLimit = Math.min(pairQueue.length, Math.max(1, Number(options.maxPairs) || 20));
    for (const entry of pairQueue.slice(0, pairLimit)) {
      try {
        const result = await processPair(entry.candidate, entry.pair, entry.pageMetadata, metrics, {
          ...options, supabaseUrl, serviceKey
        });
        // Skips are expected for preliminary keys, incomplete PDFs, visual questions and duplicates.
        // They are counted separately and do not turn a healthy cycle into a failed run.
      } catch (error) {
        metrics.errors_count += 1;
        errors.push({ source: entry.pair.exam.url, error: safeText(error.message, 500) });
      }
      if (metrics.questions_published >= MAX_QUESTIONS_PER_RUN) break;
    }
    metrics.errors_count = errors.length;
    const status = metrics.errors_count === 0 ? "completed" : (metrics.questions_published ? "partial" : "failed");
    await persistRunFinish(supabaseUrl, serviceKey, runId, metrics, status, {
      errors: errors.slice(0, 60),
      pairs_processed: pairLimit,
      candidates: candidates.length
    });
    return { runId, status, ...metrics, errors };
  } catch (error) {
    metrics.errors_count += 1;
    await persistRunFinish(supabaseUrl, serviceKey, runId, metrics, "failed", { fatal: safeText(error.message, 500) }).catch(() => {});
    throw error;
  }
}

async function main() {
  const result = await runAutomaticExamImport({
    concurrency: Number(process.env.EXAM_IMPORT_CONCURRENCY) || 3,
    maxPairs: Number(process.env.EXAM_IMPORT_MAX_PAIRS) || 20
  });
  const summary = [
    "## Importação automática de questões oficiais",
    "",
    "- Fontes descobertas/analisadas: " + result.sources_scanned,
    "- Páginas oficiais consultadas: " + result.pages_scanned,
    "- Pares de PDFs prova+gabarito definitivo identificados: " + result.pdf_pairs_found,
    "- PDFs baixados: " + result.pdfs_downloaded,
    "- Questões extraídas: " + result.questions_extracted,
    "- Questões publicadas automaticamente: " + result.questions_published,
    "- Questões descartadas/duplicadas: " + result.questions_skipped,
    "- Falhas: " + result.errors_count,
    "",
    result.errors.slice(0, 15).map(item => "- " + item.source + ": " + item.error).join("\n")
  ].filter(Boolean).join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, [
      "status=" + result.status,
      "published=" + result.questions_published,
      "retried=" + result.questions_retried,
      "skipped=" + result.questions_skipped,
      "errors=" + result.errors_count,
      "run_id=" + result.runId,
      ""
    ].join("\n"));
  }
  if (result.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error("Falha na ingestão automática de provas oficiais:", error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
