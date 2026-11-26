#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";
import { validateTrustedOfficialUrl, resolveTrustedOfficialUrl } from "./monitor-sources.mjs";
import { assertSupabaseServiceCredential } from "./supabase-credentials.mjs";
import {
  extractPdfPages,
  parseExamPages,
  sha256,
  normalizeQuestionText,
  MAX_PDF_BYTES
} from "./import-official-exam-pdf.mjs";

export const MAX_SOURCE_CANDIDATES = 120;
export const MAX_PDF_PAIRS_PER_RUN = 20;
export const MAX_QUESTIONS_PER_RUN = 120;
export const MAX_PDF_BYTES_PER_DOCUMENT = Math.min(MAX_PDF_BYTES, 25 * 1024 * 1024);
export const MAX_REDIRECTS = 5;
export const MIN_ANSWER_KEY_COVERAGE = 0.9;
export const MIN_AUTOMATIC_SCORE = 98;

const USER_AGENT = "EditalRadar-OfficialExamImporter/1.0 (+https://github.com/dagamavasco170-lang/editalradar)";
const RESTRICTED_REUSE_PATTERN = /\b(?:reprodu[cç][aã]o\s+(?:total|parcial)\s+(?:é|e)\s+proibida|proibida?\s+a\s+reprodu[cç][aã]o|reprodu[cç][aã]o\s+vedada|uso\s+comercial\s+proibido|redistribui[cç][aã]o\s+proibida)\b/i;
const PRELIMINARY_KEY_PATTERN = /\b(?:gabarito|respostas?)\s+(?:oficiais?\s+)?preliminar(?:es)?\b|\bpreliminar(?:es)?\s+(?:do\s+)?gabarito\b/i;
const FINAL_KEY_PATTERN = /\b(?:gabarito|respostas?)\s+(?:oficiais?\s+)?(?:definitiv[oa]s?|final(?:is)?)\b|\b(?:definitiv[oa]s?|final(?:is)?)\s+(?:do\s+)?gabarito\b|\bpadr[aã]o\s+de\s+respostas\s+definitivo\b/i;
const NON_STANDALONE_PATTERN = /\b(?:leia\s+o\s+texto|texto\s+(?:a\s+seguir|abaixo|acima|anexo)|com\s+base\s+no\s+texto|de\s+acordo\s+com\s+o\s+texto|observe\s+(?:a|o)\s+(?:figura|imagem|tabela|gr[aá]fico|mapa|charge|tirinha)|conforme\s+(?:a\s+)?figura|na\s+figura|no\s+gr[aá]fico|na\s+tabela|no\s+mapa|a\s+charge|a\s+tirinha|o\s+poema|a\s+imagem)\b/i;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function isAutomaticPublishEnabled(env = process.env) {
  return String(env.EXAM_IMPORT_ENABLE_AUTOMATIC_PUBLISH || "").toLowerCase() === "true";
}

function safeText(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

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

function officialPageHasExamEvidence(raw = {}) {
  const text = [
    raw.status, raw.vinculo, raw.observacao, raw.notes, raw.exam_name,
    raw.title, raw.cargo, raw.orgao, raw.gabarito, raw.etapa
  ].map(value => String(value || "")).join(" ");
  if (/\b(?:gabarito|caderno\s+de\s+provas?|prova\s+(?:foi\s+)?(?:aplicada|realizada)|resultado\s+(?:preliminar|final)|homologa[cç][aã]o|etapa\s+objetiva\s+conclu[ií]da)\b/i.test(text)) {
    return true;
  }
  const match = text.match(/\bprova(?:\s+objetiva)?(?:\s+est[aá])?\s+prevista\s+para\s+(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/i);
  if (match) {
    const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59));
    return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
  }
  return false;
}

