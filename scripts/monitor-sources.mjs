import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { mkdir, readFile, writeFile, appendFile, mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, dirname, join } from "node:path";
import { concursos, sourceRegistry } from "../src/data/concursos.js";

const STATE_PATH = process.env.SOURCE_MONITOR_STATE || ".cache/source-monitor-state.json";
const REPORT_PATH = process.env.SOURCE_MONITOR_REPORT || ".cache/source-monitor-report.json";
const MARKDOWN_PATH = process.env.SOURCE_MONITOR_MARKDOWN || ".cache/source-monitor-report.md";
const MAX_BYTES = 12 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export function isTrustedOfficialHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const officialSuffixes = [".gov.br", ".jus.br", ".leg.br", ".mp.br", ".mil.br", ".def.br"];
  const approvedProviders = [
    "cebraspe.org.br",
    "igeduc.selecao.net.br",
    "igeduc.org.br",
    "ibfc.org.br",
    "quadrix.org.br",
    "fundacaolasalle.org.br",
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

const RETRYABLE_SOURCE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const retryAfterMilliseconds = (headers, now = Date.now()) => {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(10000, date - now)) : null;
};

export async function fetchOfficialSourceWithCurl(url, options = {}) {
  const safeUrl = validateTrustedOfficialUrl(url).href;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
  const directory = await mkdtemp(join(tmpdir(), "editalradar-monitor-curl-"));
  const bodyPath = join(directory, "response-body.bin");
  const headersPath = join(directory, "response-headers.txt");
  try {
    const { stdout: metadata } = await execFileAsync("curl", [
      "--silent",
      "--show-error",
      "--compressed",
      "--max-redirs", "0",
      "--connect-timeout", String(Math.min(10, Math.ceil(timeoutMs / 1000))),
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--max-filesize", String(MAX_BYTES),
      "--user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EditalRadar/1.0",
      "--header", "Accept: text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7",
      "--header", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "--header", "Cache-Control: no-cache",
      "--dump-header", headersPath,
      "--output", bodyPath,
      "--write-out", "%{http_code}\n%{url_effective}\n%{content_type}",
      safeUrl
    ], {
      encoding: "utf8",
      timeout: timeoutMs + 3000,
      maxBuffer: 64 * 1024
    });
    const metadataLines = metadata.trim().split("\n");
    const status = Number(metadataLines[0]);
    const finalUrl = metadataLines[1] || safeUrl;
    const contentType = metadataLines[2] || "";
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error("curl não retornou um status HTTP válido.");
    }
    const final = validateTrustedOfficialUrl(finalUrl);
    if (final.href !== finalUrl) throw new Error("O destino final do curl não corresponde a uma URL oficial validada.");

    const rawHeaders = await readFile(headersPath, "utf8");
    const responseHeaders = {};
    let currentHeaders = {};
    for (const line of rawHeaders.split(/\r?\n/)) {
      if (line.startsWith("HTTP/")) {
        if (Object.keys(currentHeaders).length) Object.assign(responseHeaders, currentHeaders);
        currentHeaders = {};
      } else {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        currentHeaders[name] = currentHeaders[name] ? currentHeaders[name] + ", " + value : value;
      }
    }
    Object.assign(responseHeaders, currentHeaders);
    if (contentType && !responseHeaders["content-type"]) responseHeaders["content-type"] = contentType;
    const body = await readFile(bodyPath);
    if (body.byteLength > MAX_BYTES) throw new Error("Resposta excede o limite de 12 MB.");
    return {
      status,
      statusText: "",
      ok: status >= 200 && status < 300,
      headers: new Headers(responseHeaders),
      url: final.href,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function fetchOfficialSource(url, options = {}) {
  const request = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects ?? 5)));
  const attempts = Math.max(1, Math.min(4, Number(options.attempts) || 3));
  const retryDelayMs = Math.max(0, Math.min(5000, Number(options.retryDelayMs ?? 500)));
  const wait = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const startUrl = validateTrustedOfficialUrl(url).href;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let currentUrl = startUrl;
    try {
      let result = null;
      let usedFallbackTransport = false;
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        let response = await request(currentUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "User-Agent": "EditalRadar-SourceMonitor/1.0 (+https://github.com/dagamavasco170-lang/editalradar)",
            Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7"
          }
        });
        if ([401, 403, 429].includes(response.status) && typeof options.fallbackFetch === "function") {
          try {
            const fallbackResponse = await options.fallbackFetch(currentUrl, {
              timeoutMs,
              headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EditalRadar/1.0",
                Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
              }
            });
            if (fallbackResponse && ![401, 403].includes(fallbackResponse.status)) {
              response = fallbackResponse;
              usedFallbackTransport = true;
            } else if (fallbackResponse) {
              console.warn("Fonte oficial continuou bloqueada após transporte alternativo: " + currentUrl + " (HTTP " + fallbackResponse.status + ").");
            }
          } catch (fallbackError) {
            console.warn("Transporte alternativo falhou para " + currentUrl + ": " + String(fallbackError?.message || fallbackError).slice(0, 220));
          }
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirectCount === maxRedirects) {
            const error = new Error("A fonte excedeu o limite de redirecionamentos seguros.");
            error.code = "UNSAFE_REDIRECT";
            throw error;
          }
          currentUrl = resolveTrustedOfficialUrl(currentUrl, response.headers?.get?.("location"));
          continue;
        }
        result = { response, finalUrl: response.url || currentUrl, usedFallbackTransport };
        break;
      }
      if (!result) throw new Error("Não foi possível resolver o endereço oficial.");
      if (!RETRYABLE_SOURCE_STATUSES.has(result.response.status) || attempt === attempts) return result;
      lastError = new Error("HTTP " + result.response.status);
      const retryAfter = retryAfterMilliseconds(result.response.headers);
      await wait(retryAfter ?? retryDelayMs * (2 ** (attempt - 1)));
    } catch (error) {
      if (error?.code === "UNSAFE_REDIRECT") throw error;
      lastError = error;
      if (attempt < attempts) await wait(retryDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error("Falha de rede sem detalhes adicionais.");
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
      const genericStatusPage = /^\/concursos\/status\/(?:novos|inscricoes-abertas|em-andamento|resultados-disponiveis|finalizados)\/?$/i
        .test(candidateUrl.pathname);
      if (genericStatusPage) continue;
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
  const needsLinkBaseline = previous?.opportunityLinkFilterVersion !== 6;

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
  const { response, finalUrl, usedFallbackTransport } = await fetchOfficialSource(url, {
    fallbackFetch: fetchOfficialSourceWithCurl
  });
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
    opportunityLinkFilterVersion: 6,
    status: response.status,
    finalUrl,
    contentType,
    transport: usedFallbackTransport ? "curl-fallback" : "fetch",
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


export const INTERNET_SEARCH_QUERIES = [
  { label: "PCI Concursos — concursos abertos", query: 'site:pciconcursos.com.br/concursos/ ("concurso" OR "processo seletivo" OR edital) vagas inscrições' },
  { label: "PCI Concursos — últimas atualizações", query: 'site:pciconcursos.com.br/ultimas/ (concurso OR edital OR processo seletivo OR retificação)' },
  { label: "PCI Concursos — notícias de concursos", query: 'site:pciconcursos.com.br/noticias/ (concurso OR edital OR vagas OR inscrições)' },
  { label: "Concursos em órgãos federais", query: '("concurso público" OR "processo seletivo") (edital OR vagas OR inscrições) site:gov.br' },
  { label: "Concursos e seleções em Alagoas", query: '("concurso público" OR "processo seletivo") (edital OR vagas OR inscrições) (Alagoas OR Maceió OR Arapiraca)' },
  { label: "Poderes e órgãos de Justiça", query: '("concurso público" OR edital) (vagas OR inscrições OR retificação) (site:jus.br OR site:leg.br OR site:mp.br)' },
  { label: "Bancas organizadoras", query: 'concurso edital (Cebraspe OR FGV OR FCC OR Vunesp OR AOCP OR IBFC OR Quadrix OR IGEDUC)' },
  { label: "Novos concursos e autorizações", query: 'concurso público 2026 2027 edital autorização comissão banca' },
  { label: "Retificações, erratas e novos cronogramas", query: '(retificação OR retificações OR errata OR aditivo) (edital OR concurso OR processo seletivo) vagas inscrições' },
  { label: "Concursos municipais e câmaras", query: '("concurso público" OR "processo seletivo") (prefeitura OR município OR câmara municipal) (edital OR vagas OR inscrições)' },
  { label: "Processos seletivos simplificados", query: '"processo seletivo simplificado" (edital OR inscrições OR vagas) 2026 2027' },
  { label: "Universidades e institutos", query: '(concurso OR "processo seletivo") (universidade OR instituto federal OR instituto estadual) (edital OR vagas OR inscrições)' },
  { label: "Inscrições abertas e prazos", query: '("inscrições abertas" OR "prazo de inscrição" OR "período de inscrição") concurso edital vagas' }
];

export const SECONDARY_NEWS_FEEDS = [
  {
    id: "concursos-no-brasil",
    label: "Concursos no Brasil",
    feedUrl: "https://www.concursosnobrasil.com.br/feed/"
  },
  {
    id: "estrategia-concursos",
    label: "Estratégia Concursos",
    feedUrl: "https://concursos.estrategia.com/portal/feed/"
  },
  {
    id: "g1-concursos",
    label: "G1 — Concursos",
    feedUrl: "https://g1.globo.com/rss/g1/trabalho-e-carreira/concursos/"
  }
];

const GOOGLE_NEWS_RSS_ENDPOINT = "https://news.google.com/rss/search";
const SECONDARY_NEWS_HOSTS = [
  "concursosnobrasil.com.br",
  "concursos.estrategia.com",
  "estrategiaconcursos.com.br",
  "g1.globo.com"
];

export function isTrustedSecondaryNewsHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return SECONDARY_NEWS_HOSTS.some(domain => host === domain || host.endsWith("." + domain));
}

const SECONDARY_NEWS_PUBLISHER_FAMILIES = [
  ["concursosnobrasil.com.br"],
  ["concursos.estrategia.com", "estrategiaconcursos.com.br"],
  ["g1.globo.com"]
];

function matchesPublisherFamily(hostname, family) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return family.some(domain => host === domain || host.endsWith("." + domain));
}

