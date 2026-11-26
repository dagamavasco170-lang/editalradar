#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";
import { validateTrustedOfficialUrl, resolveTrustedOfficialUrl } from "./monitor-sources.mjs";
import { normalizeQuestionText, MAX_PDF_BYTES } from "./import-official-exam-pdf.mjs";

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
  const multipleChoiceStructure = [4,5].includes(alternatives.length)
    && ids.join(",") === expectedIds.join(",");
  const trueFalseStructure = ids.join(",") === "c,e"
    && normalizeQuestionText(alternatives[0]?.text) === "certo"
    && normalizeQuestionText(alternatives[1]?.text) === "errado";
  const structure = prompt.length >= 40 && prompt.length <= 5000
    && (multipleChoiceStructure || trueFalseStructure)
    && alternatives.every(option => String(option.text || "").trim().length >= 2 && String(option.text || "").trim().length <= 1200)
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



/**
 * The former network-to-Supabase publisher is intentionally disabled.
 * Keep discovery and deterministic validation helpers for tests and future
 * work, but any import must go through a local manifest and a human admin review.
 */
export async function runAutomaticExamImport() {
  throw new Error(
    "A ingestão automática e a publicação de questões estão desativadas. " +
    "Gere um manifesto com o importador local e envie-o à fila de revisão administrativa."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(
    "Este módulo não executa ingestão com service_role. " +
    "Use: npm run import:official-exam-pdf"
  );
  process.exitCode = 1;
}