export function buildExamSourceCandidates({ officialSources = [], catalog = [], staticContests = concursos } = {}) {
  const byKey = new Map();
  const add = (raw, kind) => {
    if (!raw || typeof raw !== "object") return;
    const source = raw.source_url || raw.sourceUrl || raw.source;
    if (!source) return;
    let sourceUrl;
    try { sourceUrl = validateTrustedOfficialUrl(source).href; } catch { return; }

    const examName = safeText(
      raw.exam_name || raw.examName || raw.vinculo ||
      [raw.orgao || raw.organization, raw.cargo || raw.role_name || raw.role].filter(Boolean).join(" — "),
      180
    );
    const examYear = parseYear(raw.exam_year, raw.examYear, raw.ano, raw.vinculo, examName, raw.observacao, raw.notes);
    if (!examName || !examYear) return;
    if (kind !== "registered_official_exam" && !officialPageHasExamEvidence(raw)) return;

    const row = {
      board: safeText(raw.board || raw.banca || raw.bancaOrganizadora || inferBoardFromOfficialUrl(sourceUrl), 80),
      exam_name: examName,
      exam_year: examYear,
      discipline: safeText(raw.discipline || raw.disciplina || "Diversas disciplinas", 100),
      topic: safeText(raw.topic || "A classificar", 160),
      difficulty: ["Fácil","Intermediária","Avançada"].includes(raw.difficulty) ? raw.difficulty : "Intermediária",
      role_name: safeText(raw.role_name || raw.cargo || raw.role || "", 180),
      source_url: sourceUrl,
      exam_url: raw.exam_url || raw.exam_pdf_url || null,
      answer_key_url: raw.answer_key_url || raw.gabarito_url || null,
      source_kind: kind
    };
    const key = [row.source_url, row.exam_name, row.exam_year].join("|");
    const old = byKey.get(key);
    if (!old || (row.exam_url && row.answer_key_url)) byKey.set(key, row);
  };

  for (const row of officialSources || []) add(row, "registered_official_exam");
  for (const row of catalog || []) add(row.data || row, "catalog");
  for (const row of staticContests || []) add(row, "static_catalog");
  return [...byKey.values()].slice(0, MAX_SOURCE_CANDIDATES);
}

