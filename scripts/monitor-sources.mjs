import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { concursos, sourceRegistry } from "../src/data/concursos.js";

const STATE_PATH = process.env.SOURCE_MONITOR_STATE || ".cache/source-monitor-state.json";
const REPORT_PATH = process.env.SOURCE_MONITOR_REPORT || ".cache/source-monitor-report.json";
const MARKDOWN_PATH = process.env.SOURCE_MONITOR_MARKDOWN || ".cache/source-monitor-report.md";
const MAX_BYTES = 12 * 1024 * 1024;

export function isTrustedOfficialHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const officialSuffixes = [".gov.br", ".jus.br", ".leg.br", ".mp.br", ".mil.br", ".def.br"];
  const approvedProviders = [
    "cebraspe.org.br",
    "igeduc.selecao.net.br",
    "fgv.br",
    "concursosfcc.com.br",
    "vunesp.com.br",
    "institutoaocp.org.br"
  ];
  return officialSuffixes.some((suffix) => host.endsWith(suffix))
    || approvedProviders.some((domain) => host === domain || host.endsWith("." + domain));
}

export function validateTrustedOfficialUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error("URL oficial inválida.");
    error.code = "UNSAFE_REDIRECT";
    throw error;
  }
  if (url.protocol !== "https:" || !isTrustedOfficialHost(url.hostname) || url.username || url.password) {
    const error = new Error("URL bloqueada: somente destinos HTTPS de domínios oficiais autorizados são permitidos.");
    error.code = "UNSAFE_REDIRECT";
    throw error;
  }
  return url;
}

export function resolveTrustedOfficialUrl(currentUrl, location) {
  if (!location) {
    const error = new Error("Redirecionamento oficial sem cabeçalho Location.");
    error.code = "UNSAFE_REDIRECT";
    throw error;
  }
  const base = validateTrustedOfficialUrl(currentUrl);
  let target;
  try {
    target = new URL(location, base);
  } catch {
    const error = new Error("Destino de redirecionamento inválido.");
    error.code = "UNSAFE_REDIRECT";
    throw error;
  }
  return validateTrustedOfficialUrl(target.href).href;
}

export async function fetchOfficialSource(url, options = {}) {
  const request = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects ?? 5)));
  let currentUrl = validateTrustedOfficialUrl(url).href;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await request(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "EditalRadar-SourceMonitor/1.0 (+https://github.com/dagamavasco170-lang/editalradar)",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) {
        const error = new Error("A fonte excedeu o limite de redirecionamentos seguros.");
        error.code = "UNSAFE_REDIRECT";
        throw error;
      }
      currentUrl = resolveTrustedOfficialUrl(currentUrl, response.headers?.get?.("location"));
      continue;
    }
    return { response, finalUrl: response.url || currentUrl };
  }
  throw new Error("Não foi possível resolver o endereço oficial.");
}

