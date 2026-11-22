import process from "node:process";
import { execFileSync } from "node:child_process";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DAILY_TOPIC_LIMIT = 3;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos GitHub Actions Secrets.");
}

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json"
};

async function supabaseRest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase REST HTTP ${response.status}: ${body.slice(0, 700)}`);
  }
  return body ? JSON.parse(body) : null;
}

async function callQuestionFactory(payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/question-factory`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(720000)
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`question-factory retornou HTTP ${response.status} sem JSON válido: ${body.slice(0, 700)}`);
  }
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error || result.message || `question-factory HTTP ${response.status}`);
  }
  if (result.setup_required) {
    throw new Error(result.message || "Configure GEMINI_API_KEY no Supabase.");
  }
  return result;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_m, n) => {
      const code = Number.parseInt(n, 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function stripTags(value) {
  return decodeEntities(String(value || "")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside|form|pre|button|select|option)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/main|\/blockquote|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isTrustedHost(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const path = url.pathname.toLowerCase();
    if (/(^|\.)(gov|gov\.br|jus\.br|leg\.br|mp\.br|mil\.br|def\.br)$/.test(host)) return false;
    if (host === "planalto.gov.br" || host.endsWith(".planalto.gov.br")) return false;
    const approvedHosts = [
      "www.politize.com.br", "politize.com.br",
      "pt.wikibooks.org", "pt.wikipedia.org", "pt.wikiversity.org", "pt.wiktionary.org",
      "developer.mozilla.org", "docs.python.org", "www.postgresql.org", "doc.rust-lang.org",
      "docs.github.com", "kubernetes.io", "docs.aws.amazon.com", "docs.docker.com"
    ];
    if (!approvedHosts.includes(host)) return false;
    if (host === "www.postgresql.org" && !path.startsWith("/docs/")) return false;
    if (host === "kubernetes.io" && !path.startsWith("/docs/")) return false;
    if (host === "developer.mozilla.org" && !path.includes("/docs/")) return false;
    return true;
  } catch { return false; }
}

function extractHeadings(html, discipline, currentTopic, sourceUrl) {
  const blacklist = new Set([
    "menu", "conteúdo", "conteudo", "acesso à informação", "acesso a informacao",
    "serviços", "servicos", "governo federal", "navegação", "navegacao",
    "mais notícias", "mais noticias", "veja também", "veja tambem",
    "compartilhe", "buscar no gov.br", "página inicial", "pagina inicial"
  ]);
  const found = new Set();
  const rows = [];
  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/gi)) {
    const heading = stripTags(match[1]).replace(/\s+/g, " ").trim();
    const normalized = heading.toLocaleLowerCase("pt-BR");
    if (heading.length < 6 || heading.length > 150 || blacklist.has(normalized)) continue;
    if (/^(cap[ií]tulo|t[ií]tulo|se[cç][aã]o)\s+[ivxlcdm\d]+\s*$/i.test(heading)) continue;
    if (normalized === String(currentTopic || "").toLocaleLowerCase("pt-BR")) continue;
    if (found.has(normalized)) continue;
    found.add(normalized);
    rows.push({
      discipline,
      topic: heading,
      difficulty: "Intermediária",
      source_url: sourceUrl,
      source_excerpt: null,
      questions_per_run: 3,
      cadence_days: 1,
      active: true,
      created_by: null
    });
  }
  return rows.slice(0, 40);
}