export function extractOfficialPdfLinks(html, pageUrl) {
  const found = new Map();
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    const label = safeText(decodeEntities(match[2].replace(/<[^>]+>/g, " ")), 240);
    if (!href) continue;
    try {
      const url = validateTrustedOfficialUrl(new URL(href, pageUrl).href);
      const signal = (label + " " + url.pathname + " " + url.search).toLocaleLowerCase("pt-BR");
      if (!/\.pdf(?:$|[?#])|(?:prova|caderno|gabarito|respostas?).{0,40}\.pdf|\.pdf.{0,40}(?:prova|caderno|gabarito)/i.test(signal)) continue;
      found.set(url.href, { url: url.href, label });
    } catch {
      // Hosts externos e redirecionadores não permitidos são ignorados.
    }
  }
  return [...found.values()];
}

function variantToken(value) {
  const normalized = normalizeQuestionText(value);
  return normalized.match(/\b(?:tipo|caderno|prova|versao)\s+([a-z0-9]{1,4})\b/)?.[1] || "";
}

export function pairExamAndAnswerPdfs(links, explicitExam = null, explicitKey = null) {
  const all = [...links];
  if (explicitExam && explicitKey) {
    try {
      all.push(
        { url: validateTrustedOfficialUrl(explicitExam).href, label: "Caderno de prova oficial" },
        { url: validateTrustedOfficialUrl(explicitKey).href, label: "Gabarito definitivo oficial" }
      );
    } catch {
      // Explicit pair with a non-official host is not trusted.
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
  if (exams.length === 1 && keys.length === 1) pairs.push({ exam: exams[0], answerKey: keys[0] });
  else {
    for (const exam of exams) {
      const examVariant = variantToken(exam.label + " " + exam.url);
      const matched = keys.filter(key => {
        const keyVariant = variantToken(key.label + " " + key.url);
        return examVariant && keyVariant
          ? examVariant === keyVariant
          : !examVariant && !keyVariant && keys.length === 1;
      });
      if (matched.length === 1) pairs.push({ exam, answerKey: matched[0] });
    }
  }
  return [...new Map(pairs.map(pair => [pair.exam.url + "|" + pair.answerKey.url, pair])).values()];
}

function parsePageMetadata(html) {
  const source = String(html || "");
  const title = safeText(decodeEntities(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ") || ""), 240);
  const heading = safeText(decodeEntities(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") || ""), 240);
  const text = decodeEntities(source
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim().slice(0, 60000);
  return { title, heading, text };
}

export async function readBoundedResponse(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) throw new Error("Documento oficial acima do limite de tamanho.");
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Documento oficial acima do limite de tamanho.");
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
        throw new Error("Documento oficial acima do limite de tamanho.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchOfficialDocument(url, {
  maxBytes = MAX_PDF_BYTES_PER_DOCUMENT,
  timeoutMs = 20000,
  fetchImpl = fetch
} = {}) {
  let currentUrl = validateTrustedOfficialUrl(url).href;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw new Error("Limite de redirecionamentos excedido.");
      currentUrl = resolveTrustedOfficialUrl(currentUrl, response.headers.get("location"));
      continue;
    }
    if (response.status === 429) {
      const error = new Error("Fonte oficial respondeu HTTP 429; adiada para o próximo ciclo.");
      error.code = "SOURCE_RATE_LIMITED";
      throw error;
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error("Fonte oficial bloqueou a coleta; nenhum bypass será tentado.");
      error.code = "SOURCE_RESTRICTED";
      throw error;
    }
    if (!response.ok) throw new Error("Fonte oficial respondeu HTTP " + response.status + ".");
    const finalUrl = validateTrustedOfficialUrl(response.url || currentUrl).href;
    return {
      bytes: await readBoundedResponse(response, maxBytes),
      contentType: String(response.headers.get("content-type") || "").toLowerCase(),
      finalUrl
    };
  }
  throw new Error("Falha ao obter documento oficial.");
}

export function parseOfficialAnswerKey(pages, context = "") {
  const text = (pages || []).map(page => String(page.text || "")).join("\n");
  const evidence = String(context || "") + "\n" + text;
  if (PRELIMINARY_KEY_PATTERN.test(evidence)) {
    return { valid: false, reason: "Gabarito preliminar.", answers: new Map(), annulled: new Set(), conflicts: new Set() };
  }
  if (!FINAL_KEY_PATTERN.test(evidence)) {
    return { valid: false, reason: "Gabarito não identificado como definitivo/final.", answers: new Map(), annulled: new Set(), conflicts: new Set() };
  }
  const answers = new Map();
  const conflicts = new Set();
  const annulled = new Set();
  for (const line of text.split(/\r?\n/)) {
    const cancelled = line.match(/\b(?:quest(?:ã|a)o|item)\s*0*(\d{1,3})\b[^\n]{0,100}\b(?:anulad[oa]|cancelad[oa])\b/i);
    if (cancelled) {
      annulled.add(Number(cancelled[1]));
      continue;
    }
    const regex = /(?:^|\s)(?:quest(?:ã|a)o\s*)?0*(\d{1,3})\s*(?:[).:\-]\s*|\s+)([A-E])\b/giu;
    for (const match of line.matchAll(regex)) {
      const number = Number(match[1]);
      const answer = String(match[2]).toLowerCase();
      if (!Number.isInteger(number) || number < 1 || number > 300) continue;
      if (/\b(?:anulad[oa]|cancelad[oa])\b/i.test(line)) {
        annulled.add(number);
        continue;
      }
      const prior = answers.get(number);
      if (prior && prior !== answer) conflicts.add(number);
      else answers.set(number, answer);
    }
  }
  for (const number of conflicts) answers.delete(number);
  return {
    valid: answers.size >= 5,
    reason: answers.size >= 5 ? "" : "Poucas respostas legíveis no gabarito definitivo.",
    answers, annulled, conflicts
  };
}

export function validateQuestionForAutomaticPublication(question, key, {
  sourceOfficial = false,
  answerKeyOfficial = false,
  duplicateFree = false,
  sourceRestrictionsClear = false
} = {}) {
  const prompt = safeText(question?.prompt, 5000);
  const options = Array.isArray(question?.options) ? question.options : [];
  const ids = options.map(option => String(option?.id || "").toLowerCase());
  const uniqueTexts = new Set(options.map(option => normalizeQuestionText(option?.text)));
  const answer = key?.answers?.get(Number(question?.source_question_number)) || "";
  const trueFalse = ids.join(",") === "c,e"
    && normalizeQuestionText(options[0]?.text) === "certo"
    && normalizeQuestionText(options[1]?.text) === "errado";
  const multipleChoice = [4,5].includes(options.length)
    && ids.join(",") === options.map((_,index)=>String.fromCharCode(97+index)).join(",");
  const structure = prompt.length >= 40 && prompt.length <= 5000
    && (multipleChoice || trueFalse)
    && options.every(option => String(option?.text||"").trim().length >= (trueFalse?2:8)
      && String(option?.text||"").trim().length <= 1200)
    && uniqueTexts.size === options.length;
  const visual = NON_STANDALONE_PATTERN.test(prompt)
    || /Possível dependência de imagem|figura|tabela|mapa|texto externo/i.test(String(question?.review_notes || ""));
  const standalone = !visual;
  const noVisualDependency = !visual;
  const textQuality = [prompt,...options.map(option=>String(option?.text||""))]
    .every(value => value.length >= 2 && !value.includes("\uFFFD") && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value));
  const ocr = Boolean(question?.ocr_used);
  const plausibleOCR = !ocr || (
    prompt.length >= 60
    && (trueFalse || options.every(option=>String(option?.text||"").length>=12))
    && !/[|]{2,}|[_]{5,}/.test(prompt)
  );
  const answerMatch = Boolean(answer && ids.includes(answer));
  const checks = {
    source_official: sourceOfficial,
    answer_key_official: answerKeyOfficial,
    final_answer_key: key?.valid === true,
    question_structure: structure,
    standalone_text: standalone,
    no_visual_dependency: noVisualDependency,
    answer_match: answerMatch,
    duplicate_free: duplicateFree,
    extraction_integrity: textQuality && plausibleOCR,
    source_restrictions_clear: sourceRestrictionsClear
  };
  const eligible = Object.values(checks).every(Boolean);
  return { eligible, score: eligible ? (ocr?98:100) : 0, answer, checks, reason: Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name).join(", ") };
}

async function supabaseRequest(baseUrl, key, url, init = {}) {
  const response = await fetch(baseUrl + url, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const details = await response.text().catch(()=> "");
    throw new Error("Supabase HTTP " + response.status + ": " + details.slice(0,500));
  }
  if(response.status===204)return null;
  const text=await response.text();
  return text?JSON.parse(text):null;
}

function q(value) { return encodeURIComponent(String(value)); }

async function startRun(baseUrl,key) {
  const rows=await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_import_runs",{method:"POST",body:JSON.stringify({status:"running"})});
  const row=Array.isArray(rows)?rows[0]:rows;
  if(!row?.id)throw new Error("Não foi possível registrar a execução.");
  return row.id;
}

async function finishRun(baseUrl,key,id,metrics,status,summary) {
  await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_import_runs?id=eq."+q(id),{
    method:"PATCH",
    body:JSON.stringify({...metrics,status,summary,completed_at:new Date().toISOString()})
  });
}

async function listExistingFingerprints(baseUrl,key,table,board,exam,year,column) {
  const params=new URLSearchParams({
    select:column,
    board:"eq."+board,
    exam_name:"eq."+exam,
    exam_year:"eq."+year,
    limit:"10000"
  });
  if(table==="study_questions")params.set("origin","eq.exam_import");
  const rows=await supabaseRequest(baseUrl,key,"/rest/v1/"+table+"?"+params.toString());
  return new Set((rows||[]).map(row=>String(row[column]||"")).filter(Boolean));
}

async function publishQueuedImport(row,baseUrl,key,metrics) {
  const attempt=Math.min(3,Math.max(0,Number(row.auto_publish_attempts)||0)+1);
  await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_question_imports?id=eq."+q(row.id),{
    method:"PATCH",
    body:JSON.stringify({auto_publish_attempts:attempt,last_auto_publish_attempt_at:new Date().toISOString()})
  });
  try {
    const result=await supabaseRequest(baseUrl,key,"/rest/v1/rpc/publish_study_exam_question_import",{
      method:"POST",
      body:JSON.stringify({
        p_import_id:row.id,
        p_answer:row.suggested_answer,
        p_explanation:"Gabarito extraído do documento oficial definitivo da banca. Consulte a publicação original.",
        p_review_notes:"Publicação automática após verificações determinísticas de origem, gabarito, estrutura, integridade, autonomia textual e deduplicação.",
        p_admin_confirmation:false,
        p_automated:true,
        p_auto_quality_score:Number(row.auto_quality_score),
        p_validation_checks:row.validation_checks
      })
    });
    if(result===null){metrics.questions_skipped+=1;return "duplicate";}
    metrics.questions_published+=1;
    return "published";
  } catch(error) {
    if(attempt>=3) {
      await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_question_imports?id=eq."+q(row.id),{
        method:"PATCH",
        body:JSON.stringify({status:"rejected",review_notes:safeText("Falha após três tentativas: "+error.message,4000),reviewed_at:new Date().toISOString()})
      }).catch(()=>{});
    }
    throw error;
  }
}