export function collectSourceUrls(items = concursos, additionalSources = sourceRegistry) {
  const sourceItems = [
    ...(Array.isArray(items) ? items : []),
    ...(Array.isArray(additionalSources) ? additionalSources : [])
  ];
  return [...new Set(sourceItems.map((item) => item?.sourceUrl).filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && isTrustedOfficialHost(url.hostname);
    } catch {
      return false;
    }
  }))].sort();
}
export function normalizeHtml(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function fingerprintContent(content, contentType = "text/html") {
  const stableContent = /html|text\//i.test(contentType) ? normalizeHtml(content) : content;
  return createHash("sha256").update(stableContent).digest("hex");
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOpportunityLinks(html, sourceUrl) {
  const keywords = /\b(edital|editais|processos? seletivos?|seleção|selecao|seleções|selecoes|inscrições|inscricoes|vagas|provimentos?|nomeações|nomeacoes|autorização|autorizacao|autorizações|autorizacoes|retificação|retificações|retificacao|retificacoes|errata|aditivo|aditivos|alteração|alterações|alteracao|alteracoes)\b/i;
  const contestKeyword = /\bconcursos?\b/i;
  const found = new Map();
  const anchors = String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);

  for (const match of anchors) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = decodeHtmlText(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    const title = decodeHtmlText(match[2]);
    if (!href || !title) continue;

    try {
      const candidateUrl = new URL(href, sourceUrl);
      if (candidateUrl.protocol !== "https:" || !isTrustedOfficialHost(candidateUrl.hostname)) continue;
      const pathAndTitle = title + " " + candidateUrl.pathname;
      const registrationLink = /\b(cadastro|cadastrar|register|login|entrar|signup|sign[-_]?in|account|conta)\b/i.test(pathAndTitle);
      const explicitContest = contestKeyword.test(pathAndTitle)
        && /(20\d{2}|cargo|vagas?|publicad[oa]|abert[oa]|edital)/i.test(pathAndTitle);
      const contestPage = /\/concursos?\/[a-z0-9_-]+/i.test(candidateUrl.pathname);
      if (registrationLink || (!keywords.test(pathAndTitle) && !explicitContest && !contestPage)) continue;
      candidateUrl.hash = "";
      const normalizedUrl = candidateUrl.toString();
      if (normalizedUrl === new URL(sourceUrl).toString()) continue;
      if (!found.has(normalizedUrl)) {
        found.set(normalizedUrl, {
          candidate_url: normalizedUrl,
          title: title.slice(0, 240),
          context: "Link identificado em página oficial monitorada: " + new URL(sourceUrl).hostname
        });
      }
    } catch {
      // Ignora links inválidos ou relativos malformados.
    }
  }
  return [...found.values()];
}

export function buildDiscoveriesForSource(url, previous, current) {
  if (!current?.ok) return [];
  const discoveries = [];
  const needsLinkBaseline = previous?.opportunityLinkFilterVersion !== 5;

  if (needsLinkBaseline) {
    const opportunityLinks = current.opportunityLinks || [];
    for (const item of opportunityLinks) {
      discoveries.push({
        source_url: url,
        candidate_url: item.candidate_url,
        discovery_key: "link:" + item.candidate_url,
        title: item.title,
        context: item.context + " · Oportunidade encontrada na carga inicial da fila; confirme se ainda está vigente.",
        discovery_type: "new_link"
      });
    }
    if (opportunityLinks.length === 0) {
      discoveries.push({
        source_url: url,
        candidate_url: url,
        discovery_key: "source-baseline:" + current.sha256,
        title: "Fonte oficial para verificação inicial: " + new URL(url).hostname,
        context: "Página oficial monitorada sem link de edital identificável pelo detector. Abra a fonte e confira manualmente se há edital, autorização, seleção ou cronograma novo.",
        discovery_type: "source_baseline"
      });
    }
    return discoveries;
  }

  if (previous?.sha256 && previous.sha256 !== current.sha256) {
    discoveries.push({
      source_url: url,
      candidate_url: url,
      discovery_key: "page:" + current.sha256,
      title: "Página oficial atualizada: " + new URL(url).hostname,
      context: "O conteúdo da página monitorada mudou. Confira a publicação oficial e identifique se há edital, autorização ou cronograma novo.",
      discovery_type: "page_change"
    });
  }

  const knownLinks = new Set((previous?.opportunityLinks || []).map((item) => item.candidate_url));
  for (const item of current.opportunityLinks || []) {
    if (knownLinks.has(item.candidate_url)) continue;
    discoveries.push({
      source_url: url,
      candidate_url: item.candidate_url,
      discovery_key: "link:" + item.candidate_url,
      title: item.title,
      context: item.context,
      discovery_type: "new_link"
    });
  }
  return discoveries;
}

export function compareSource(url, previous, current) {
  if (!current.ok) return { type: "unavailable", url, message: current.error || "Falha ao consultar a fonte." };
  if (!previous?.sha256) return { type: "new_baseline", url, message: "Primeira leitura desta fonte." };
  if (previous.sha256 !== current.sha256) return { type: "changed", url, message: "O conteúdo textual da página mudou desde a última verificação." };
  return null;
}

export function pruneSourceState(sources = {}, monitoredUrls = []) {
  const retained = { ...(sources && typeof sources === "object" ? sources : {}) };
  const monitored = new Set(monitoredUrls);
  const removed = Object.keys(retained).filter(url => !monitored.has(url)).sort();
  for (const url of removed) delete retained[url];
  return { sources: retained, removed };
}

async function fetchSource(url) {
  const { response, finalUrl } = await fetchOfficialSource(url);
  if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) throw new Error("Resposta excede o limite de 12 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("Resposta excede o limite de 12 MB.");
  const content = /html|text\//i.test(contentType) ? new TextDecoder("utf-8").decode(bytes) : bytes;
  const opportunityLinks = /html/i.test(contentType)
    ? extractOpportunityLinks(content, finalUrl)
    : [];

  return {
    ok: true,
    sha256: fingerprintContent(content, contentType),
    opportunityLinks,
    opportunityLinkFilterVersion: 5,
    status: response.status,
    finalUrl,
    contentType,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    checkedAt: new Date().toISOString()
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

async function runMonitor() {
  const urls = collectSourceUrls();
  await mkdir(dirname(resolve(STATE_PATH)), { recursive: true });
  let oldState = { version: 1, sources: {} };
  try {
    oldState = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (!oldState || typeof oldState.sources !== "object") oldState = { version: 1, sources: {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const firstRun = Object.keys(oldState.sources).length === 0;
  const checked = await mapWithConcurrency(urls, 3, async (url) => {
    try { return { url, current: await fetchSource(url) }; }
    catch (error) { return { url, current: { ok: false, error: error.message, checkedAt: new Date().toISOString() } }; }
  });

  const nextSources = { ...oldState.sources };
  const changed = [];
  const unavailable = [];
  const added = [];
  const discoveries = [];
  for (const entry of checked) {
    const previous = oldState.sources[entry.url];
    const result = compareSource(entry.url, previous, entry.current);
    if (result?.type === "changed") changed.push(result);
    if (result?.type === "unavailable") unavailable.push(result);
    if (!previous?.sha256 && entry.current.ok && !firstRun) added.push({ ...result, type: "added" });
    discoveries.push(...buildDiscoveriesForSource(entry.url, previous, entry.current));
    if (entry.current.ok) nextSources[entry.url] = entry.current;
    else nextSources[entry.url] = { ...(previous || {}), lastError: entry.current.error, lastCheckedAt: entry.current.checkedAt };
  }

  const prunedState = pruneSourceState(nextSources, urls);
  const removed = prunedState.removed.map((url) => ({
    type: "removed",
    url,
    message: "A fonte deixou de estar vinculada ao catálogo."
  }));

  const report = { generatedAt: new Date().toISOString(), monitoredCount: urls.length, firstRun, changed, unavailable, added, removed, discoveries };
  await writeFile(STATE_PATH, JSON.stringify({ version: 1, sources: prunedState.sources }, null, 2) + "\n");
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  const groups = [
    ["Páginas alteradas", changed],
    ["Fontes indisponíveis", unavailable],
    ["Novas fontes no catálogo", added],
    ["Novos links de oportunidades", discoveries.filter((item) => item.discovery_type === "new_link")],
    ["Páginas atualizadas para revisão", discoveries.filter((item) => item.discovery_type === "page_change")],
    ["Fontes removidas do catálogo", removed]
  ];
  const lines = [
    "# Relatório de monitoramento de fontes",
    "",
    "Verificado em: " + report.generatedAt,
    "Fontes acompanhadas: " + report.monitoredCount,
    ...(firstRun ? ["Esta foi a primeira leitura; os resultados formam a linha de base."] : []),
    ""
  ];
  for (const [heading, entries] of groups) {
    lines.push("## " + heading + " (" + entries.length + ")");
    if (entries.length) {
      for (const entry of entries) {
        const url = entry.candidate_url || entry.url;
        const message = entry.title
          ? entry.title + (entry.context ? " — " + entry.context : "")
          : entry.message;
        lines.push("- [" + url + "](" + url + ") — " + message);
      }
    } else lines.push("- Nenhuma.");
    lines.push("");
  }
  lines.push("Atenção: mudanças são apenas sinais para revisão. O catálogo não é atualizado automaticamente; confirme o conteúdo na publicação oficial antes de alterar vagas, inscrições, datas ou requisitos.");
  await writeFile(MARKDOWN_PATH, lines.join("\n") + "\n");

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      "changed_count=" + (changed.length + added.length + removed.length + discoveries.length),
      "discovered_count=" + discoveries.length,
      "failed_count=" + unavailable.length,
      ""
    ].join("\n"));
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMonitor().catch((error) => {
    console.error("Falha no monitoramento de fontes:", error);
    process.exitCode = 1;
  });
}