export function isSameTrustedSecondaryFeedPublisher(fromHostname, toHostname) {
  return SECONDARY_NEWS_PUBLISHER_FAMILIES.some(family =>
    matchesPublisherFamily(fromHostname, family) && matchesPublisherFamily(toHostname, family)
  );
}

export function resolveTrustedSecondaryFeedRedirect(currentUrl, location) {
  const current = new URL(currentUrl);
  if (!location) throw new Error("Redirecionamento do feed sem destino informado.");
  let target;
  try {
    target = new URL(location, current);
  } catch {
    throw new Error("Destino de redirecionamento do feed inválido.");
  }
  if (target.protocol !== "https:" || target.username || target.password
    || (target.port && target.port !== "443")
    || !isTrustedSecondaryNewsHost(target.hostname)
    || !isSameTrustedSecondaryFeedPublisher(current.hostname, target.hostname)) {
    throw new Error("Redirecionamento do feed bloqueado: somente HTTPS dentro do mesmo veículo autorizado é permitido.");
  }
  target.hash = "";
  return target;
}

const WEB_SEARCH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WEB_SEARCH_MAX_FEED_BYTES = 2 * 1024 * 1024;

export function buildGoogleNewsRssUrl(query) {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set("q", String(query || "").trim() + " when:7d");
  url.searchParams.set("hl", "pt-BR");
  url.searchParams.set("gl", "BR");
  url.searchParams.set("ceid", "BR:pt-419");
  return url.toString();
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function readXmlTag(block, tag) {
  const match = String(block || "").match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + "\\s*>", "i"));
  return match ? decodeXmlText(match[1]) : "";
}