async function fetchStudyText(sourceUrl) {
  if (!isTrustedHost(sourceUrl)) {
    throw new Error("Fonte fora da lista de sites privados com licença ou permissão de reutilização cadastrada.");
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // curl uses the runner's configured network proxy, unlike Node fetch in
      // some hosted runner environments. Follow redirects but validate the
      // final URL before trusting the downloaded material.
      const marker = "\n__EDITALRADAR_SOURCE_META__";
      const raw = execFileSync("curl", [
        "--location", "--fail", "--silent", "--show-error",
        "--connect-timeout", "15", "--max-time", "25",
        "--max-filesize", String(MAX_SOURCE_BYTES),
        "--user-agent", "EditalRadar-GitHub-Automation/1.0",
        "--header", "Accept: text/html, text/plain, application/xhtml+xml;q=0.9",
        "--write-out", marker + "%{content_type}\t%{url_effective}\t%{http_code}",
        sourceUrl
      ], {
        maxBuffer: MAX_SOURCE_BYTES + 128 * 1024,
        timeout: 35000
      });

      const markerBuffer = Buffer.from(marker, "utf8");
      const markerIndex = raw.lastIndexOf(markerBuffer);
      if (markerIndex < 0) throw new Error("Não foi possível validar os metadados da fonte.");
      const meta = raw.subarray(markerIndex + markerBuffer.length).toString("utf8").trim().split("\t");
      const contentType = String(meta[0] || "").toLowerCase();
      const finalUrl = String(meta[1] || "");
      const status = Number(meta[2] || 0);
      if (status !== 200) throw new Error("Fonte respondeu HTTP " + status + ".");
      if (!isTrustedHost(finalUrl)) throw new Error("Redirecionamento para domínio não autorizado.");
      if (!(contentType.includes("html") || contentType.startsWith("text/") || contentType.includes("xml"))) {
        throw new Error("Formato não suportado pelo extrator gratuito: " + (contentType || "desconhecido"));
      }
      if (markerIndex > MAX_SOURCE_BYTES) throw new Error("Fonte excede o limite de 5 MB.");
      const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.replace(/["']/g, "").trim() || "utf-8";
      let html;
      try {
        html = new TextDecoder(charset).decode(raw.subarray(0, markerIndex));
      } catch {
        html = new TextDecoder("utf-8").decode(raw.subarray(0, markerIndex));
      }
      const text = stripTags(html);
      if (text.length < 200) throw new Error("A página não contém texto suficiente para elaborar questões.");
      return { text: text.slice(0, 12000), html, finalUrl };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(String(lastError?.message || lastError || "Falha ao baixar material de estudo licenciado."));
}

async function main() {
  console.log("Etapa 1/4: expandindo automaticamente o catálogo de matérias e assuntos.");
  const seed = await callQuestionFactory({ mode: "scheduled", seed_only: true });
  console.log(`Catálogo disponível: ${seed.topics_available || 0} assuntos.`);

  const topicParams = new URLSearchParams({
    select: "id,discipline,topic,source_url,source_excerpt,active,last_run_at,cadence_days,created_at",
    active: "eq.true",
    order: "last_run_at.asc.nullsfirst,created_at.asc,id.asc",
    limit: "1000"
  });
  const topics = await supabaseRest(`study_question_automation_topics?${topicParams.toString()}`);
  const utcStart = new Date();
  utcStart.setUTCHours(0, 0, 0, 0);
  const runParams = new URLSearchParams({
    select: "id",
    started_at: `gte.${utcStart.toISOString()}`,
    status: "neq.failed",
    limit: String(DAILY_TOPIC_LIMIT)
  });
  const todaysRuns = await supabaseRest(`study_question_automation_runs?${runParams.toString()}`);
  const remaining = Math.max(0, DAILY_TOPIC_LIMIT - (todaysRuns || []).length);
  if (!remaining) {
    console.log("Limite diário de segurança atingido; novas tentativas ficam para a próxima janela UTC.");
    return;
  }

  const now = Date.now();
  const dueCandidates = (topics || []).filter((topic) => {
    if (!topic.active) return false;
    if (!topic.last_run_at) return true;
    const last = Date.parse(topic.last_run_at);
    const cadence = Math.max(1, Math.min(30, Number(topic.cadence_days) || 1));
    return !Number.isFinite(last) || now - last >= cadence * 86400000;
  });
  const due = [];
  const selectedHosts = new Set();
  for (const topic of dueCandidates) {
    const host = (() => { try { return new URL(topic.source_url).hostname.toLowerCase(); } catch { return ""; } })();
    if (!host || selectedHosts.has(host)) continue;
    due.push(topic);
    selectedHosts.add(host);
    if (due.length >= remaining) break;
  }
  if (due.length < remaining) {
    for (const topic of dueCandidates) {
      if (due.includes(topic)) continue;
      due.push(topic);
      if (due.length >= remaining) break;
    }
  }

  if (!due.length) {
    console.log("Nenhum assunto está vencido neste ciclo. O catálogo continuará sendo ampliado automaticamente.");
    return;
  }

  console.log(`Etapa 2/4: baixando materiais abertos e licenciados para ${due.length} assunto(s).`);
  const excerptByUrl = new Map();
  const headingRows = [];
  const sourceExcerpts = {};
  const processableIds = [];
  for (const topic of due) {
    try {
      let source = excerptByUrl.get(topic.source_url);
      if (!source) {
        if (String(topic.source_excerpt || "").trim()) {
          source = { text: String(topic.source_excerpt).trim(), html: "" };
        } else {
          source = await fetchStudyText(topic.source_url);
          excerptByUrl.set(topic.source_url, source);
        }
      }
      if (source.text.length < 200) throw new Error("Trecho da fonte contém menos de 200 caracteres.");
      sourceExcerpts[topic.id] = source.text.slice(0, 12000);
      processableIds.push(topic.id);
      const headings = extractHeadingsFromCache(source, topic);
      headingRows.push(...headings);
      console.log(`Fonte pronta: ${topic.discipline} — ${topic.topic}`);
    } catch (error) {
      console.error(`Fonte ignorada: ${topic.discipline} — ${topic.topic}: ${error.message}`);
    }
  }

  if (headingRows.length) {
    const unique = new Map();
    for (const row of headingRows) {
      unique.set(`${row.discipline}| ${row.topic}| ${row.source_url}`, row);
    }
    const discovered = [...unique.values()];
    const params = new URLSearchParams({ on_conflict: "discipline,topic,source_url" });
    await supabaseRest(`study_question_automation_topics?${params.toString()}`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(discovered)
    });
    console.log(`Novos subtópicos identificados nas fontes: ${discovered.length} candidato(s).`);
  }

  if (!processableIds.length) {
    throw new Error("Nenhuma fonte oficial pôde ser obtida. Não foram consumidas chamadas do Gemini; confira os links e tente no próximo ciclo.");
  }

  console.log("Etapa 3/4: elaborando questões e solicitando revisão independente ao Gemini.");
  const result = await callQuestionFactory({
    mode: "scheduled",
    topicIds: processableIds,
    sourceExcerpts
  });

  const rows = Array.isArray(result.results) ? result.results : [];
  for (const item of rows) console.log(JSON.stringify(item));
  const totals = rows.reduce((acc, item) => {
    acc.generated += Number(item.generated || 0);
    acc.approved += Number(item.approved || 0);
    acc.manualReview += Number(item.manualReview || 0);
    acc.rejected += Number(item.rejected || 0);
    return acc;
  }, { generated: 0, approved: 0, manualReview: 0, rejected: 0 });
  console.log("Etapa 4/4: relatório");
  console.log(`Assuntos processados: ${result.processed || 0}`);
  console.log(`Questões geradas: ${totals.generated}`);
  console.log(`Aprovadas automaticamente: ${totals.approved}`);
  console.log(`Retidas para revisão: ${totals.manualReview}`);
  console.log(`Rejeitadas: ${totals.rejected}`);

  const failures = rows.filter((item) => item.status === "failed");
  if (failures.length) throw new Error(`${failures.length} assunto(s) falharam na geração/revisão.`);
}

// Re-extract headings with the specific discipline and topic for each source.
// Cached HTML is retained privately only during this workflow run.
function extractHeadingsFromCache(source, topic) {
  if (!source.html) return [];
  return extractHeadings(source.html, topic.discipline, topic.topic, topic.source_url);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
