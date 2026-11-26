import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { assertSupabaseServiceCredential } from "./supabase-credentials.mjs";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { concursos } from "../src/data/concursos.js";
import { sortDiscoveriesByPriority } from "../src/lib/discovery-filters.js";
import { isTrustedOfficialHost, resolveTrustedOfficialUrl, validateTrustedOfficialUrl } from "./monitor-sources.mjs";
import { resolveGoogleNewsArticleUrl } from "./google-news-url-resolver.mjs";
export { resolveGoogleNewsArticleUrl };

const execFileAsync = promisify(execFile);

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const OCR_MAX_PAGES = 12;
const OCR_MIN_PAGE_TEXT = 45;
const PDF_VERSION_SNAPSHOT_CHARS = 24000;
const OCR_PAGE_TIMEOUT_MS = 6000;

const DEFAULT_OFFICIAL_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EXTERNAL_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PENDING_DISCOVERY_TYPES = new Set(["new_link", "page_change", "web_search_lead"]);
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

function validateSecondaryNewsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Endereço da notícia secundária inválido.");
  }
  if (url.protocol !== "https:" || !isTrustedSecondaryNewsHost(url.hostname)
    || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("A notícia não pertence a um veículo secundário previamente autorizado.");
  }
  return url;
}

export function extractOfficialReferenceLinks(html, articleUrl) {
  const found = new Map();
  const anchors = String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);
  for (const match of anchors) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    const label = decodeEntities(match[2]).replace(/\s+/g, " ").trim();
    if (!href) continue;
    try {
      const url = validateTrustedOfficialUrl(new URL(href, articleUrl).href);
      url.hash = "";
      const signal = label + " " + url.pathname + " " + url.search;
      if (!/\b(edital|concursos?|processos?[-_ ]seletivos?|sele[cç][aã]o|inscri[cç][oõ]es|retifica[cç][aã]o|errata|aditivo|certame)\b/i.test(signal)) continue;
      const normalized = url.toString();
      if (normalized === articleUrl) continue;
      if (!found.has(normalized)) {
        found.set(normalized, { url: normalized, label: label.slice(0, 180) });
      }
    } catch {
      // Links externos, HTTP ou não autorizados nunca viram candidatos oficiais.
    }
  }
  return [...found.values()];
}

export async function fetchSecondaryNewsArticle(articleUrl, request = fetch, options = {}) {
  const startUrl = validateSecondaryNewsUrl(articleUrl).href;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || TIMEOUT_MS);
  const maxRedirects = Math.max(0, Math.min(5, Number(options.maxRedirects ?? 4)));
  let currentUrl = startUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await request(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EditalRadar-SecondaryDiscovery/1.0; +https://github.com/dagamavasco170-lang/editalradar)",
        Accept: "text/html,application/xhtml+xml;q=0.9"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) throw new Error("A notícia excedeu o limite de redirecionamentos seguros.");
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Redirecionamento da notícia sem destino informado.");
      const target = new URL(location, currentUrl);
      if (isTrustedOfficialHost(target.hostname)) {
        return { officialUrl: validateTrustedOfficialUrl(target.href).href, html: "", redirected: true };
      }
      currentUrl = validateSecondaryNewsUrl(target.href).href;
      continue;
    }
    if (!response.ok) throw new Error("O veículo secundário respondeu HTTP " + response.status + ".");
    const finalUrl = response.url || currentUrl;
    if (!isTrustedSecondaryNewsHost(new URL(finalUrl).hostname)) {
      throw new Error("A notícia terminou fora do veículo secundário autorizado.");
    }
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error("A página da notícia não retornou HTML.");
    }
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > MAX_BYTES) throw new Error("A página da notícia excede o limite de 4 MB.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error("A página da notícia excede o limite de 4 MB.");
    return { officialUrl: null, html: new TextDecoder("utf-8").decode(bytes), finalUrl };
  }
  throw new Error("Não foi possível abrir a notícia secundária.");
}

const STATE_NAMES = {
  ac: "Acre", al: "Alagoas", ap: "Amapá", am: "Amazonas", ba: "Bahia",
  ce: "Ceará", df: "Distrito Federal", es: "Espírito Santo", go: "Goiás",
  ma: "Maranhão", mt: "Mato Grosso", ms: "Mato Grosso do Sul", mg: "Minas Gerais",
  pa: "Pará", pb: "Paraíba", pr: "Paraná", pe: "Pernambuco", pi: "Piauí",
  rj: "Rio de Janeiro", rn: "Rio Grande do Norte", rs: "Rio Grande do Sul",
  ro: "Rondônia", rr: "Roraima", sc: "Santa Catarina", sp: "São Paulo",
  se: "Sergipe", to: "Tocantins"
};

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

export function extractDocumentText(html) {
  const source = String(html || "");
  const title = decodeEntities(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const heading = decodeEntities(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const tableRows = [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(cell => decodeEntities(cell[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()))
    .filter(row => row.some(Boolean));
  const body = source
    .replace(/<(script|style|noscript|svg|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/[\t\r ]+/g, " ").replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n").trim();
  return { title, heading, text, tableRows };
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].split(/\b(?:nível|requisitos?|remuneração|salário|vencimento|inscrições|inscricoes|jornada|vagas?)\b/i)[0]
        .replace(/[\s,:;–—-]+$/g, "").trim();
      if (value.length >= 3 && value.length <= 150) return value;
    }
  }
  return "";
}

export function inferOrganization(text) {
  const patterns = [
    /\b(Prefeitura Municipal de\s+[\p{L}'’-]+(?:\s+(?!torna\b|publica\b|abre\b|oferta\b|realiza\b|divulga\b|lança\b|informa\b|oferece\b)[\p{L}'’-]+){0,3})/iu,
    /\b(Secretaria de Estado da\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4})/iu,
    /\b(Secretaria de Estado do\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4})/iu,
    /\b(Polícia Civil do Estado de\s+[\p{L} ]{2,40})/iu,
    /\b(Polícia Militar do Estado de\s+[\p{L} ]{2,40})/iu,
    /\b(Corpo de Bombeiros Militar do Estado de\s+[\p{L} ]{2,40})/iu,
    /\b(Tribunal de Justiça do Estado (?:de|da)\s+[\p{L} ]{2,50})/iu,
    /\b(Tribunal de Contas do Estado (?:de|da)\s+[\p{L} ]{2,50})/iu,
    /\b(Defensoria Pública do Estado (?:de|da)\s+[\p{L} ]{2,50})/iu,
    /\b(Ministério Público do Estado (?:de|da)\s+[\p{L} ]{2,50})/iu,
    /\b(Procuradoria Geral do Estado (?:de|da)\s+[\p{L} ]{2,50})/iu,
    /\b(Tribunal Regional Federal da\s+\d{1,2}ª Região)/iu,
    /\b(Tribunal Regional do Trabalho da\s+\d{1,2}ª Região)/iu,
    /\b(Universidade Federal de\s+[\p{L} ]{2,50})/iu,
    /\b(Universidade Estadual de\s+[\p{L} ]{2,50})/iu,
    /\b(Instituto Federal de\s+[\p{L} ]{2,50})/iu,
    /\b(Receita Federal do Brasil|Banco Central do Brasil|Controladoria-Geral da União|Instituto Nacional do Seguro Social|Polícia Federal|Polícia Rodoviária Federal)\b/iu,
    /\b(?:órgão responsável|orgao responsavel|instituição|instituicao)\s*[:\-]\s*([^.;\n]{5,120})/iu
  ];
  return firstMatch(text, patterns);
}

function inferState(hostname, text) {
  const host = String(hostname || "").toLowerCase();
  const hostMatch = host.match(/(?:^|\.)(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\.gov\.br$/);
  if (hostMatch) return STATE_NAMES[hostMatch[1]];
  const parentheticalStates = String(text || "").match(/\(([A-Z]{2})\)/g) || [];
  for (const token of parentheticalStates) {
    const abbreviation = token.slice(1, -1).toLowerCase();
    if (STATE_NAMES[abbreviation]) return STATE_NAMES[abbreviation];
  }
  for (const name of Object.values(STATE_NAMES)) {
    if (new RegExp("\\b" + name.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + "\\b", "i").test(text)) return name;
  }
  return "";
}

function inferJurisdiction(hostname, organization, text) {
  const host = String(hostname || "").toLowerCase();
  const organizationText = String(organization || "");
  const federalOrganization = /\b(?:Receita Federal do Brasil|Banco Central do Brasil|Controladoria-Geral da União|Instituto Nacional do Seguro Social|Polícia Federal|Polícia Rodoviária Federal|Universidade Federal de|Instituto Federal de|Tribunal de Contas da União)\b/i
    .test(organizationText);

  // Classify the institution before scanning the body. Federal editais often
  // mention several states as possible locations and must remain Federal.
  if (federalOrganization) {
    return { area: "Federal", estado: "Brasil", localidade: "Brasil" };
  }

  const state = inferState(host, organizationText) || inferState(host, text);
  if (/^prefeitura municipal de\b/i.test(organizationText)) {
    return state
      ? { area: "Municipal", estado: state, localidade: organizationText.replace(/^Prefeitura Municipal de\s+/i, "") }
      : null;
  }
  if (state) return { area: "Estadual", estado: state, localidade: state };
  if (host === "gov.br" || host === "www.gov.br") {
    return { area: "Federal", estado: "Brasil", localidade: "Brasil" };
  }
  return null;
}

function uniqueCapturedNumbers(text, patterns) {
  const values = new Set();
  for (const pattern of patterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 0 && value <= 100000) values.add(value);
    }
  }
  return [...values];
}

const normalizeTableLabel = value => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