export function normalizeNewsLeadIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyContestLead(title = "", description = "") {
  const text = normalizeNewsLeadIdentity(String(title) + " " + String(description).slice(0, 700));
  if (/\b(retificacao|retificacoes|errata|aditivo|alteracao do edital|cronograma retificado)\b/.test(text)) {
    return { kind: "retification", label: "Retificação/errata" };
  }
  if (/\b(resultado final|homologacao|convocacao|nomeacao|classificacao final)\b/.test(text)) {
    return { kind: "result_update", label: "Resultado/convocação" };
  }
  if (/\b(inscricoes abertas|inscricao aberta|prazo de inscricao|periodo de inscricao|inscricoes ate)\b/.test(text)) {
    return { kind: "open_registration", label: "Inscrições/prazo" };
  }
  if (/\b(autorizacao|comissao formada|comissao organizadora|banca definida|escolha da banca|contrato com a banca|edital previsto)\b/.test(text)) {
    return { kind: "pre_notice", label: "Pré-edital/autorização" };
  }
  if (/\bedital\b/.test(text)) {
    return { kind: "notice", label: "Edital/publicação" };
  }
  if (/\b(processo seletivo|selecao publica)\b/.test(text)) {
    return { kind: "selection", label: "Processo seletivo" };
  }
  return { kind: "general", label: "Notícia para conferir" };
}