async function retryPendingImports(baseUrl,key,metrics) {
  const params=new URLSearchParams({
    select:"id,suggested_answer,auto_quality_score,validation_checks,auto_publish_attempts",
    status:"eq.pending",
    review_method:"eq.automated",
    auto_publish_attempts:"lt.3",
    order:"created_at.asc",
    limit:"100"
  });
  const pending=await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_question_imports?"+params.toString());
  const errors=[];
  for(const row of pending||[]) {
    metrics.questions_retried+=1;
    try { await publishQueuedImport(row,baseUrl,key,metrics); }
    catch(error) { errors.push({id:row.id,error:safeText(error.message,400)}); }
  }
  return errors;
}

async function processExamPair(candidate,pair,pageMetadata,baseUrl,key,metrics,seenFingerprints) {
  const [examDoc,keyDoc]=await Promise.all([
    fetchOfficialDocument(pair.exam.url),
    fetchOfficialDocument(pair.answerKey.url)
  ]);
  metrics.pdfs_downloaded+=2;
  if(examDoc.bytes.subarray(0,5).toString("ascii")!=="%PDF-"||keyDoc.bytes.subarray(0,5).toString("ascii")!=="%PDF-") {
    throw new Error("Um dos documentos não possui assinatura PDF.");
  }
  const examHash=sha256(examDoc.bytes);
  const keyHash=sha256(keyDoc.bytes);
  const temp=await mkdtemp(path.join(os.tmpdir(),"editalradar-exam-"));
  try {
    const examPath=path.join(temp,"exam.pdf"),keyPath=path.join(temp,"key.pdf");
    await Promise.all([writeFile(examPath,examDoc.bytes),writeFile(keyPath,keyDoc.bytes)]);
    const examText=await extractPdfPages(examPath);
    const keyText=await extractPdfPages(keyPath);
    if([...examText.warnings,...keyText.warnings].some(x=>x.startsWith("Limite de OCR aplicado"))) {
      metrics.questions_skipped+=1;
      return {published:0,skipped:1,reason:"OCR incompleto acima do limite de páginas."};
    }
    const answerKey=parseOfficialAnswerKey(keyText.pages,pair.answerKey.label+" "+pair.answerKey.url);
    if(!answerKey.valid) {
      metrics.questions_skipped+=1;
      return {published:0,skipped:1,reason:answerKey.reason};
    }
    const questionFormat=/cebraspe/i.test(candidate.board)
      && /\bITEM\s+0*\d+/i.test(examText.pages.map(x=>x.text||"").join("\n"))
      ? "true_false" : "multiple_choice";
    const questions=parseExamPages(examText.pages,examHash,{questionFormat});
    if(questions.length<5) {
      metrics.questions_skipped+=questions.length||1;
      return {published:0,skipped:questions.length||1,reason:"Menos de cinco questões objetivas estruturadas."};
    }
    const covered=questions.filter(x=>answerKey.answers.has(x.source_question_number)||answerKey.annulled.has(x.source_question_number)).length;
    if(covered/questions.length<MIN_ANSWER_KEY_COVERAGE) {
      metrics.questions_skipped+=questions.length;
      return {published:0,skipped:questions.length,reason:"Cobertura do gabarito definitivo inferior a 90%."};
    }

    const examBody=examText.pages.map(x=>x.text||"").join("\n");
    const keyBody=keyText.pages.map(x=>x.text||"").join("\n");
    const restrictionsClear=!(RESTRICTED_REUSE_PATTERN.test(pageMetadata.text||"")
      ||RESTRICTED_REUSE_PATTERN.test(examBody)
      ||RESTRICTED_REUSE_PATTERN.test(keyBody));
    const existingQuestions=await listExistingFingerprints(baseUrl,key,"study_questions",candidate.board,candidate.exam_name,candidate.exam_year,"source_fingerprint");
    const existingQueue=await listExistingFingerprints(baseUrl,key,"study_exam_question_imports",candidate.board,candidate.exam_name,candidate.exam_year,"fingerprint");
    const pending=[];
    for(const question of questions) {
      const answer=answerKey.answers.get(question.source_question_number);
      if(!answer||answerKey.annulled.has(question.source_question_number)) {
        metrics.questions_skipped+=1;continue;
      }
      const duplicateFree=!existingQuestions.has(question.fingerprint)
        &&!existingQueue.has(question.fingerprint)
        &&!seenFingerprints.has(question.fingerprint);
      const validation=validateQuestionForAutomaticPublication(question,answerKey,{
        sourceOfficial:true,answerKeyOfficial:true,duplicateFree,sourceRestrictionsClear:restrictionsClear
      });
      if(!validation.eligible) {
        metrics.questions_skipped+=1;continue;
      }
      seenFingerprints.add(question.fingerprint);
      pending.push({
        board:candidate.board,
        exam_name:candidate.exam_name,
        exam_year:candidate.exam_year,
        discipline:candidate.discipline,
        topic:candidate.topic,
        difficulty:candidate.difficulty,
        question_format:questionFormat,
        role_name:candidate.role_name,
        source_url:candidate.source_url,
        exam_pdf_url:examDoc.finalUrl,
        answer_key_url:keyDoc.finalUrl,
        answer_key_sha256:keyHash,
        source_document_sha256:examHash,
        source_page:question.source_page,
        source_question_number:question.source_question_number,
        prompt:question.prompt,
        options:question.options,
        suggested_answer:answer,
        fingerprint:question.fingerprint,
        rights_basis:"official_publication",
        official_release_verified:true,
        rights_holder:candidate.board,
        license_proof_url:null,
        source_terms_url:null,
        source_restrictions:restrictionsClear?"Nenhuma restrição expressa identificada nos documentos consultados.":"Restrição expressa detectada; publicação automática bloqueada.",
        source_license:null,
        source_attribution:"Prova e gabarito publicados na fonte oficial da banca/órgão.",
        rights_review_status:"not_reviewed",
        review_method:"automated",
        auto_quality_score:validation.score,
        validation_checks:validation.checks,
        status:"pending",
        review_notes:safeText(question.review_notes||"Extração automatizada estruturada.",4000),
        created_by:null
      });
    }
    metrics.questions_extracted+=questions.length;
    if(!pending.length)return {published:0,skipped:questions.length,reason:"Nenhuma questão atingiu os critérios automáticos."};
    const batch=pending.slice(0,Math.max(0,MAX_QUESTIONS_PER_RUN-metrics.questions_published));
    if(!batch.length)return {published:0,skipped:pending.length,reason:"Limite de publicações desta execução alcançado."};
    const query=new URLSearchParams({on_conflict:"source_document_sha256,source_page,source_question_number"});
    const inserted=await supabaseRequest(baseUrl,key,"/rest/v1/study_exam_question_imports?"+query.toString(),{
      method:"POST",
      headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
      body:JSON.stringify(batch)
    });
    let published=0;
    for(const row of inserted||[]) {
      if(!row.suggested_answer)continue;
      const result=await publishQueuedImport(row,baseUrl,key,metrics);
      if(result==="published")published+=1;
    }
    metrics.questions_skipped+=Math.max(0,pending.length-(inserted||[]).length);
    return {published,skipped:Math.max(0,pending.length-(inserted||[]).length),reason:""};
  } finally {
    await rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}

export async function runAutomaticExamImport(options={}) {
  const env=options.env||process.env;
  if(!isAutomaticPublishEnabled(env)) {
    throw new Error("Publicação automática desativada. Defina EXAM_IMPORT_ENABLE_AUTOMATIC_PUBLISH=true apenas no workflow de produção.");
  }
  const baseUrl=String(options.supabaseUrl||env.SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(options.serviceKey||env.SUPABASE_SERVICE_ROLE_KEY||"");
  if(!baseUrl||new URL(baseUrl).protocol!=="https:"||!key) {
    throw new Error("SUPABASE_URL HTTPS e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no worker.");
  }
  assertSupabaseServiceCredential(key);
  const runId=await startRun(baseUrl,key);
  const metrics={
    sources_scanned:0,pages_scanned:0,pdf_pairs_found:0,pdfs_downloaded:0,
    questions_extracted:0,questions_published:0,questions_retried:0,questions_skipped:0,errors_count:0
  };
  const errors=[];
  try {
    errors.push(...await retryPendingImports(baseUrl,key,metrics));
    const [registered,rawCatalog]=await Promise.all([
      supabaseRequest(baseUrl,key,"/rest/v1/study_exam_sources?"+new URLSearchParams({
        select:"board,exam_name,exam_year,discipline,role_name,source_url,exam_url,answer_key_url,notes",
        published:"eq.true",order:"exam_year.desc",limit:"500"
      })),
      supabaseRequest(baseUrl,key,"/rest/v1/contest_catalog?"+new URLSearchParams({
        select:"data",deleted:"eq.false",limit:"1000"
      }))
    ]);
    const candidates=buildExamSourceCandidates({officialSources:registered||[],catalog:rawCatalog||[]});
    metrics.sources_scanned=candidates.length;
    const results=[];
    const concurrency=Math.max(1,Math.min(4,Number(env.EXAM_IMPORT_CONCURRENCY)||3));
    for(let offset=0;offset<candidates.length;offset+=concurrency) {
      const group=candidates.slice(offset,offset+concurrency);
      const scanned=await Promise.all(group.map(async candidate=>{
        try {
          const explicit=pairExamAndAnswerPdfs([],candidate.exam_url,candidate.answer_key_url);
          if(explicit.length)return {candidate,pairs:explicit,pageMetadata:{title:candidate.exam_name,heading:candidate.exam_name,text:candidate.notes||""}};
          const pageDoc=await fetchOfficialDocument(candidate.source_url,{maxBytes:4*1024*1024,timeoutMs:15000});
          if(!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(pageDoc.contentType))return {candidate,pairs:[],pageMetadata:{title:"",heading:"",text:""}};
          metrics.pages_scanned+=1;
          const pageMetadata=parsePageMetadata(pageDoc.bytes.toString("utf8"));
          return {candidate,pairs:pairExamAndAnswerPdfs(extractOfficialPdfLinks(pageDoc.bytes.toString("utf8"),pageDoc.finalUrl)),pageMetadata};
        } catch(error) {
          errors.push({source:candidate.source_url,error:safeText(error.message,400)});
          return {candidate,pairs:[],pageMetadata:{title:"",heading:"",text:""}};
        }
      }));
      results.push(...scanned);
    }
    const allPairs=[];
    const seenPairs=new Set();
    for(const item of results)for(const pair of item.pairs) {
      const pairKey=pair.exam.url+"|"+pair.answerKey.url;
      if(seenPairs.has(pairKey))continue;
      seenPairs.add(pairKey);
      allPairs.push({...item,pair});
    }
    metrics.pdf_pairs_found=allPairs.length;
    const maxPairs=Math.min(MAX_PDF_PAIRS_PER_RUN,Math.max(1,Number(env.EXAM_IMPORT_MAX_PAIRS)||20),allPairs.length);
    const seenFingerprints=new Set();
    for(const item of allPairs.slice(0,maxPairs)) {
      try {
        await processExamPair(item.candidate,item.pair,item.pageMetadata,baseUrl,key,metrics,seenFingerprints);
      } catch(error) {
        errors.push({source:item.pair.exam.url,error:safeText(error.message,500)});
      }
      if(metrics.questions_published>=MAX_QUESTIONS_PER_RUN)break;
    }
    metrics.errors_count=errors.length;
    const status=errors.length===0?"completed":metrics.questions_published?"partial":"failed";
    await finishRun(baseUrl,key,runId,metrics,status,{errors:errors.slice(0,50),pairs_processed:maxPairs,candidates:candidates.length});
    return {runId,status,...metrics,errors};
  } catch(error) {
    metrics.errors_count+=1;
    await finishRun(baseUrl,key,runId,metrics,"failed",{fatal:safeText(error.message,500)}).catch(()=>{});
    throw error;
  }
}

async function main() {
  const result=await runAutomaticExamImport();
  const summary=[
    "## Importação automática de questões oficiais",
    "",
    "- Fontes analisadas: "+result.sources_scanned,
    "- Páginas oficiais consultadas: "+result.pages_scanned,
    "- Pares prova + gabarito definitivo: "+result.pdf_pairs_found,
    "- PDFs baixados: "+result.pdfs_downloaded,
    "- Questões extraídas: "+result.questions_extracted,
    "- Questões publicadas: "+result.questions_published,
    "- Tentativas recuperadas: "+result.questions_retried,
    "- Questões descartadas: "+result.questions_skipped,
    "- Falhas técnicas: "+result.errors_count,
    "",
    ...result.errors.slice(0,15).map(error=>"- "+error.source+": "+error.error)
  ].join("\n");
  console.log(summary);
  const {appendFile}=await import("node:fs/promises");
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary+"\n");
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,[
    "status="+result.status,
    "published="+result.questions_published,
    "retried="+result.questions_retried,
    "skipped="+result.questions_skipped,
    "errors="+result.errors_count,
    "run_id="+result.runId,
    ""
  ].join("\n"));
  if(result.status==="failed")process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{
    console.error("Falha na importação automática:",error?.stack||error?.message||error);
    process.exitCode=1;
  });
}