export function extractRoleNamesFromText(text = "") {
  const source = String(text || "");
  const match = source.match(/Cargo\s*\/\s*(?:Área\s*\/\s*)?Especialidade\s*:?\s*([\s\S]{0,5000})/i);
  if (!match) return [];
  const roles = [];
  for (const line of match[1].split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) {
      if (roles.length) break;
      continue;
    }
    if (/^(?:Tribunal de Justiça|Tribunal Regional|Em andamento|Última atualização|Links e Arquivos|Vencimento básico|Próximos concursos)\b/i.test(raw)) break;
    if (!/^[-*•]\s*/.test(raw)) {
      if (roles.length) break;
      continue;
    }
    const role = raw.replace(/^[-*•]\s*/, "").trim();
    if (role.length >= 3 && role.length <= 180 && !roles.includes(role)) roles.push(role);
  }
  return roles.slice(0, 30);
}

export function extractRoleNamesFromTables(tableRows = []) {
  const roles = [];
  for (let index = 0; index < tableRows.length; index += 1) {
    const header = tableRows[index].map(normalizeTableLabel);
    const roleIndex = header.findIndex(cell => /^(vaga|cargo|funcao|denominacao do cargo)$/.test(cell));
    if (roleIndex < 0) continue;
    for (const row of tableRows.slice(index + 1)) {
      const role = String(row[roleIndex] || "").replace(/\s+/g, " ").trim();
      if (!role || /^(total|quantidade|cargo|vaga)$/i.test(role)) continue;
      if (/^(?:observa[cç][aã]o|legenda|total geral)/i.test(role)) break;
      if (role.length >= 3 && role.length <= 180 && !roles.includes(role)) roles.push(role);
    }
    if (roles.length) break;
  }
  return roles.slice(0, 30);
}

function extractVacanciesFromTable(tableRows = []) {
  for (let index = 0; index < tableRows.length; index += 1) {
    const header = tableRows[index].map(normalizeTableLabel);
    const roleIndex = header.findIndex(cell => /^(vaga|cargo|funcao|denominacao do cargo)$/.test(cell));
    const quantityIndex = header.findIndex(cell => /^(qtde|qtd|quantidade|numero de vagas|vagas)$/.test(cell));
    if (roleIndex < 0 || quantityIndex < 0) continue;
    let count = 0;
    let rowsFound = 0;
    let reserveMentioned = false;
    for (const row of tableRows.slice(index + 1)) {
      const role = String(row[roleIndex] || "").trim();
      const quantity = String(row[quantityIndex] || "").trim();
      if (!role && !quantity) continue;
      if (/^(total|total geral)$/i.test(role)) continue;
      const number = quantity.match(/\b(\d{1,5})\b/);
      if (!number) continue;
      const value = Number(number[1]);
      if (!Number.isInteger(value) || value < 0 || value > 100000) continue;
      count += value;
      rowsFound += 1;
      if (/cadastro\s+de\s+reserva|\bcr\b/i.test(quantity)) reserveMentioned = true;
    }
    if (rowsFound) {
      return { total: reserveMentioned ? null : count, imediatas: count, reserva: null, fromTable: true };
    }
  }
  return null;
}

export function extractVacancyDetails(text, tableRows = []) {
  const tableDetails = extractVacanciesFromTable(tableRows);
  if (tableDetails) return tableDetails;
  const source = String(text || "");
  const immediateValues = uniqueCapturedNumbers(source, [
    /\b(\d{1,5})\s+vagas?\s+imediatas?\b/gi,
    /\b(\d{1,5})\s+vagas?\s+para\s+provimento\s+imediato\b/gi
  ]);
  const reserveValues = uniqueCapturedNumbers(source, [
    /\b(\d{1,5})\s+(?:vagas?\s+)?(?:para\s+)?cadastro\s+de\s+reserva\b/gi
  ]);
  const totalValues = uniqueCapturedNumbers(source, [
    /\btotal(?:\s+geral)?\s+de\s+vagas?\s*[:\-]?\s*(\d{1,5})\b/gi,
    /\bvagas?\s+totais?\s*[:\-]?\s*(\d{1,5})\b/gi,
    /\b(?:s[aã]o|ser[aã]o)\s+(?:oferecid[oa]s?|ofertad[oa]s?|disponibilizad[oa]s?)\s+(\d{1,5})\s+vagas?\b/gi,
    /\b(?:o\s+edital|a\s+sele[cç][aã]o|o\s+concurso|o\s+certame|certame)\s+(?:oferece|ofert[aá]|prev[eê]|disponibiliza)\s+(\d{1,5})\s+vagas?\b/gi,
    /\bvagas?\s*[:\-]\s*(\d{1,5})\b/gi
  ]);
  const imediatas = immediateValues.length === 1 ? immediateValues[0] : null;
  const reserva = reserveValues.length === 1 ? reserveValues[0] : null;
  const explicitTotal = totalValues.length === 1 ? totalValues[0] : null;
  const total = imediatas !== null && reserva !== null
    ? imediatas + reserva
    : explicitTotal !== null
      ? explicitTotal
      : imediatas;
  return { total, imediatas, reserva };
}

export function assessNoticeFreshness({ candidateUrl, title = "", heading = "", documentTitle = "", text = "" }, now = new Date()) {
  const candidate = (() => {
    try { return new URL(candidateUrl); } catch { return null; }
  })();
  const body = String(text || "");
  const statusContext = [
    String(title || ""),
    String(heading || ""),
    String(documentTitle || ""),
    body.slice(0, 1800)
  ].join(" ");
  const activeSignal = /\b(?:em andamento|inscri(?:ções|coes) abertas|período de inscrição aberto|prazo de inscrição aberto)\b/i.test(statusContext);
  const archivedSignal = /\b(?:concurso encerrado|processo seletivo encerrado|certame encerrado|concurso finalizado|processo seletivo finalizado|certame finalizado|resultado final homologado|validade(?: do concurso)? encerrada|concurso cancelado|certame cancelado)\b/i.test(statusContext);

  // Prefer the year explicitly attached to the edital; ignore copyright/footer years.
  const editalYearMatch = body.slice(0, 5000).match(/\bedital\b[^.\n]{0,120}?\b(20\d{2})\b/i);
  const pageIdentity = [
    String(title || ""),
    String(heading || ""),
    String(documentTitle || ""),
    candidate?.pathname || ""
  ].join(" ");
  const identityYearMatch = pageIdentity.match(/\b(20\d{2})\b/);

  let shortSlugYear = null;
  const segments = candidate?.pathname.split("/").filter(Boolean) || [];
  for (const segment of segments) {
    const match = segment.match(/[a-zA-Z][a-zA-Z0-9._-]*?(\d{2})$/);
    if (!match) continue;
    const value = Number(match[1]);
    shortSlugYear = value <= 39 ? 2000 + value : 1900 + value;
  }

  const contestYearMatch = body.slice(0, 2500).match(/\b(?:concurso|processo seletivo|certame)\b[^\n.]{0,150}?\b(20\d{2})\b/i);
  const editionYear = editalYearMatch
    ? Number(editalYearMatch[1])
    : identityYearMatch
      ? Number(identityYearMatch[1])
      : shortSlugYear
        ?? (contestYearMatch ? Number(contestYearMatch[1]) : null);
  const currentYear = new Date(now).getFullYear();

  if (archivedSignal && !activeSignal) {
    return { decision: "dismiss", editionYear, activeSignal, status: "Encerrado", reason: "A própria publicação oficial identifica o certame como encerrado, finalizado, homologado ou cancelado." };
  }
  if (archivedSignal && activeSignal) {
    return { decision: "review", editionYear, activeSignal, status: "Situação conflitante", reason: "A publicação contém sinais contraditórios de situação atual e encerramento; exige conferência humana." };
  }
  if (editionYear !== null && editionYear <= currentYear - 2 && !activeSignal) {
    return { decision: "dismiss", editionYear, activeSignal, status: "Arquivo histórico", reason: "O edital identificado é de " + editionYear + " e a fonte não comprova que o certame continua em andamento." };
  }
  if (editionYear === null && !activeSignal) {
    return { decision: "review", editionYear, activeSignal, status: "Ano/situação a confirmar", reason: "Não foi possível confirmar o ano do edital nem um sinal oficial de vigência atual." };
  }
  if (editionYear !== null && editionYear < currentYear && !activeSignal) {
    return { decision: "review", editionYear, activeSignal, status: "Ano anterior · situação a confirmar", reason: "O edital é de " + editionYear + " e não há sinal explícito de que o certame permaneça em andamento." };
  }

  const status = /\binscri(?:ções|coes) abertas\b/i.test(statusContext)
    ? "Inscrições abertas"
    : activeSignal ? "Em andamento" : "Edital publicado · situação a confirmar";
  return { decision: "publish", editionYear, activeSignal, status, reason: "Ano/situação atual compatível com publicação automática." };
}

const NON_OPPORTUNITY_ARTIFACT_PATTERN = /\b(?:tipo\s*\d+|cadernos?(?:\s+de)?\s+(?:provas?|quest[oõ]es?)|provas?(?:\s+(?:objetivas?|discursivas?))?|gabaritos?|cart[aã]o\s+respostas?|folhas?\s+de\s+respostas?|resultados?(?:\s+(?:preliminares?|finais?))?|classifica[cç][aã]o|convoca[cç][aã]o)\b/i;

export function getNonOpportunityArtifactReason(discovery = {}, candidateUrl = discovery?.candidate_url) {
  if (!["new_link", "page_change"].includes(discovery?.discovery_type)) return "";
  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(candidateUrl).pathname);
  } catch {
    return "";
  }
  const title = String(discovery?.title || "");
  const identity = (pathname + " " + title).replace(/[-_.\/]+/g, " ");
  if (!NON_OPPORTUNITY_ARTIFACT_PATTERN.test(identity)) return "";
  return "O link identifica material auxiliar de avaliação (caderno/tipo de prova, gabarito, resultado, classificação ou convocação), não a publicação de abertura de um concurso. O documento não pode ser cadastrado como uma oportunidade independente.";
}