export function parseGoogleNewsRss(xml, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeMs = Math.max(60_000, Number(options.maxAgeMs) || WEB_SEARCH_MAX_AGE_MS);
  const maxResults = Math.max(1, Math.min(30, Number(options.maxResults) || 8));
  const queryLabel = String(options.queryLabel || "Busca na internet").slice(0, 100);
  const feedUrl = String(options.feedUrl || buildGoogleNewsRssUrl(queryLabel));
  const items = String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi);
  const leads = [];
  const seen = new Set();

  for (const match of items) {
    if (leads.length >= maxResults) break;
    const item = match[1];
    const title = readXmlTag(item, "title");
    const link = readXmlTag(item, "link");
    const description = readXmlTag(item, "description");
    const publishedRaw = readXmlTag(item, "pubDate");
    const sourceMatch = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i);
    const sourceName = sourceMatch ? decodeXmlText(sourceMatch[2]) : "";
    const sourceUrlMatch = sourceMatch?.[1]?.match(/\burl\s*=\s*["']([^"']+)["']/i);
    const sourceUrl = sourceUrlMatch ? decodeXmlText(sourceUrlMatch[1]) : "";
    if (!title || !link || !/(concurso|concursos|edital|processo seletivo|certame|seleção pública|selecao publica|vagas|banca organizadora)/i.test(title + " " + description.slice(0, 500))) continue;

    let candidate;
    try {
      candidate = new URL(link);
      if (candidate.protocol !== "https:" || candidate.username || candidate.password) continue;
      candidate.hash = "";
    } catch {
      continue;
    }

    const publishedTimestamp = Date.parse(publishedRaw);
    if (Number.isFinite(publishedTimestamp) && (
      publishedTimestamp < now.getTime() - maxAgeMs
      || publishedTimestamp > now.getTime() + 48 * 60 * 60 * 1000
    )) continue;
    const normalizedKey = candidate.toString();
    const leadCategory = classifyContestLead(title, description);
    const normalizedTitle = normalizeNewsLeadIdentity(title);
    const normalizedSource = normalizeNewsLeadIdentity(sourceName);
    // A chave por título + veículo sobrevive a mudanças no permalink do agregador.
    // Manchetes curtas demais continuam usando a URL para evitar colisões genéricas.
    const stableIdentity = normalizedTitle.length >= 35
      ? "title:" + normalizedTitle + "|source:" + normalizedSource
      : "url:" + normalizedKey;
    const digest = createHash("sha256").update(stableIdentity).digest("hex");
    const discoveryKey = "web-search-title:" + digest;
    if (seen.has(discoveryKey)) continue;
    seen.add(discoveryKey);

    const dateLabel = Number.isFinite(publishedTimestamp)
      ? new Date(publishedTimestamp).toLocaleString("pt-BR", { timeZone: "America/Maceio" })
      : "data não informada pelo agregador";
    const contextParts = [
      "Pista encontrada na busca pública da internet.",
      "Classificação automática: " + leadCategory.label + " (não é confirmação do edital).",
      "Consulta: " + queryLabel + ".",
      "Fonte indicada pelo Google Notícias: " + (sourceName || "não identificada") + ".",
      "Publicação: " + dateLabel + ".",
      description ? "Resumo: " + description.slice(0, 650) : "",
      sourceUrl ? "Endereço informado para a fonte: " + sourceUrl : "",
      "A notícia é apenas uma pista. Confirme o edital, o órgão e a banca em um domínio oficial antes de cadastrar ou divulgar a oportunidade."
    ].filter(Boolean);

    leads.push({
      source_url: feedUrl,
      candidate_url: candidate.toString(),
      discovery_key: discoveryKey,
      title: "[" + leadCategory.label + "] Busca na internet: " + title.slice(0, 180),
      context: contextParts.join(" "),
      discovery_type: "web_search_lead"
    });
  }
  return leads;
}

export function isActionableSecondaryNewsLead(title = "", description = "") {
  const titleText = normalizeNewsLeadIdentity(title);
  const descriptionText = normalizeNewsLeadIdentity(String(description || "").slice(0, 700));
  const exclusion = /\b(gabarito|caderno de provas?|provas? aplicadas?|correcao da prova|provas? comentadas?|questoes? comentadas?|simulado|resumo|aulas?|videoaulas?|artigos? de teoria|dicas? de estudo|como estudar|material de estudo|mapas? mentais?|lei(s)? de [a-z]|direito penal|contabilidade|fundamentos de auditoria)\b/;
  if (exclusion.test(titleText)) return false;

  const hasActionableSignal = /\b(edital|publica|publicado|publicada|divulga|divulgado|divulgada|abre|aberto|aberta|vagas?|inscricoes?|prazo|banca|autorizacao|comissao|retificacao|errata|aditivo|resultado|homologacao|convocacao|nomeacao|previsto|prevista|previsao|contratacao)\b/.test(titleText);
  if (!hasActionableSignal) return false;

  const hasContestContext = /\b(concurso|concursos|certame|processo seletivo|seletivo|seletiva|selecao publica)\b/.test(titleText);
  const titleSignalsPublicNotice = /\b(edital|processo seletivo|seletivo|seletiva|vagas?)\b/.test(titleText);
  const descriptionConfirmsContext = /\b(concurso|processo seletivo|selecao publica|certame|vagas? para cargos|inscricoes)\b/.test(descriptionText);
  return hasContestContext || (titleSignalsPublicNotice && descriptionConfirmsContext);
}

