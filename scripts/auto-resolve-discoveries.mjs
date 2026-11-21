import { pathToFileURL } from "node:url";
import { appendFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { concursos } from "../src/data/concursos.js";
import { isTrustedOfficialHost, resolveTrustedOfficialUrl, validateTrustedOfficialUrl } from "./monitor-sources.mjs";

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 8000;

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

export function classifyDiscovery(discovery, document, responseUrl = discovery?.candidate_url) {
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
    const unrelatedTitle = /\b(transação tributária|notificações? e intimações|processo administrativo de responsabilização|licitação|ouvidoria|transparência|consulta fiscal)\b/i.test(title || discovery?.title || "");
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

function normalizeOfficialUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
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
    if (String(previous) === String(nextValue)) return;
    changes.push({ field, oldValue: previous, newValue: nextValue });
    updatedData[field] = nextValue;
  };

  const explicitVacancy = text.match(/\bleia-se\D{0,40}(\d{1,5})\s+vagas?\b/i)
    || text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+vagas?\b/i)
    || text.match(/\bpassa(?:m)? para\D{0,40}(\d{1,5})\s+vagas?\b/i)
    || text.match(/\btotalizando\D{0,40}(\d{1,5})\s+vagas?\b/i);
  const vacancyMentions = [...text.matchAll(/\b(\d{1,5})\s+vagas?\b/gi)].map(match => Number(match[1]));
  const uniqueVacancies = [...new Set(vacancyMentions)];
  const nextVacancies = explicitVacancy
    ? Number(explicitVacancy[1])
    : uniqueVacancies.length === 1 ? uniqueVacancies[0] : null;
  if (nextVacancies !== null && Number.isInteger(nextVacancies) && nextVacancies >= 0) {
    setIfChanged("vagas", nextVacancies);
  }

  const immediateRetification = text.match(/\bleia-se\D{0,40}(\d{1,5})\s+vagas?\s+imediatas?\b/i)
    || text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+vagas?\s+imediatas?\b/i);
  if (immediateRetification) setIfChanged("vagasImediatas", Number(immediateRetification[1]));
  const reserveRetification = text.match(/\bleia-se\D{0,40}(\d{1,5})\s+(?:vagas?\s+)?(?:para\s+)?cadastro de reserva\b/i)
    || text.match(/\bpassa(?:m)? a ser\D{0,40}(\d{1,5})\s+(?:vagas?\s+)?(?:para\s+)?cadastro de reserva\b/i);
  if (reserveRetification) setIfChanged("cadastroReserva", Number(reserveRetification[1]));

  const saysOpen = /inscrições\s+(?:estão\s+)?abertas|período de inscrições\s+aberto/i.test(text);
  const saysClosed = /inscrições\s+(?:estão\s+)?encerradas|período de inscrições\s+encerrado/i.test(text);
  if (saysOpen !== saysClosed) {
    setIfChanged("status", saysOpen
      ? "Edital publicado · inscrições abertas"
      : "Edital publicado · inscrições encerradas");
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
  const historyEntry = {
    at: new Date().toISOString(),
    type: "retificacao",
    title: String(discovery?.title || document?.title || "Retificação oficial").slice(0, 240),
    sourceUrl: normalizeOfficialUrl(discovery?.source_url || ""),
    candidateUrl: normalizeOfficialUrl(discovery?.candidate_url || extractedData?.sourceUrl || ""),
    changes
  };
  updatedData.historicoAtualizacoes = [...history, historyEntry].slice(-30);

  return {
    updated: true,
    data: updatedData,
    changes,
    reason: "Retificação oficial confirmada para o mesmo órgão e cargo; campos objetivos atualizados e versão anterior preservada no histórico."
  };
}

function readPdfText(buffer) {
  try {
    return execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: buffer,
      encoding: "utf8",
      maxBuffer: MAX_BYTES * 8,
      timeout: TIMEOUT_MS
    }).trim();
  } catch {
    return "";
  }
}

async function extractCandidateDocument(response, item, finalUrl, contentType) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return null;
  const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl);
  if (isPdf) {
    const text = readPdfText(bytes);
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

export function buildPendingDiscoveriesUrl(baseUrl, now = new Date(), cooldownMs = 6 * 60 * 60 * 1000) {
  const url = new URL("/rest/v1/contest_discoveries", baseUrl);
  const retryBefore = new Date(now.getTime() - cooldownMs).toISOString();
  url.searchParams.set("select", "id,source_url,candidate_url,title,context,discovery_type,status");
  url.searchParams.set("status", "eq.pending");
  // Only direct newly discovered links are safe candidates for automatic publishing.
  // Page-wide changes and baseline pages stay visible for human review.
  url.searchParams.set("discovery_type", "eq.new_link");
  url.searchParams.set("or", "(reviewed_at.is.null,reviewed_at.lt." + retryBefore + ")");
  url.searchParams.set("order", "detected_at.asc");
  url.searchParams.set("limit", "200");
  return url.toString();
}

export async function prepareDiscoveryDocument(item, request = fetch, options = {}) {
  let candidate;
  try {
    candidate = new URL(item?.candidate_url);
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
    return { stage: "review", reason: "A fonte oficial respondeu HTTP " + response.status + "." };
  }
  if (!isTrustedOfficialHost(finalHost)) {
    return { stage: "review", reason: "O link redirecionou para um domínio que não está na lista de fontes oficiais autorizadas." };
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

async function requestJson(request, url, key, options = {}) {
  const response = await request(url, {
    ...options,
    headers: headersFor(key, options.headers || {})
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Supabase retornou HTTP " + response.status + ": " + detail.slice(0, 400));
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
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

  const request = options.fetchImpl || fetch;
  const pending = await requestJson(request, buildPendingDiscoveriesUrl(baseUrl), key);
  const discoveries = Array.isArray(pending) ? pending : [];
  if (!discoveries.length) return { inspected: 0, published: 0, dismissed: 0, pending: 0, errors: 0 };

  const existingRows = await requestJson(request, baseUrl + "/rest/v1/contest_catalog?select=id,data,deleted&limit=1000", key) || [];
  const result = { inspected: 0, published: 0, updated: 0, dismissed: 0, pending: 0, errors: 0, pendingReasons: {} };
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

  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 5));
  const preparedDiscoveries = await mapWithConcurrency(discoveries, concurrency, async item => {
    try {
      return await prepareDiscoveryDocument(item, request, {
        timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
        attempts: options.attempts ?? 3,
        retryDelayMs: options.retryDelayMs ?? 750,
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
  console.log("Motivos das pendências: " + JSON.stringify(result.pendingReasons));
  return result;
}

async function main() {
  const result = await autoResolvePending();
  const summary = [
    "## Triagem automática de oportunidades",
    "",
    "- Analisadas: " + result.inspected,
    "- Publicadas: " + result.published,
    "- Atualizadas: " + (result.updated || 0),
    "- Descartadas: " + result.dismissed,
    "- Aguardando revisão: " + result.pending,
    "- Falhas técnicas: " + result.errors,
    "",
    result.pendingReasons && Object.keys(result.pendingReasons).length
      ? "Motivos: " + JSON.stringify(result.pendingReasons)
      : "Sem pendências técnicas nesta execução."
  ].join("\n");
  console.log("Triagem automática concluída: " + JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const output = [
      "inspected_count=" + result.inspected,
      "published_count=" + result.published,
      "updated_count=" + (result.updated || 0),
      "dismissed_count=" + result.dismissed,
      "pending_count=" + result.pending,
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