export function classifyDiscovery(discovery, document, responseUrl = discovery?.candidate_url) {
  const artifactReason = getNonOpportunityArtifactReason(discovery, responseUrl);
  if (artifactReason) return { decision: "dismiss", reason: artifactReason };

  let candidate;
  try {
    candidate = new URL(responseUrl);
  } catch {
    return { decision: "review", reason: "O link não pôde ser validado." };
  }
  if (candidate.protocol !== "https:" || !isTrustedOfficialHost(candidate.hostname)) {
    return { decision: "review", reason: "A publicação não terminou em um domínio oficial autorizado." };
  }

  const text = String(document?.text || "");
  const title = String(document?.heading || document?.title || discovery?.title || "").trim();
  const evidence = (title + "\n" + text).slice(0, 300000);
  const hasPublicSelection = /\b(concurso\s+público|processo\s+seletivo(?:\s+simplificado)?|seleção\s+pública)\b/i.test(evidence);
  const hasNotice = /\bedital\b/i.test(evidence);
  const tableRoles = extractRoleNamesFromTables(document?.tableRows);
  const textRoles = extractRoleNamesFromText(text);
  const detectedRoles = [...new Set([...tableRoles, ...textRoles])];
  const hasPositionEvidence = /\b(cargo|cargos|função|funções|vagas)\b/i.test(evidence) || detectedRoles.length > 0;
  const hasExplicitRetification = /\b(retifica|retificação|retificações|retificacao|retificacoes|errata|aditivo|alteração do edital|alteracao do edital)\b/i
    .test([discovery?.title, document?.title, document?.heading].filter(Boolean).join(" "));
  const selectionEvidence = hasPublicSelection || (hasExplicitRetification && hasNotice);
  if (!selectionEvidence || !hasNotice || !hasPositionEvidence) {
    const unrelatedTitle = /\b(transação tributária|atos? declaratórios? executivos?|notificações? e intimações|processo administrativo de responsabilização|licitação|ouvidoria|transparência|consulta fiscal|leilão|procurações?|pregão|contratos? administrativos?|consultar editais? e ade?s)\b/i.test(title || discovery?.title || "");
    if (discovery?.discovery_type === "new_link" && unrelatedTitle && !hasPublicSelection) {
      return { decision: "dismiss", reason: "O conteúdo identificado trata de assunto administrativo sem evidência de concurso ou processo seletivo público." };
    }
    return { decision: "review", reason: "Não há evidências suficientes de edital de concurso/processo seletivo com cargos ou vagas." };
  }

  const freshness = assessNoticeFreshness({
    candidateUrl: candidate.toString(),
    title,
    heading: document?.heading || "",
    documentTitle: document?.title || "",
    text
  });
  if (freshness.decision !== "publish") {
    return { decision: freshness.decision, reason: freshness.reason, editionYear: freshness.editionYear };
  }

  const orgao = inferOrganization(title + "\n" + text);
  const cargo = detectedRoles[0] || firstMatch(text, [
    /\bcargos?\s*(?:ofertados?|disponíveis?)?\s*[:\-]\s*([^.;\n]{3,150})/i,
    /\bcargo\s+(?:de|para)\s+([^.;\n]{3,120}?)(?=\s+(?:do|da)\s+(?:Tribunal|Prefeitura|Secretaria|Ministério|Defensoria|Procuradoria)\b|[.;\n]|$)/i,
    /\bvagas?\s+para\s+([^.;\n]{3,120})/i,
    /\bfunções?\s*(?:de|:)\s*([^.;\n]{3,120})/i
  ]);
  const jurisdiction = orgao ? inferJurisdiction(candidate.hostname, orgao, title + "\n" + text) : null;
  if (!orgao || !cargo || !jurisdiction) {
    const missing = [!orgao && "órgão", !cargo && "cargo/função", !jurisdiction && "esfera/estado"].filter(Boolean).join(", ");
    return { decision: "review", reason: "O edital parece relacionado a seleção pública, mas faltam dados confiáveis para cadastro automático: " + missing + "." };
  }

  const vacancies = extractVacancyDetails(text, document?.tableRows);
  const editalMatch = evidence.match(/\bedital\s+(?:n[º°.]?\s*)?[\w./-]{1,24}(?:\s*,?\s*de\s+\d{1,2}\s+de\s+[\p{L}]+\s+de\s+20\d{2})?/iu);
  const educationHeaderIndex = (document?.tableRows || []).findIndex(row =>
    row.some(cell => /^(escolaridade|nível|nivel)$/i.test(String(cell || "").trim()))
  );
  const educationColumnIndex = educationHeaderIndex >= 0
    ? (document.tableRows[educationHeaderIndex] || []).findIndex(cell => /^(escolaridade|nível|nivel)$/i.test(String(cell || "").trim()))
    : -1;
  const tableEducation = educationHeaderIndex >= 0 && educationColumnIndex >= 0
    ? document.tableRows.slice(educationHeaderIndex + 1).map(row => String(row[educationColumnIndex] || "")).join(" ")
    : "";
  const levelEvidence = text + " " + tableEducation;
  const level = /(?:nível\s+)?(?:médio|técnico)/i.test(levelEvidence) ? "Médio/Técnico"
    : /(?:nível\s+)?(?:superior|graduação)/i.test(levelEvidence) ? "Superior"
      : /(?:nível\s+)?fundamental/i.test(levelEvidence) ? "Fundamental" : "A confirmar no edital";
  // Historic pages can contain old "inscrições abertas" or "encerradas" snippets.
  // New automatic records remain conservative until a dated review.
  const status = freshness.status;
  const atoOficial = editalMatch?.[0]?.trim() || "Edital publicado na página oficial";
  const sigla = orgao.split(/\s+/).filter(word => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}$/.test(word)).join("").slice(0, 12)
    || orgao.replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 8).toUpperCase();
  const recruitmentType = /processo\s+seletivo|seleção\s+pública/i.test(evidence) ? "Processo seletivo público" : "Concurso público";

  return {
    decision: "publish",
    reason: "Fonte oficial contém edital, seleção pública, cargo e órgão identificáveis. " + freshness.reason,
    data: {
      sigla,
      cargo: cargo.slice(0, 160),
      orgao: orgao.slice(0, 160),
      vinculo: recruitmentType + " · " + atoOficial,
      nivel: level,
      vagas: vacancies.total,
      vagasImediatas: vacancies.imediatas,
      cadastroReserva: vacancies.reserva,
      atoOficial,
      status,
      area: jurisdiction.area,
      estado: jurisdiction.estado,
      localidade: jurisdiction.localidade,
      sourceUrl: candidate.toString(),
      verificacaoAutomatica: {
        em: new Date().toISOString(),
        fonte: candidate.toString(),
        sinais: ["publicação oficial", "edital", recruitmentType.toLowerCase(), "órgão identificado", "cargo identificado", "jurisdição identificada", "vigência temporal avaliada: " + (freshness.editionYear || freshness.status)]
      },
      observacao: "Registro estruturado automaticamente pelo EditalRadar a partir da publicação oficial. A situação das inscrições permanece a confirmar porque a página pode conter referências históricas. Confira o edital e suas retificações antes de tomar decisões."
        + (detectedRoles.length > 1 ? " Cargos identificados na publicação oficial: " + detectedRoles.slice(0, 12).join("; ") + (detectedRoles.length > 12 ? "; entre outros" : "") + "." : "")
        + (vacancies.fromTable ? " Quantidade extraída da coluna de quantidade da tabela oficial; cadastro de reserva não somado quando não quantificado." : "")
        + " Fonte monitorada: " + String(discovery?.source_url || "").slice(0, 500)
    }
  };
}