export function parseSecondaryNewsRss(xml, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeMs = Math.max(60_000, Number(options.maxAgeMs) || WEB_SEARCH_MAX_AGE_MS);
  const maxResults = Math.max(1, Math.min(30, Number(options.maxResults) || 8));
  const feedUrl = String(options.feedUrl || "");
  const feedLabel = String(options.feedLabel || "Fonte editorial").slice(0, 100);
  const items = String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi);
  const leads = [];
  const seen = new Set();

  for (const match of items) {
    if (leads.length >= maxResults) break;
    const item = match[1];
    const title = readXmlTag(item, "title");
    const link = readXmlTag(item, "link");
    const description = readXmlTag(item, "description") || readXmlTag(item, "content:encoded");
    const publishedRaw = readXmlTag(item, "pubDate");
    if (!title || !link || !isActionableSecondaryNewsLead(title, description)) continue;

    let candidate;
    try {
      candidate = new URL(link);
      if (candidate.protocol !== "https:" || candidate.username || candidate.password || !isTrustedSecondaryNewsHost(candidate.hostname)) continue;
      candidate.hash = "";
    } catch {
      continue;
    }

    const publishedTimestamp = Date.parse(publishedRaw);
    if (Number.isFinite(publishedTimestamp) && (
      publishedTimestamp < now.getTime() - maxAgeMs
      || publishedTimestamp > now.getTime() + 48 * 60 * 60 * 1000
    )) continue;

    const category = classifyContestLead(title, description);
    const normalizedTitle = normalizeNewsLeadIdentity(title);
    const stableIdentity = (normalizedTitle.length >= 35 ? normalizedTitle : candidate.toString())
      + "|publisher:" + candidate.hostname.toLowerCase();
    const digest = createHash("sha256").update(stableIdentity).digest("hex");
    const discoveryKey = "secondary-feed-title:" + digest;
    if (seen.has(discoveryKey)) continue;
    seen.add(discoveryKey);

    const dateLabel = Number.isFinite(publishedTimestamp)
      ? new Date(publishedTimestamp).toLocaleString("pt-BR", { timeZone: "America/Maceio" })
      : "data não informada pelo feed";
    const contextParts = [
      "Pista encontrada em feed editorial independente; ainda não é confirmação de concurso.",
      "Veículo: " + feedLabel + ".",
      "Classificação automática: " + category.label + ".",
      "Publicação: " + dateLabel + ".",
      description ? "Resumo: " + description.slice(0, 650) : "",
      "O robô tentará localizar o edital em um domínio oficial autorizado. A notícia e o veículo secundário nunca serão usados como prova para cadastro automático."
    ].filter(Boolean);

    leads.push({
      source_url: feedUrl,
      candidate_url: candidate.toString(),
      discovery_key: discoveryKey,
      title: "[" + category.label + "] " + feedLabel + ": " + title.slice(0, 180),
      context: contextParts.join(" "),
      discovery_type: "web_search_lead"
    });
  }
  return leads;
}