export function normalizeContestIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeOfficialUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    const trackingKeys = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|vero_id|ref_src|ref_url)$/i;
    for (const key of [...url.searchParams.keys()]) if (trackingKeys.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizePdfVersionText(value) {
  return String(value || "").normalize("NFC").replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ").split("\n").map(line => line.trim())
    .filter(line => line && !/^(?:p[aá]gina\s+)?\d{1,4}(?:\s+de\s+\d{1,4})?$/i.test(line))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function compareDocumentVersions(previousText, currentText) {
  const previous = normalizePdfVersionText(previousText);
  const current = normalizePdfVersionText(currentText);
  const previousLines = new Set(previous.split("\n").filter(Boolean));
  const currentLines = new Set(current.split("\n").filter(Boolean));
  const removed = [...previousLines].filter(line => !currentLines.has(line));
  const added = [...currentLines].filter(line => !previousLines.has(line));
  const changedText = [...removed, ...added].join("\n");
  const criticalPatterns = [
    ["prazos", /\b(inscriç|inscricao|prazo|cronograma|data limite|até dia|ate dia)\b/i],
    ["provas", /\b(prova|avaliaç|avaliac|exame|etapa)\b/i],
    ["vagas", /\b(vagas?|cadastro de reserva|classificaç|classificac)\b/i],
    ["remuneração", /\b(sal[aá]rio|remuneraç|vencimento|subs[ií]dio)\b/i],
    ["taxas", /\b(taxa|isenç|isenc|pagamento|valor da inscriç)\b/i],
    ["conteúdo programático", /\b(conte[uú]do program[aá]tico|programa|disciplinas|bibliografia)\b/i]
  ];
  return {
    previousSha256: createHash("sha256").update(previous).digest("hex"),
    currentSha256: createHash("sha256").update(current).digest("hex"),
    changed: previous !== current,
    addedLineCount: added.length,
    removedLineCount: removed.length,
    addedLines: added.slice(0, 30),
    removedLines: removed.slice(0, 30),
    criticalAreas: criticalPatterns.filter(([, pattern]) => pattern.test(changedText)).map(([name]) => name),
    truncated: previous.length > PDF_VERSION_SNAPSHOT_CHARS || current.length > PDF_VERSION_SNAPSHOT_CHARS
  };
}

export function findMatchingContestForRetification({
  candidateUrl,
  extractedData,
  existingRows = [],
  baseCatalog = concursos
}) {
  const targetOrganization = normalizeContestIdentity(extractedData?.orgao);
  const targetPosition = normalizeContestIdentity(extractedData?.cargo);
  if (!targetOrganization || !targetPosition) return null;

  const recordsById = new Map();
  for (const item of baseCatalog) {
    if (item?.id == null) continue;
    recordsById.set(String(item.id), {
      kind: "static",
      id: Number(item.id),
      data: { ...item }
    });
  }

  for (const row of existingRows) {
    if (row?.id == null) continue;
    if (row.deleted) {
      recordsById.delete(String(row.id));
      continue;
    }
    const key = String(row.id);
    const baseRecord = recordsById.get(key);
    recordsById.set(key, {
      kind: "database",
      id: Number(row.id),
      data: { ...(baseRecord?.data || {}), ...(row.data || {}), id: Number(row.id) }
    });
  }

  const candidates = [...recordsById.values()].filter(record =>
    normalizeContestIdentity(record.data?.orgao) === targetOrganization
    && normalizeContestIdentity(record.data?.cargo) === targetPosition
  );
  if (!candidates.length) return null;

  const candidateKey = normalizeOfficialUrl(candidateUrl);
  const exactUrlMatches = candidates.filter(record =>
    normalizeOfficialUrl(record.data?.sourceUrl) === candidateKey
  );
  if (exactUrlMatches.length === 1) return exactUrlMatches[0];
  if (exactUrlMatches.length > 1) return null;

  let candidateHost = "";
  try { candidateHost = new URL(candidateUrl).hostname.toLowerCase(); } catch { return null; }
  const sameOfficialHost = candidates.filter(record => {
    try {
      const source = new URL(record.data?.sourceUrl);
      return source.protocol === "https:" && source.hostname.toLowerCase() === candidateHost;
    } catch {
      return false;
    }
  });

  // Só atualiza quando a combinação órgão + cargo e o domínio oficial
  // apontam para exatamente um registro. Em concursos repetidos/ambíguos,
  // a descoberta continua na fila para evitar alterar o concurso errado.
  return sameOfficialHost.length === 1 ? sameOfficialHost[0] : null;
}


function parseRetificationDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || "").trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const date = new Date(year, month, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return match[0];
}

function uniqueBrazilianDate(part) {
  const matches = [...String(part || "").matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)]
    .map(match => parseRetificationDate(match[0]))
    .filter(Boolean);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function uniqueBrazilianMoney(part) {
  const matches = [...String(part || "").matchAll(/(?:R\$\s*)?(\d{1,6}(?:\.\d{3})*,\d{2})\b/g)]
    .map(match => match[1]);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function uniqueRetificationCount(part) {
  const matches = [...String(part || "").matchAll(/\b(\d{1,5})\b/g)]
    .map(match => Number(match[1]))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 100000);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function amountAsNumber(value) {
  const normalized = String(value ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function extractReadAsCorrections(text) {
  const source = String(text || "");
  const corrections = [];
  const expression = /onde\s+se\s+l[eê]\s*[:\-]?([\s\S]{0,180}?)\bleia-se\b([\s\S]{0,180}?)(?=(?:\.(?=\s|$)|\n|$))/gi;
  for (const match of source.matchAll(expression)) {
    corrections.push({
      oldText: String(match[1] || "").trim(),
      newText: String(match[2] || "").trim()
    });
  }
  return corrections;
}

function formatRetificationObservation(existing, lines) {
  const additions = [...new Set(lines.filter(Boolean))];
  if (!additions.length) return existing || "";
  const block = "[Retificação oficial monitorada] " + additions.join(" ");
  const current = String(existing || "").trim();
  if (current.includes(block)) return current;
  return [current, block].filter(Boolean).join("\n\n").slice(-5000);
}

export function buildRetificationUpdate(existingData, extractedData, discovery, document) {
  const text = String(document?.text || "");
  const evidence = [discovery?.title, document?.title, document?.heading, text].filter(Boolean).join("\n");
  const isRetification = /\b(retifica(?:ç(?:ã|a)o|ç(?:õ|o)es|do|da|dos|das)?|errata|aditivo|alteraç(?:ã|a)o do edital)\b/i.test(evidence);
  if (!isRetification) {
    return { updated: false, reason: "A publicação não apresenta evidência explícita de retificação ou errata." };
  }

  const sameOrganization = normalizeContestIdentity(existingData?.orgao) !== ""
    && normalizeContestIdentity(existingData?.orgao) === normalizeContestIdentity(extractedData?.orgao);
  const samePosition = normalizeContestIdentity(existingData?.cargo) !== ""
    && normalizeContestIdentity(existingData?.cargo) === normalizeContestIdentity(extractedData?.cargo);
  if (!sameOrganization || !samePosition) {
    return { updated: false, reason: "A retificação foi identificada, mas o órgão e o cargo não correspondem exatamente ao registro existente." };
  }

  const updatedData = { ...existingData };
  const changes = [];
  const setIfChanged = (field, nextValue) => {
    if (nextValue === undefined || nextValue === null || nextValue === "") return;
    const previous = updatedData[field] ?? null;
    const previousComparable = previous && typeof previous === "object" ? JSON.stringify(previous) : String(previous ?? "");
    const nextComparable = nextValue && typeof nextValue === "object" ? JSON.stringify(nextValue) : String(nextValue);
    if (previousComparable === nextComparable) return;
    changes.push({ field, oldValue: previous, newValue: nextValue });
    updatedData[field] = nextValue;
  };

  const corrections = extractReadAsCorrections(text);
  const correctionNotes = [];
  const handledVacancyFields = new Set();

  for (const correction of corrections) {
    const correctionText = (correction.oldText + " " + correction.newText).toLocaleLowerCase("pt-BR");

    if (/\bvagas?\b/.test(correctionText)) {
      const oldCount = uniqueRetificationCount(correction.oldText);
      const newCount = uniqueRetificationCount(correction.newText);
      const field = /\bvagas?\s+imediatas?\b/.test(correctionText)
        ? "vagasImediatas"
        : /cadastro\s+de\s+reserva/.test(correctionText)
          ? "cadastroReserva"
          : "vagas";
      handledVacancyFields.add(field);
      const currentValue = updatedData[field];
      if (oldCount !== null && newCount !== null && oldCount !== newCount
        && (currentValue == null || Number(currentValue) === oldCount)) {
        setIfChanged(field, newCount);
      }
    }

    // Remuneração só é atualizada quando a correção traz um valor antigo e
    // um novo valor monetário inequívocos, com indicação explícita de moeda.
    if (/remuneraç|salário|vencimento|subsídio|vencimento básico/i.test(correctionText)) {
      const oldMoney = uniqueBrazilianMoney(correction.oldText);
      const newMoney = uniqueBrazilianMoney(correction.newText);
      if (oldMoney && newMoney && /R\$/i.test(correction.oldText + " " + correction.newText)) {
        const existingRemuneration = updatedData.remuneracao ?? updatedData.salario
          ?? updatedData.salarioInicial ?? updatedData.remuneracaoInicial ?? updatedData.vencimento;
        const existingAmount = existingRemuneration && typeof existingRemuneration === "object"
          ? existingRemuneration.valor
          : existingRemuneration;
        const currentNumber = amountAsNumber(existingAmount);
        const oldNumber = amountAsNumber(oldMoney);
        if (currentNumber == null || oldNumber == null || currentNumber === oldNumber) {
          setIfChanged("remuneracao", {
            ...(existingRemuneration && typeof existingRemuneration === "object" ? existingRemuneration : {}),
            valor: "R$ " + newMoney,
            natureza: "Valor atualizado por retificação oficial"
          });
          if (oldMoney !== newMoney) correctionNotes.push("Remuneração alterada de R$ " + oldMoney + " para R$ " + newMoney + ".");
        }
      }
    }

    const oldDate = uniqueBrazilianDate(correction.oldText);
    const newDate = uniqueBrazilianDate(correction.newText);
    if (oldDate && newDate && oldDate !== newDate) {
      if (/inscriç|inscricao|prazo/i.test(correctionText)) {
        setIfChanged("prazoInscricao", newDate);
        correctionNotes.push("Prazo de inscrição alterado de " + oldDate + " para " + newDate + ".");
        if (/abert|até|ate/i.test(correction.newText)) {
          setIfChanged("status", "Edital publicado · inscrições até " + newDate);
        }
      } else if (/prova|avaliaç|avaliac|exame/i.test(correctionText)) {
        setIfChanged("dataProva", newDate);
        correctionNotes.push("Data da prova alterada de " + oldDate + " para " + newDate + ".");
      } else if (/resultado|homologaç|homologac|classificaç|classificac/i.test(correctionText)) {
        setIfChanged("dataResultado", newDate);
        correctionNotes.push("Data de resultado/homologação alterada de " + oldDate + " para " + newDate + ".");
      }
    }

    if (/inscriç|inscricao|período de inscrição|periodo de inscricao/i.test(correctionText)) {
      if (/encerrad|finalizad/i.test(correction.newText)) {
        setIfChanged("status", "Edital publicado · inscrições encerradas");

      } else if (/abert/i.test(correction.newText)) {
        setIfChanged("status", "Edital publicado · inscrições abertas");

      }
    }
  }

  // Correções de vagas que não informam "onde se lê / leia-se" continuam
  // aceitas apenas quando há um valor novo explícito e não conflitante.
  const explicitVacancy = text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+vagas?\b/i)
    || text.match(/\bpassa(?:m)? para\D{0,40}(\d{1,5})\s+vagas?\b/i)
    || text.match(/\btotalizando\D{0,40}(\d{1,5})\s+vagas?\b/i);
  // A menção isolada a "N vagas" não prova que N seja o valor corrigido.
  // Sem "passam a ser/para", "totalizando" ou par "onde se lê/leia-se",
  // a alteração permanece para revisão humana.
  const nextVacancies = explicitVacancy ? Number(explicitVacancy[1]) : null;
  if (!handledVacancyFields.has("vagas") && nextVacancies !== null
    && Number.isInteger(nextVacancies) && nextVacancies >= 0) {
    setIfChanged("vagas", nextVacancies);
  }

  const immediateRetification = text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+vagas?\s+imediatas?\b/i);
  if (!handledVacancyFields.has("vagasImediatas") && immediateRetification) {
    setIfChanged("vagasImediatas", Number(immediateRetification[1]));
  }
  const reserveRetification = text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+(?:vagas?\s+)?(?:para\s+)?cadastro de reserva\b/i);
  if (!handledVacancyFields.has("cadastroReserva") && reserveRetification) {
    setIfChanged("cadastroReserva", Number(reserveRetification[1]));
  }

  if (correctionNotes.length) {
    setIfChanged("observacao", formatRetificationObservation(updatedData.observacao, correctionNotes));
  }

  if (!changes.length) {
    return {
      updated: false,
      reason: "Retificação identificada, mas não há campo objetivo que possa ser atualizado com segurança. O item permanece para revisão."
    };
  }

  const history = Array.isArray(existingData?.historicoAtualizacoes)
    ? existingData.historicoAtualizacoes
    : [];
  const previousVersion = [...history].reverse().find(entry => entry?.documentVersion?.textSnapshot);
  const normalizedDocumentText = normalizePdfVersionText(text);
  const versionComparison = previousVersion
    ? compareDocumentVersions(previousVersion.documentVersion.textSnapshot, normalizedDocumentText)
    : null;
  const historyEntry = {
    at: new Date().toISOString(),
    type: "retificacao",
    title: String(discovery?.title || document?.title || "Retificação oficial").slice(0, 240),
    sourceUrl: normalizeOfficialUrl(discovery?.source_url || ""),
    candidateUrl: normalizeOfficialUrl(discovery?.candidate_url || extractedData?.sourceUrl || ""),
    changes,
    documentVersion: {
      sha256: createHash("sha256").update(normalizedDocumentText).digest("hex"),
      textSnapshot: normalizedDocumentText.slice(0, PDF_VERSION_SNAPSHOT_CHARS),
      snapshotTruncated: normalizedDocumentText.length > PDF_VERSION_SNAPSHOT_CHARS,
      comparison: versionComparison
    }
  };
  updatedData.historicoAtualizacoes = [...history, historyEntry].slice(-30);

  return {
    updated: true,
    data: updatedData,
    changes,
    reason: "Retificação oficial confirmada para o mesmo órgão e cargo; campos objetivos atualizados e versão anterior preservada no histórico."
  };
}
export async function readPdfText(buffer) {
  let extractedText = "";
  let pageCount = 0;
  let pageTexts = [];
  let directory = "";
  try {
    const info = execFileSync("pdfinfo", ["-"], { input: buffer, encoding: "utf8", maxBuffer: 256 * 1024, timeout: TIMEOUT_MS });
    pageCount = Number(info.match(/^Pages:\s+(\d+)/mi)?.[1] || 0);
  } catch {}
  try {
    extractedText = execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: buffer, encoding: "utf8", maxBuffer: MAX_BYTES * 8, timeout: TIMEOUT_MS
    }).trim();
    pageTexts = extractedText.split("\f").map(page => page.trim());
  } catch {}
  if (!pageCount) pageCount = Math.max(1, pageTexts.length);
  const sparsePages = pageTexts
    .map((page, index) => ({ page: index + 1, length: page.replace(/\s/g, "").length }))
    .filter(item => item.length < OCR_MIN_PAGE_TEXT).map(item => item.page);
  const selected = new Set([1, 2, 3].filter(page => page <= pageCount));
  for (const page of sparsePages) {
    if (selected.size >= OCR_MAX_PAGES) break;
    selected.add(page);
  }
  if (sparsePages.length >= pageCount && selected.size < OCR_MAX_PAGES && pageCount > selected.size) {
    const slots = OCR_MAX_PAGES - selected.size;
    for (let index = 1; index <= slots; index += 1) {
      const page = Math.round(index * pageCount / (slots + 1));
      if (page >= 1 && page <= pageCount) selected.add(page);
    }
  }
  if (!selected.size) return extractedText;
  try {
    directory = await mkdtemp(join(tmpdir(), "editalradar-ocr-"));
    const pdfPath = join(directory, "source.pdf");
    await writeFile(pdfPath, buffer);
    const ocrText = [];
    for (const page of [...selected].sort((a, b) => a - b)) {
      const prefix = join(directory, "page-" + String(page).padStart(4, "0"));
      try {
        await execFileAsync("pdftoppm", [
          "-f", String(page), "-l", String(page), "-r", "120", "-png", pdfPath, prefix
        ], { encoding: "utf8", timeout: 12000, maxBuffer: 128 * 1024 });
        const imagePath = (await readdir(directory))
          .find(name => name.startsWith("page-" + String(page).padStart(4, "0")) && name.endsWith(".png"));
        if (!imagePath) continue;
        const { stdout } = await execFileAsync("tesseract", [
          join(directory, imagePath), "stdout", "-l", "por+eng", "--psm", "6"
        ], { encoding: "utf8", timeout: OCR_PAGE_TIMEOUT_MS, maxBuffer: 512 * 1024 });
        if (stdout.trim()) ocrText.push("[Página " + page + "]\n" + stdout.trim());
      } catch {}
    }
    const ocrCombined = ocrText.join("\n\n").trim();
    if (!ocrCombined) return extractedText;
    if (extractedText.length < 120) return ocrCombined;
    const digitalPages = pageTexts.map((page, index) => page.trim()
      ? "[Página " + (index + 1) + "]\n" + page.trim() : "").filter(Boolean);
    return [...digitalPages, ocrCombined].join("\n\n").slice(0, MAX_BYTES * 8);
  } catch {
    return extractedText;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
async function extractCandidateDocument(response, item, finalUrl, contentType) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return null;
  const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl);
  if (isPdf) {
    const text = await readPdfText(bytes);
    if (text.length < 120) return null;
    return { title: item.title || "", heading: item.title || "", text };
  }
  if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) return null;
  return extractDocumentText(bytes.toString("utf8"));
}

export function summarizeFetchError(error) {
  const cause = error?.cause || {};
  const details = [error?.message, cause.code, cause.message]
    .filter(Boolean)
    .map(value => String(value).trim());
  return [...new Set(details)].join(" · ").slice(0, 400)
    || "Erro de rede sem detalhes adicionais.";
}

export async function fetchCandidateWithCurl(candidateUrl, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || TIMEOUT_MS);
  const directory = await mkdtemp(join(tmpdir(), "editalradar-curl-"));
  const bodyPath = join(directory, "response-body.bin");
  const headersPath = join(directory, "response-headers.txt");

  try {
    const { stdout: metadata } = await execFileAsync("curl", [
      "--silent",
      "--show-error",
      "--max-redirs", "0",
      "--connect-timeout", String(Math.min(5, Math.ceil(timeoutMs / 1000))),
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--max-filesize", String(MAX_BYTES),
      "--user-agent", "Mozilla/5.0 (compatible; EditalRadar-AutoReview/1.3; +https://github.com/dagamavasco170-lang/editalradar)",
      "--header", "Accept: text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.7",
      "--dump-header", headersPath,
      "--output", bodyPath,
      "--write-out", "%{http_code}\n%{url_effective}\n%{content_type}",
      candidateUrl
    ], {
      encoding: "utf8",
      timeout: timeoutMs + 1500,
      maxBuffer: 64 * 1024
    });

    const metadataLines = metadata.trim().split("\n");
    const status = Number(metadataLines[0]);
    const finalUrl = metadataLines[1] || candidateUrl;
    const contentType = metadataLines[2] || "";
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error("curl não retornou um status HTTP válido.");
    }

    const rawHeaders = await readFile(headersPath, "utf8");
    const responseHeaders = {};
    let currentHeaders = {};
    for (const line of rawHeaders.split(String.fromCharCode(13, 10))) {
      if (line.startsWith("HTTP/")) {
        if (Object.keys(currentHeaders).length) Object.assign(responseHeaders, currentHeaders);
        currentHeaders = {};
      } else {
        const separator = line.indexOf(":");
        if (separator > 0) {
          const name = line.slice(0, separator).trim().toLowerCase();
          const value = line.slice(separator + 1).trim();
          currentHeaders[name] = currentHeaders[name] ? currentHeaders[name] + ", " + value : value;
        }
      }
    }
    Object.assign(responseHeaders, currentHeaders);
    if (contentType && !responseHeaders["content-type"]) responseHeaders["content-type"] = contentType;

    const body = await readFile(bodyPath);
    if (body.byteLength > MAX_BYTES) throw new Error("Resposta excede o limite de 4 MB.");
    return {
      ok: status >= 200 && status < 300,
      status,
      url: finalUrl,
      headers: new Headers(responseHeaders),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function requestWithSafeRedirects(request, startUrl, timeoutMs) {
  let currentUrl = validateTrustedOfficialUrl(startUrl).href;
  const maxRedirects = 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await request(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EditalRadar-AutoReview/1.3; +https://github.com/dagamavasco170-lang/editalradar)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.7"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) {
        const error = new Error("A publicação excedeu o limite de redirecionamentos seguros.");
        error.code = "UNSAFE_REDIRECT";
        throw error;
      }
      currentUrl = resolveTrustedOfficialUrl(currentUrl, response.headers?.get?.("location"));
      continue;
    }
    return response;
  }
  throw new Error("Não foi possível resolver o endereço oficial.");
}