export async function fetchNewsFeedWithCurl(feedUrl, options = {}) {
  const parsedUrl = new URL(feedUrl);
  const googleFeedAllowed = parsedUrl.hostname === "news.google.com"
    && parsedUrl.pathname === "/rss/search"
    && parsedUrl.searchParams.has("q");
  const secondaryFeedAllowed = SECONDARY_NEWS_FEEDS.some(feed => feed.feedUrl === parsedUrl.href);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password
    || (parsedUrl.port && parsedUrl.port !== "443")
    || (!googleFeedAllowed && !secondaryFeedAllowed)) {
    throw new Error("Feed de notícias bloqueado para o transporte alternativo.");
  }

  const timeoutMs = Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 12000));
  const directory = await mkdtemp(join(tmpdir(), "editalradar-news-curl-"));
  const bodyPath = join(directory, "response-body.xml");
  const headersPath = join(directory, "response-headers.txt");
  try {
    const { stdout: metadata } = await execFileAsync("curl", [
      "--silent",
      "--show-error",
      "--compressed",
      "--max-redirs", "0",
      "--connect-timeout", String(Math.min(10, Math.ceil(timeoutMs / 1000))),
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--max-filesize", String(WEB_SEARCH_MAX_FEED_BYTES),
      "--user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EditalRadar/1.0",
      "--header", "Accept: application/rss+xml, application/xml, text/xml;q=0.9",
      "--header", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "--dump-header", headersPath,
      "--output", bodyPath,
      "--write-out", "%{http_code}\n%{url_effective}\n%{content_type}",
      parsedUrl.href
    ], {
      encoding: "utf8",
      timeout: timeoutMs + 3000,
      maxBuffer: 64 * 1024
    });

    const metadataLines = metadata.trim().split("\n");
    const status = Number(metadataLines[0]);
    const finalUrl = metadataLines[1] || parsedUrl.href;
    const contentType = metadataLines[2] || "";
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error("curl não retornou um status HTTP válido para o feed.");
    }
    if (finalUrl !== parsedUrl.href) {
      throw new Error("O transporte alternativo tentou alterar o endereço do feed.");
    }

    const rawHeaders = await readFile(headersPath, "utf8");
    const responseHeaders = {};
    let currentHeaders = {};
    for (const line of rawHeaders.split(/\r?\n/)) {
      if (line.startsWith("HTTP/")) {
        if (Object.keys(currentHeaders).length) Object.assign(responseHeaders, currentHeaders);
        currentHeaders = {};
      } else {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        currentHeaders[name] = currentHeaders[name] ? currentHeaders[name] + ", " + value : value;
      }
    }
    Object.assign(responseHeaders, currentHeaders);
    if (contentType && !responseHeaders["content-type"]) responseHeaders["content-type"] = contentType;

    const body = await readFile(bodyPath);
    if (body.byteLength > WEB_SEARCH_MAX_FEED_BYTES) throw new Error("O feed excede o limite de 2 MB.");
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      headers: new Headers(responseHeaders),
      url: finalUrl,
      text: async () => body.toString("utf8"),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function fetchNewsFeedWithRetry(feedUrl, options = {}) {
  const request = options.fetchImpl || fetch;
  const attempts = Math.max(1, Math.min(4, Number(options.attempts) || 3));
  const timeoutMs = Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 12000));
  const retryDelayMs = Math.max(0, Math.min(5000, Number(options.retryDelayMs ?? 500)));
  const maxRedirects = Math.max(0, Math.min(4, Number(options.maxRedirects ?? 3)));
  const wait = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const parsedUrl = new URL(feedUrl);
  const googleFeedAllowed = parsedUrl.hostname === "news.google.com"
    && parsedUrl.pathname === "/rss/search"
    && parsedUrl.searchParams.has("q");
  const secondaryFeedAllowed = SECONDARY_NEWS_FEEDS.some(feed => feed.feedUrl === parsedUrl.href);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password
    || (parsedUrl.port && parsedUrl.port !== "443")
    || (!googleFeedAllowed && !secondaryFeedAllowed)) {
    throw new Error("Feed de notícias bloqueado: somente feeds HTTPS previamente autorizados são permitidos.");
  }

  let lastError = null;
  let lastResponse = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let currentUrl = parsedUrl;
      let response = null;
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        response = await request(currentUrl.href, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; EditalRadar-WebDiscovery/1.0; +https://github.com/dagamavasco170-lang/editalradar)",
            Accept: "application/rss+xml, application/xml, text/xml;q=0.9"
          }
        });

        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        if (googleFeedAllowed) {
          throw new Error("Redirecionamento do Google Notícias recusado; somente feeds editoriais da lista autorizada podem redirecionar dentro do mesmo veículo.");
        }
        if (hop === maxRedirects) {
          throw new Error("O feed excedeu o limite de redirecionamentos seguros.");
        }
        currentUrl = resolveTrustedSecondaryFeedRedirect(
          currentUrl.href,
          response.headers?.get?.("location")
        );
      }

      if (!response) throw new Error("O provedor não retornou uma resposta.");
      if (RETRYABLE_SOURCE_STATUSES.has(response.status)) {
        lastResponse = response;
        if (attempt < attempts) {
          const retryAfter = retryAfterMilliseconds(response.headers, nowMs);
          await wait(retryAfter ?? retryDelayMs * (2 ** (attempt - 1)));
          continue;
        }
        break;
      }
      if ([401, 403].includes(response.status)) {
        lastResponse = response;
        break;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(retryDelayMs * (2 ** (attempt - 1)));
        continue;
      }
      break;
    }
  }

  if (typeof options.fallbackFetch === "function") {
    try {
      const fallbackResponse = await options.fallbackFetch(parsedUrl.href, {
        timeoutMs,
        redirect: "error",
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EditalRadar/1.0",
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      if (fallbackResponse?.ok || (fallbackResponse && !RETRYABLE_SOURCE_STATUSES.has(fallbackResponse.status)
        && ![301, 302, 303, 307, 308, 401, 403].includes(fallbackResponse.status))) {
        return fallbackResponse;
      }
      if (fallbackResponse) lastResponse = fallbackResponse;
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Falha ao consultar o feed de notícias.");
}


export async function searchInternetForContestLeads(options = {}) {
  const request = options.fetchImpl || fetch;
  const queries = Array.isArray(options.queries) ? options.queries : INTERNET_SEARCH_QUERIES;
  const secondaryFeeds = Array.isArray(options.secondaryFeeds) ? options.secondaryFeeds : SECONDARY_NEWS_FEEDS;
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 3));
  const googleConcurrency = Math.max(1, Math.min(2, Number(options.googleConcurrency) || 2));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxResultsPerQuery = Math.max(1, Math.min(20, Number(options.maxResultsPerQuery) || 8));
  let googleCircuitOpen = false;

  const googleChecked = await mapWithConcurrency(queries, googleConcurrency, async entry => {
    const feedUrl = buildGoogleNewsRssUrl(entry.query);
    if (googleCircuitOpen) {
      return {
        label: entry.label,
        feedUrl,
        discoveries: [],
        error: "Google Notícias pausado neste ciclo após responder HTTP 503; as outras fontes continuam ativas.",
        provider: "Google Notícias",
        skipped: true
      };
    }

    try {
      const response = await fetchNewsFeedWithRetry(feedUrl, {
        fetchImpl: request,
        attempts: options.attempts,
        timeoutMs: options.timeoutMs,
        retryDelayMs: options.retryDelayMs,
        sleepImpl: options.sleepImpl,
        fallbackFetch: options.fallbackFetch || fetchNewsFeedWithCurl,
        nowMs: options.nowMs
      });
      if (!response.ok) {
        if (response.status === 503) googleCircuitOpen = true;
        throw new Error("Google Notícias respondeu HTTP " + response.status + ".");
      }
      const contentLength = Number(response.headers?.get?.("content-length") || 0);
      if (contentLength > WEB_SEARCH_MAX_FEED_BYTES) throw new Error("O feed excede o limite de 2 MB.");
      const xml = await response.text();
      if (new TextEncoder().encode(xml).byteLength > WEB_SEARCH_MAX_FEED_BYTES) throw new Error("O feed excede o limite de 2 MB.");
      if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error("A resposta não contém um feed RSS/XML válido.");
      const discoveries = parseGoogleNewsRss(xml, { now, queryLabel: entry.label, feedUrl, maxResults: maxResultsPerQuery });
      return { label: entry.label, feedUrl, discoveries, error: null, provider: "Google Notícias" };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 260);
      if (/HTTP 503/i.test(message)) googleCircuitOpen = true;
      return { label: entry.label, feedUrl, discoveries: [], error: message, provider: "Google Notícias" };
    }
  });

  const secondaryChecked = await mapWithConcurrency(secondaryFeeds, Math.min(concurrency, 3), async feed => {
    try {
      const response = await fetchNewsFeedWithRetry(feed.feedUrl, {
        fetchImpl: request,
        attempts: options.attempts,
        timeoutMs: options.timeoutMs,
        retryDelayMs: options.retryDelayMs,
        sleepImpl: options.sleepImpl,
        fallbackFetch: options.fallbackFetch || fetchNewsFeedWithCurl,
        nowMs: options.nowMs
      });
      if (!response.ok) throw new Error(feed.label + " respondeu HTTP " + response.status + ".");
      const contentLength = Number(response.headers?.get?.("content-length") || 0);
      if (contentLength > WEB_SEARCH_MAX_FEED_BYTES) throw new Error("O feed excede o limite de 2 MB.");
      const xml = await response.text();
      if (new TextEncoder().encode(xml).byteLength > WEB_SEARCH_MAX_FEED_BYTES) throw new Error("O feed excede o limite de 2 MB.");
      if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error("A resposta não contém um feed RSS/XML válido.");
      const discoveries = parseSecondaryNewsRss(xml, {
        now,
        feedLabel: feed.label,
        feedUrl: feed.feedUrl,
        maxResults: maxResultsPerQuery
      });
      return { label: feed.label, feedUrl: feed.feedUrl, discoveries, error: null, provider: feed.label };
    } catch (error) {
      return { label: feed.label, feedUrl: feed.feedUrl, discoveries: [], error: String(error?.message || error).slice(0, 260), provider: feed.label };
    }
  });

  const checked = [...googleChecked, ...secondaryChecked];
  const unique = new Map();
  for (const result of checked) {
    for (const item of result.discoveries) {
      const key = item.discovery_key || item.candidate_url.toLowerCase();
      const existing = unique.get(key);
      if (!existing) unique.set(key, item);
      else if (!existing.context.includes(result.label)) {
        existing.context = (existing.context + " Também apareceu na consulta: " + result.label + ".").slice(0, 1200);
      }
    }
  }

  const discoveries = [...unique.values()];
  const googleSkippedAfter503 = googleChecked.filter(item => item.skipped).length;
  return {
    provider: "Google Notícias RSS + feeds editoriais independentes",
    feedsChecked: checked.length,
    googleFeedsChecked: googleChecked.length,
    secondaryFeedsChecked: secondaryChecked.length,
    googleSkippedAfter503,
    leadCount: discoveries.length,
    errors: checked.filter(item => item.error).map(item => ({ label: item.label, error: item.error })),
    discoveries
  };
}