export async function fetchCandidateWithRetry(request, candidateUrl, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 1);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || TIMEOUT_MS);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 500));
  const safeStartUrl = validateTrustedOfficialUrl(candidateUrl).href;
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResponse = await requestWithSafeRedirects(request, safeStartUrl, timeoutMs);
      const blockedByProvider = [401, 403].includes(lastResponse.status);
      if (lastResponse.ok || (!blockedByProvider && lastResponse.status < 500 && lastResponse.status !== 429)) return lastResponse;
      lastError = new Error("HTTP " + lastResponse.status);
      if (blockedByProvider) break;
    } catch (error) {
      if (error?.code === "UNSAFE_REDIRECT") throw error;
      lastError = error;
    }

    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, retryDelayMs * attempt));
    }
  }

  const shouldUseFallback = !lastResponse || (!lastResponse.ok && (
    lastResponse.status === 401
    || lastResponse.status === 403
    || lastResponse.status === 429
    || lastResponse.status >= 500
  ));
  if (shouldUseFallback && typeof options.fallbackRequest === "function") {
    try {
      console.warn("Acesso HTTP direto falhou; tentando transporte alternativo para " + safeStartUrl.slice(0, 240) + ".");
      const fallbackResponse = await requestWithSafeRedirects(options.fallbackRequest, safeStartUrl, timeoutMs);
      if (fallbackResponse?.ok || (fallbackResponse && fallbackResponse.status < 500 && fallbackResponse.status !== 429)) {
        return fallbackResponse;
      }
      if (fallbackResponse) lastResponse = fallbackResponse;
    } catch (error) {
      if (error?.code === "UNSAFE_REDIRECT") throw error;
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Falha de rede sem detalhes adicionais.");
}

export async function mapWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  const concurrency = Math.max(1, Math.min(items.length || 1, Number(limit) || 1));
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

export function buildPendingDiscoveriesUrl(
  baseUrl,
  now = new Date(),
  cooldownMs = DEFAULT_OFFICIAL_RETRY_COOLDOWN_MS,
  discoveryTypes = ["new_link", "page_change", "web_search_lead"]
) {
  const types = [...new Set((Array.isArray(discoveryTypes) ? discoveryTypes : [])
    .filter(type => PENDING_DISCOVERY_TYPES.has(type)))];
  if (!types.length) throw new Error("Informe ao menos um tipo permitido de descoberta para consultar a fila.");

  const url = new URL("/rest/v1/contest_discoveries", baseUrl);
  const retryBefore = new Date(now.getTime() - Math.max(0, Number(cooldownMs) || 0)).toISOString();
  url.searchParams.set("select", "id,source_url,candidate_url,title,context,discovery_type,status,detected_at,reviewed_at");
  url.searchParams.set("status", "eq.pending");
  // Pistas externas nunca usam news.google.com como prova; sua cadência é menor
  // para que links oficiais monitorados recebam prioridade e capacidade de rede.
  // Páginas source_baseline continuam fora da publicação automática.
  url.searchParams.set("discovery_type", "in.(" + types.join(",") + ")");
  url.searchParams.set("or", "(reviewed_at.is.null,reviewed_at.lt." + retryBefore + ")");
  url.searchParams.set("order", "reviewed_at.asc.nullsfirst,detected_at.asc");
  url.searchParams.set("limit", "300");
  return url.toString();
}


export function extractDeclaredPublisherUrl(context = "") {
  const match = String(context || "").match(/Endereço informado para a fonte:\s*(https:\/\/[^\s<>"]+)/i);
  if (!match) return null;
  try {
    const url = new URL(match[1].replace(/[),.;]+$/, ""));
    if (url.protocol !== "https:" || url.username || url.password || !isTrustedOfficialHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function prioritizePendingDiscoveries(items = [], now = Date.now()) {
  const pending = (Array.isArray(items) ? items : [])
    .filter(item => item?.status === "pending");
  // First-touch rows must move ahead of retries, otherwise older reviewed
  // discoveries can repeatedly occupy the batch and starve untouched records.
  const neverReviewed = pending.filter(item => !item.reviewed_at);
  const retryable = pending.filter(item => Boolean(item.reviewed_at));
  return [
    ...sortDiscoveriesByPriority(neverReviewed, now),
    ...sortDiscoveriesByPriority(retryable, now)
  ];
}

export function selectDiscoveriesForTriage(official = [], external = [], maxItems = 40, now = Date.now()) {
  const eligible = prioritizePendingDiscoveries([
    ...(Array.isArray(official) ? official : []),
    ...(Array.isArray(external) ? external : [])
  ], now);
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(maxItems) || 40)));
  const discoveries = eligible.slice(0, limit);
  return {
    eligible,
    discoveries,
    limit,
    deferred: Math.max(0, eligible.length - discoveries.length)
  };
}


const UNRELATED_ADMINISTRATIVE_TITLE_PATTERNS = [
  /\b(?:atos? declarat[oó]rios? executivos?)\b/i,
  /\bconsulta(?:r)? editais? e ades?\b/i,
  /\b(?:avisos? de )?(?:edital|editais) de leil[aã]o\b/i,
  /\bprocuraç(?:ão|ões|ao|oes)\s*\(autorizaç(?:ão|ões|ao|oes) de acesso\)/i,
  /\bprocesso administrativo de responsabilizaç(?:ão|ao)\b/i,
  /\bconsulta fiscal\b/i,
  /\blicitaç(?:ão|ao)\b/i,
  /\bpreg(?:ão|ao)\b/i
];

export function isClearlyUnrelatedAdministrativeDiscovery(item = {}) {
  if (!["new_link", "page_change"].includes(item.discovery_type)) return false;
  const title = String(item.title || "").normalize("NFC");
  const candidate = String(item.candidate_url || "");
  let pathname = "";
  try { pathname = new URL(candidate).pathname; } catch { /* O título ainda pode ser avaliado. */ }
  const text = title + " " + pathname;
  return UNRELATED_ADMINISTRATIVE_TITLE_PATTERNS.some(pattern => pattern.test(text));
}

const GENERIC_OFFICIAL_LANDING_SEGMENTS = new Set([
  "home", "inicio", "index", "index.html", "index.htm", "index.php",
  "portal", "site", "principal",
  "concursos", "concursos-publicos", "concursos-abertos",
  "editais", "processos-seletivos", "selecao", "seletivos",
  "inscricoes", "inscricoes-abertas", "abertos",
  "em-andamento", "resultados", "resultados-disponiveis"
]);

export function isGenericOfficialLandingPage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return true;
    const segments = decodeURIComponent(url.pathname)
      .split("/")
      .filter(Boolean)
      .map(segment => segment.toLowerCase());
    if (segments.length === 0) return true;

    const isGenericSegment = segment =>
      GENERIC_OFFICIAL_LANDING_SEGMENTS.has(segment) || /^v\d+$/.test(segment);
    const lastSegment = segments[segments.length - 1];

    // A página pode ser profunda (por exemplo /acesso-a-informacao/concursos/concursos-publicos),
    // mas se termina numa listagem genérica, não identifica um certame específico.
    return segments.every(isGenericSegment) || isGenericSegment(lastSegment);
  } catch {
    return true;
  }
}

export async function prepareDiscoveryDocument(item, request = fetch, options = {}) {
  const artifactReason = getNonOpportunityArtifactReason(item, item?.candidate_url);
  if (artifactReason) return { stage: "dismiss", reason: artifactReason };

  if (isClearlyUnrelatedAdministrativeDiscovery(item)) {
    return {
      stage: "dismiss",
      reason: "O título e o endereço identificam um serviço administrativo sem relação com concurso ou processo seletivo (por exemplo, leilão, ADE, procuração ou licitação). O link foi descartado sem tentativa de download."
    };
  }

  let candidate;
  let candidateValue = item?.candidate_url;
  if (item?.discovery_type === "web_search_lead") {
    // Google Notícias continua exigindo um publisher oficial declarado.
    // Feeds editoriais independentes só podem encaminhar para um único link oficial
    // encontrado no artigo e depois validado pelo mesmo pipeline de edital.
    const declaredSource = extractDeclaredPublisherUrl(item?.context);
    let secondaryCandidate = null;
    try {
      const initial = new URL(candidateValue);
      if (isTrustedOfficialHost(initial.hostname)) {
        candidateValue = validateTrustedOfficialUrl(initial.href).href;
      } else if (declaredSource) {
        const resolvedArticle = await resolveGoogleNewsArticleUrl(
          item?.candidate_url,
          declaredSource.href,
          request,
          { timeoutMs: options.timeoutMs ?? TIMEOUT_MS, maxRedirects: options.newsRedirectMaxHops ?? 5 }
        );
        if (!resolvedArticle) {
          return {
            stage: "review",
            reason: "O link do Google Notícias não revelou um endereço verificável da publicação no domínio oficial indicado. A pista permanece pendente, sem cadastro automático."
          };
        }
        candidateValue = resolvedArticle;
      } else if (isTrustedSecondaryNewsHost(initial.hostname)) {
        secondaryCandidate = initial.href;
      } else {
        return {
          stage: "review",
          reason: "A pista não aponta para um domínio oficial nem para um veículo editorial auxiliar autorizado. Continua pendente, sem cadastro automático."
        };
      }
    } catch (error) {
      return {
        stage: "review",
        reason: "Não foi possível validar a origem da notícia: " + summarizeFetchError(error)
      };
    }

    if (secondaryCandidate) {
      try {
        const article = await fetchSecondaryNewsArticle(secondaryCandidate, request, {
          timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
          maxRedirects: options.secondaryNewsRedirectMaxHops ?? 4
        });
        if (article.officialUrl) {
          candidateValue = article.officialUrl;
        } else {
          const references = extractOfficialReferenceLinks(article.html, article.finalUrl || secondaryCandidate);
          if (references.length !== 1) {
            return {
              stage: "review",
              reason: references.length === 0
                ? "A notícia secundária não revelou link direto para um edital ou comunicado em domínio oficial autorizado. A pista permanece pendente."
                : "A notícia contém mais de um link oficial possível. A triagem não escolhe entre editais ambíguos e mantém a pista para revisão."
            };
          }
          candidateValue = references[0].url;
        }
      } catch (error) {
        return {
          stage: "review",
          reason: "Não foi possível examinar a notícia secundária com segurança: " + summarizeFetchError(error)
        };
      }
    }
  }

  try {
    candidate = new URL(candidateValue);
  } catch {
    return { stage: "review", reason: "O link armazenado não é uma URL válida." };
  }

  if (candidate.protocol !== "https:" || !isTrustedOfficialHost(candidate.hostname)) {
    return { stage: "dismiss", reason: "Link descartado porque não pertence a um domínio oficial autorizado." };
  }

  const candidateUrl = candidate.toString();
  if (/^\/concursos\/status\/(?:novos|inscricoes-abertas|em-andamento|resultados-disponiveis|finalizados)\/?$/i.test(candidate.pathname)) {
    return { stage: "dismiss", reason: "Página geral de categoria da banca; aguardando links diretos de cada concurso, não uma ficha de edital." };
  }
  if (isGenericOfficialLandingPage(candidateUrl)) {
    return {
      stage: "review",
      reason: "O endereço oficial aponta para uma página inicial, índice ou listagem genérica, não para um edital ou página específica de concurso. A pista permanece pendente para revisão humana."
    };
  }
  let response;
  try {
    response = await fetchCandidateWithRetry(request, candidateUrl, {
      attempts: options.attempts ?? 1,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
      retryDelayMs: options.retryDelayMs ?? 0,
      fallbackRequest: options.fallbackRequest || fetchCandidateWithCurl
    });
  } catch (error) {
    return {
      stage: "review",
      reason: "Não foi possível abrir a publicação oficial: " + summarizeFetchError(error)
    };
  }

  const finalUrl = response.url || candidateUrl;
  let finalHost;
  try {
    finalHost = new URL(finalUrl).hostname;
  } catch {
    return { stage: "review", reason: "O endereço final após redirecionamento é inválido." };
  }

  const contentType = response.headers?.get?.("content-type") || "";
  const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl);
  if (!response.ok) {
    if ([404, 410].includes(response.status)) {
      return { stage: "dismiss", reason: "O endereço oficial respondeu HTTP " + response.status + " e não está mais disponível; o link foi encerrado automaticamente, sem criar uma ficha incompleta." };
    }
    return { stage: "review", reason: "A fonte oficial respondeu HTTP " + response.status + "." };
  }
  if (!isTrustedOfficialHost(finalHost)) {
    return { stage: "review", reason: "O link redirecionou para um domínio que não está na lista de fontes oficiais autorizadas." };
  }
  if (isGenericOfficialLandingPage(finalUrl)) {
    return {
      stage: "review",
      reason: "A publicação redirecionou para uma página inicial ou listagem genérica, sem apontar ao documento específico do concurso. A pista continua pendente para revisão humana."
    };
  }
  if (!isPdf && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
    return {
      stage: "review",
      reason: "Formato ainda não suportado pela extração automática: " + (contentType || "tipo de conteúdo não informado") + "."
    };
  }

  let document;
  try {
    document = await extractCandidateDocument(response, item, finalUrl, contentType);
  } catch (error) {
    return { stage: "review", reason: "Falha ao extrair o documento oficial: " + summarizeFetchError(error) };
  }
  if (!document) {
    return {
      stage: "review",
      reason: isPdf
        ? "O PDF não contém texto extraível suficiente; pode estar digitalizado como imagem ou protegido."
        : "Não foi possível extrair texto legível da página oficial."
    };
  }

  return {
    stage: "ready",
    candidateUrl,
    finalUrl,
    contentType,
    document
  };
}

function headersFor(key, extra = {}) {
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    ...extra
  };
}

export function buildNonActionablePendingDiscoveriesUrl(baseUrl) {
  const url = new URL("/rest/v1/contest_discoveries", baseUrl);
  url.searchParams.set("select", "id,source_url,candidate_url,title,context,discovery_type,status");
  url.searchParams.set("status", "eq.pending");
  url.searchParams.set("discovery_type", "eq.source_baseline");
  url.searchParams.set("order", "detected_at.asc");
  url.searchParams.set("limit", "1000");
  return url.toString();
}

export async function dismissNonActionablePendingDiscoveries(request, baseUrl, key) {
  const rows = await requestJson(request, buildNonActionablePendingDiscoveriesUrl(baseUrl), key) || [];
  for (const item of rows) {
    await updateDiscovery(request, baseUrl, key, item, {
      status: "dismissed",
      context: appendContext(
        item.context,
        "Linha de base inicial; não representa uma oportunidade nova e não exige revisão."
      )
    });
  }
  return rows.length;
}

export async function countPendingDiscoveries(request, baseUrl, key) {
  const url = new URL("/rest/v1/contest_discoveries", baseUrl);
  url.searchParams.set("select", "id");
  url.searchParams.set("status", "eq.pending");
  url.searchParams.set("discovery_type", "in.(new_link,page_change,web_search_lead)");
  const response = await request(url.toString(), {
    method: "HEAD",
    headers: headersFor(key, { Prefer: "count=exact", Range: "0-0" })
  });
  if (!response.ok) {
    throw new Error("Não foi possível confirmar o total de pendências no Supabase (HTTP " + response.status + ").");
  }
  const contentRange = response.headers?.get?.("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) throw new Error("O Supabase não informou a contagem exata de pendências.");
  return Number(match[1]);
}

export async function requestJson(request, url, key, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  // Avoid replaying a non-idempotent catalog insert after an ambiguous timeout.
  // GET/PATCH/DELETE and explicit PostgREST upserts can be retried safely.
  const retryable = ["GET", "HEAD", "PATCH", "DELETE"].includes(method)
    || (method === "POST" && new URL(url).searchParams.has("on_conflict"));
  const attempts = Math.max(1, Math.min(4, Number(options.retryAttempts) || (retryable ? 4 : 1)));
  const retryDelayMs = Math.max(100, Math.min(3000, Number(options.retryDelayMs) || 350));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      const {
        retryAttempts: _retryAttempts,
        retryDelayMs: _retryDelayMs,
        ...requestOptions
      } = options;
      response = await request(url, {
        ...requestOptions,
        headers: headersFor(key, options.headers || {})
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryable) throw error;
    }

    if (response) {
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const error = new Error("Supabase retornou HTTP " + response.status + ": " + detail.slice(0, 400));
        error.status = response.status;
        const transient = response.status === 408 || response.status === 425
          || response.status === 429 || response.status >= 500;
        if (!retryable || !transient || attempt >= attempts) throw error;
        lastError = error;
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(10000, retryAfter * 1000)
          : retryDelayMs * attempt;
        await new Promise(resolveDelay => setTimeout(resolveDelay, wait));
        continue;
      }
      if (response.status === 204) return null;
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    }

    if (attempt < attempts) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, retryDelayMs * attempt));
    }
  }
  throw lastError || new Error("Falha ao consultar o Supabase após as tentativas automáticas.");
}

async function updateDiscovery(request, baseUrl, key, item, patch) {
  await requestJson(request, baseUrl + "/rest/v1/contest_discoveries?id=eq." + encodeURIComponent(item.id), key, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, reviewed_at: new Date().toISOString() })
  });
}

export function appendContext(existing, reason) {
  const original = String(existing || "")
    .replace(/\n\n\[Triagem automática do EditalRadar\][\s\S]*$/i, "")
    .trim();
  return (original + "\n\n[Triagem automática do EditalRadar] " + reason + " (verificado em " + new Date().toISOString() + ")")
    .trim().slice(0, 4000);
}