export function filterUnseenWebSearchDiscoveries(discoveries = [], previousKeys = [], maxKeys = 1500) {
  const limit = Math.max(100, Math.min(5000, Number(maxKeys) || 1500));
  const previous = Array.isArray(previousKeys) ? previousKeys : [];
  const known = new Set(previous.filter(key => typeof key === "string" && key.length > 0).slice(-limit));
  const fresh = [];

  for (const item of Array.isArray(discoveries) ? discoveries : []) {
    const key = String(item?.discovery_key || "");
    if (!key || known.has(key)) continue;
    known.add(key);
    fresh.push(item);
  }

  return {
    discoveries: fresh,
    keys: [...known].slice(-limit)
  };
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
  const concurrency = Math.max(1, Math.min(8, Number(process.env.MONITOR_CONCURRENCY) || 4));
  const checked = await mapWithConcurrency(urls, concurrency, async (url) => {
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

  const internetSearch = await searchInternetForContestLeads();
  const unseenWebSearch = filterUnseenWebSearchDiscoveries(
    internetSearch.discoveries,
    oldState.webSearchKeys
  );
  discoveries.push(...unseenWebSearch.discoveries);

  const prunedState = pruneSourceState(nextSources, urls);
  const removed = prunedState.removed.map((url) => ({
    type: "removed",
    url,
    message: "A fonte deixou de estar vinculada ao catálogo."
  }));

  const fallbackCount = checked.filter(entry => entry.current.ok && entry.current.transport === "curl-fallback").length;
  const report = {
    generatedAt: new Date().toISOString(),
    monitoredCount: urls.length,
    concurrency,
    fallbackCount,
    firstRun,
    internetSearch: {
      provider: internetSearch.provider,
      feedsChecked: internetSearch.feedsChecked,
      googleFeedsChecked: internetSearch.googleFeedsChecked,
      secondaryFeedsChecked: internetSearch.secondaryFeedsChecked,
      googleSkippedAfter503: internetSearch.googleSkippedAfter503,
      foundCount: internetSearch.leadCount,
      leadCount: unseenWebSearch.discoveries.length,
      errors: internetSearch.errors
    },
    changed,
    unavailable,
    added,
    removed,
    discoveries
  };
  await writeFile(STATE_PATH, JSON.stringify({
    version: 1,
    sources: prunedState.sources,
    webSearchKeys: unseenWebSearch.keys
  }, null, 2) + "\n");
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  const groups = [
    ["Páginas alteradas", changed],
    ["Fontes indisponíveis", unavailable],
    ["Novas fontes no catálogo", added],
    ["Novos links de oportunidades em fontes oficiais", discoveries.filter((item) => item.discovery_type === "new_link")],
    ["Pistas novas da busca automática na internet (não confirmadas)", unseenWebSearch.discoveries],
    ["Páginas atualizadas para revisão", discoveries.filter((item) => item.discovery_type === "page_change")],
    ["Fontes removidas do catálogo", removed]
  ];
  const lines = [
    "# Relatório de monitoramento de fontes",
    "",
    "Verificado em: " + report.generatedAt,
    "Fontes acompanhadas: " + report.monitoredCount,
    "Concorrência: " + report.concurrency + " · tentativas por fonte: 3",
    "Consultas recuperadas pelo transporte alternativo: " + report.fallbackCount,
    "Buscas automáticas na internet: " + internetSearch.feedsChecked + " feeds/consultas (" + internetSearch.googleFeedsChecked + " do Google Notícias e " + internetSearch.secondaryFeedsChecked + " editoriais; " + internetSearch.googleSkippedAfter503 + " consultas do Google pausadas após HTTP 503) · " + internetSearch.leadCount + " resultados atuais · " + unseenWebSearch.discoveries.length + " pistas novas.",
    "Falhas de consulta na internet: " + internetSearch.errors.length,
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
      "web_search_count=" + internetSearch.leadCount,
      "web_search_failed_count=" + internetSearch.errors.length,
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