export async function autoResolvePending(options = {}) {
  const baseUrl = String(options.supabaseUrl || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!baseUrl || !key) throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes da triagem automática.");
  if (new URL(baseUrl).protocol !== "https:") throw new Error("SUPABASE_URL precisa usar HTTPS.");
  assertSupabaseServiceCredential(key, "SUPABASE_SERVICE_ROLE_KEY (triagem automática)");

  const request = options.fetchImpl || fetch;
  const now = options.now instanceof Date ? options.now : new Date();
  const officialCooldownMs = Math.max(0, Number(options.officialCooldownMs) || DEFAULT_OFFICIAL_RETRY_COOLDOWN_MS);
  const externalCooldownMs = Math.max(0, Number(options.externalCooldownMs) || DEFAULT_EXTERNAL_RETRY_COOLDOWN_MS);
  // "source_baseline" marks the first snapshot of a source, not a new contest.
  // Close these housekeeping rows before counting the actionable review queue.
  const baselineDismissed = await dismissNonActionablePendingDiscoveries(request, baseUrl, key);
  if (baselineDismissed) {
    console.log("Linhas de base iniciais encerradas automaticamente: " + baselineDismissed + ".");
  }
  const [officialPending, externalPending] = await Promise.all([
    requestJson(request, buildPendingDiscoveriesUrl(
      baseUrl, now, officialCooldownMs, ["new_link", "page_change"]
    ), key),
    requestJson(request, buildPendingDiscoveriesUrl(
      baseUrl, now, externalCooldownMs, ["web_search_lead"]
    ), key)
  ]);
  const officialItems = Array.isArray(officialPending) ? officialPending : [];
  const externalItems = Array.isArray(externalPending) ? externalPending : [];
  const selection = selectDiscoveriesForTriage(
    officialItems,
    externalItems,
    options.maxItems ?? 40,
    now.getTime()
  );
  const discoveries = selection.discoveries;
  const queuePriorities = selection.eligible.reduce((counts, item) => {
    const level = item.discovery_type === "web_search_lead" ? "pistas_externas" : "fontes_monitoradas";
    counts[level] = (counts[level] || 0) + 1;
    return counts;
  }, {});
  console.log("Cadência da fila: fontes oficiais " + Math.round(officialCooldownMs / 3600000) +
    "h; pistas externas " + Math.round(externalCooldownMs / 3600000) + "h.");
  console.log("Fila elegível: " + selection.eligible.length + "; limite desta rodada: " +
    selection.limit + "; reservadas para próximas rodadas: " + selection.deferred + ".");
  console.log("Fila elegível ordenada por evidência e primeira análise: " + JSON.stringify(queuePriorities) + ".");
  if (!discoveries.length) {
    let pendingTotal = null;
    let errors = 0;
    try {
      pendingTotal = await countPendingDiscoveries(request, baseUrl, key);
    } catch (error) {
      errors = 1;
      console.error("Não foi possível confirmar o total de pendências:", error.message);
    }
    return {
      inspected: 0, published: 0, updated: 0, dismissed: 0,
      eligible: selection.eligible.length, deferred: selection.deferred, maxItems: selection.limit,
      baselineDismissed, pending: 0, errors, pendingTotal
    };
  }

  const existingRows = await requestJson(request, baseUrl + "/rest/v1/contest_catalog?select=id,data,deleted&limit=1000", key) || [];
  const result = {
    inspected: 0, published: 0, updated: 0, dismissed: 0,
    eligible: selection.eligible.length, deferred: selection.deferred, maxItems: selection.limit,
    baselineDismissed, pending: 0, errors: 0, pendingReasons: {}
  };
  const keepPending = async (item, reason) => {
    result.pending += 1;
    const label = String(reason || "Não foi possível confirmar os dados na fonte oficial.").slice(0, 500);
    result.pendingReasons[label] = (result.pendingReasons[label] || 0) + 1;
    console.log("Pendente #" + item.id + " [" + String(item.candidate_url || "").slice(0, 300) + "]: " + label);
    await updateDiscovery(request, baseUrl, key, item, {
      status: "pending",
      context: appendContext(item.context, label)
    });
  };

  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 8));
  const preparedDiscoveries = await mapWithConcurrency(discoveries, concurrency, async item => {
    try {
      return await prepareDiscoveryDocument(item, request, {
        timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
        attempts: options.attempts ?? 4,
        retryDelayMs: options.retryDelayMs ?? 600,
        fallbackRequest: options.fallbackRequest || fetchCandidateWithCurl
      });
    } catch (error) {
      return { stage: "review", reason: "Falha técnica ao consultar a fonte: " + summarizeFetchError(error) };
    }
  });
  console.log("Pré-análise concluída: " + discoveries.length + " oportunidades, concorrência " + concurrency + ".");

  for (let index = 0; index < discoveries.length; index += 1) {
    const item = discoveries[index];
    const prepared = preparedDiscoveries[index];
    result.inspected += 1;
    try {
      if (prepared.stage === "dismiss") {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, prepared.reason)
        });
        result.dismissed += 1;
        continue;
      }
      if (prepared.stage !== "ready") {
        await keepPending(item, prepared.reason || "Não foi possível analisar a publicação oficial.");
        continue;
      }

      const { candidateUrl, finalUrl, document } = prepared;
      const decision = classifyDiscovery(item, document, finalUrl);
      if (decision.decision === "dismiss") {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, decision.reason)
        });
        result.dismissed += 1;
        continue;
      }
      if (decision.decision !== "publish") {
        await keepPending(item, decision.reason || "A evidência não é suficiente para preencher a ficha automaticamente.");
        continue;
      }

      const matchingContest = findMatchingContestForRetification({
        candidateUrl,
        extractedData: decision.data,
        existingRows
      });
      const matchingDatabase = matchingContest?.kind === "database" ? matchingContest : null;
      const matchingStatic = matchingContest?.kind === "static" ? matchingContest : null;
      const sameSourceAlreadyCatalogued = existingRows.some(row =>
        !row.deleted && normalizeOfficialUrl(row.data?.sourceUrl) === normalizeOfficialUrl(candidateUrl)
      ) || concursos.some(row => normalizeOfficialUrl(row.sourceUrl) === normalizeOfficialUrl(candidateUrl));

      if (matchingDatabase || matchingStatic) {
        const currentRecord = matchingDatabase || matchingStatic;
        const retification = buildRetificationUpdate(currentRecord.data || currentRecord, decision.data, item, document);
        const isRetification = /\b(retifica|errata|aditivo|alteraç(?:ã|a)o do edital)\b/i
          .test([item.title, document.title, document.heading, document.text].filter(Boolean).join(" "));
        if (retification.updated) {
          const targetId = Number(currentRecord.id);
          if (matchingDatabase) {
            await requestJson(request, baseUrl + "/rest/v1/contest_catalog?id=eq." + encodeURIComponent(targetId), key, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
              body: JSON.stringify({ data: retification.data, deleted: false, updated_at: new Date().toISOString() })
            });
            matchingDatabase.data = retification.data;
          } else {
            const savedOverride = await requestJson(request, baseUrl + "/rest/v1/contest_catalog?on_conflict=id", key, {
              method: "POST",
              headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
              body: JSON.stringify({ id: targetId, data: retification.data, deleted: false, updated_at: new Date().toISOString() })
            });
            const override = Array.isArray(savedOverride) ? savedOverride[0] : savedOverride;
            if (override?.id == null) throw new Error("O Supabase não confirmou a atualização do concurso-base.");
            existingRows.push({ id: targetId, data: retification.data, deleted: false });
          }
          await updateDiscovery(request, baseUrl, key, item, {
            status: "published",
            published_catalog_id: targetId,
            context: appendContext(item.context, retification.reason + " Campos: " + retification.changes.map(change => change.field).join(", ") + ".")
          });
          result.updated += 1;
          result.published += 1;
          continue;
        }

        if (isRetification) {
          await keepPending(item, retification.reason);
        } else {
          await updateDiscovery(request, baseUrl, key, item, {
            status: "dismissed",
            published_catalog_id: Number(currentRecord.id),
            context: appendContext(item.context, "Duplicata identificada: a publicação já corresponde a um concurso cadastrado e não apresenta retificação atualizável.")
          });
          result.dismissed += 1;
        }
        continue;
      }

      const isRetificationDocument = /\b(retifica|errata|aditivo|alteraç(?:ã|a)o do edital)\b/i
        .test([item.title, document.title, document.heading, document.text].filter(Boolean).join(" "));
      if (isRetificationDocument && !matchingContest) {
        await keepPending(item, "Retificação identificada, mas não foi possível associar com segurança a um único concurso já cadastrado. Nenhum novo concurso foi criado.");
        continue;
      }

      if (sameSourceAlreadyCatalogued) {
        const isRetification = /\b(retifica|errata|aditivo|alteraç(?:ã|a)o do edital)\b/i
          .test([item.title, document.title, document.heading, document.text].filter(Boolean).join(" "));
        if (isRetification) {
          await keepPending(item, "Retificação detectada em fonte já cadastrada, mas o órgão e o cargo extraídos não correspondem com segurança a um registro específico do catálogo.");
        } else {
          await updateDiscovery(request, baseUrl, key, item, {
            status: "dismissed",
            context: appendContext(item.context, "A fonte oficial já está representada no catálogo.")
          });
          result.dismissed += 1;
        }
        continue;
      }

      const inserted = await requestJson(request, baseUrl + "/rest/v1/contest_catalog", key, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ data: decision.data, deleted: false, updated_at: new Date().toISOString() })
      });
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!saved?.id) throw new Error("O Supabase não retornou o ID do registro cadastrado.");
      existingRows.push({ id: saved.id, data: decision.data, deleted: false });

      await updateDiscovery(request, baseUrl, key, item, {
        status: "published",
        published_catalog_id: Number(saved.id),
        context: appendContext(item.context, decision.reason + " Cadastro automático realizado no catálogo.")
      });
      result.published += 1;
    } catch (error) {
      result.errors += 1;
      console.error("Falha ao processar descoberta " + item.id + ":", error.message);
      try {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "pending",
          context: appendContext(item.context, "Falha técnica durante a triagem: " + String(error?.message || error).slice(0, 250))
        });
      } catch {
        console.error("Não foi possível registrar o motivo da pendência #" + item.id + ".");
      }
    }
  }
  result.pending += result.errors;
  try {
    result.pendingTotal = await countPendingDiscoveries(request, baseUrl, key);
  } catch (error) {
    result.pendingTotal = null;
    result.errors += 1;
    result.pending += 1;
    console.error("Não foi possível confirmar o total de pendências:", error.message);
  }
  console.log("Motivos das pendências: " + JSON.stringify(result.pendingReasons));
  return result;
}

async function main() {
  const result = await autoResolvePending({
    concurrency: Number(process.env.TRIAGE_CONCURRENCY) || 8,
    attempts: Number(process.env.TRIAGE_ATTEMPTS) || 4,
    timeoutMs: Number(process.env.TRIAGE_TIMEOUT_MS) || TIMEOUT_MS,
    retryDelayMs: Number(process.env.TRIAGE_RETRY_DELAY_MS) || 600,
    officialCooldownMs: Number(process.env.TRIAGE_OFFICIAL_COOLDOWN_HOURS || 6) * 60 * 60 * 1000,
    externalCooldownMs: Number(process.env.TRIAGE_EXTERNAL_COOLDOWN_HOURS || 6) * 60 * 60 * 1000,
    maxItems: Number(process.env.TRIAGE_MAX_ITEMS) || 40
  });
  const summary = [
    "## Triagem automática de oportunidades",
    "",
    "- Oportunidades elegíveis: " + (result.eligible ?? result.inspected),
    "- Analisadas nesta rodada: " + result.inspected,
    "- Reservadas para as próximas rodadas: " + (result.deferred || 0) + " (limite por rodada: " + (result.maxItems || 40) + ")",
    "- Publicadas: " + result.published,
    "- Atualizadas: " + (result.updated || 0),
    "- Descartadas: " + result.dismissed,
    "- Linhas de base iniciais encerradas automaticamente: " + (result.baselineDismissed || 0),
    "- Aguardando revisão nesta execução: " + result.pending,
    "- Pendências totais no banco: " + (Number.isInteger(result.pendingTotal) ? result.pendingTotal : "não foi possível confirmar"),
    "- Falhas técnicas: " + result.errors,
    "",
    result.pendingReasons && Object.keys(result.pendingReasons).length
      ? "Motivos: " + JSON.stringify(result.pendingReasons)
      : "Sem pendências técnicas nesta execução."
  ].join("\n");
  console.log("Triagem automática concluída: " + JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const output = [
      "eligible_count=" + (result.eligible ?? result.inspected),
      "deferred_count=" + (result.deferred || 0),
      "max_items=" + (result.maxItems || 40),
      "inspected_count=" + result.inspected,
      "published_count=" + result.published,
      "updated_count=" + (result.updated || 0),
      "dismissed_count=" + result.dismissed,
      "baseline_dismissed_count=" + (result.baselineDismissed || 0),
      "pending_count=" + result.pending,
      "pending_total_count=" + (Number.isInteger(result.pendingTotal) ? result.pendingTotal : "unknown"),
      "error_count=" + result.errors,
      ""
    ].join("\n");
    await appendFile(process.env.GITHUB_OUTPUT, output);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }
  if (result.errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error("Falha na triagem automática:", error);
    process.exitCode = 1;
  });
}
