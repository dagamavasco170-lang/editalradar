import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { concursos } from "../src/data/concursos.js";
import { isTrustedOfficialHost } from "./monitor-sources.mjs";

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;

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
  const body = source
    .replace(/<(script|style|noscript|svg|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/[\t\r ]+/g, " ").replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n").trim();
  return { title, heading, text };
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
  for (const name of Object.values(STATE_NAMES)) {
    if (new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text)) return name;
  }
  return "";
}

function inferJurisdiction(hostname, organization, text) {
  const host = String(hostname || "").toLowerCase();
  const state = inferState(host, text);
  if (/^prefeitura municipal de\b/i.test(organization)) {
    return state ? { area: "Municipal", estado: state, localidade: organization.replace(/^Prefeitura Municipal de\s+/i, "") } : null;
  }
  if (state) return { area: "Estadual", estado: state, localidade: state };
  if (host === "gov.br" || host === "www.gov.br" || /\b(?:Receita Federal do Brasil|Banco Central do Brasil|Controladoria-Geral da União|Instituto Nacional do Seguro Social|Polícia Federal|Polícia Rodoviária Federal|Universidade Federal de|Instituto Federal de)\b/i.test(organization + " " + text)) {
    return { area: "Federal", estado: "Brasil", localidade: "Brasil" };
  }
  return null;
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
  const hasPositionEvidence = /\b(cargo|cargos|função|funções|vagas)\b/i.test(evidence);
  if (!hasPublicSelection || !hasNotice || !hasPositionEvidence) {
    const unrelatedTitle = /\b(transação tributária|notificações? e intimações|processo administrativo de responsabilização|licitação|ouvidoria|transparência|consulta fiscal)\b/i.test(title || discovery?.title || "");
    if (discovery?.discovery_type === "new_link" && unrelatedTitle && !hasPublicSelection) {
      return { decision: "dismiss", reason: "O conteúdo identificado trata de assunto administrativo sem evidência de concurso ou processo seletivo público." };
    }
    return { decision: "review", reason: "Não há evidências suficientes de edital de concurso/processo seletivo com cargos ou vagas." };
  }

  const orgao = inferOrganization(title + "\n" + text);
  const cargo = firstMatch(text, [
    /\bcargos?\s*(?:ofertados?|disponíveis?)?\s*[:\-]\s*([^.;\n]{3,150})/i,
    /\bcargo\s+(?:de|para)\s+([^.;\n]{3,120})/i,
    /\bvagas?\s+para\s+([^.;\n]{3,120})/i,
    /\bfunções?\s*(?:de|:)\s*([^.;\n]{3,120})/i
  ]);
  const jurisdiction = orgao ? inferJurisdiction(candidate.hostname, orgao, title + "\n" + text) : null;
  if (!orgao || !cargo || !jurisdiction) {
    const missing = [!orgao && "órgão", !cargo && "cargo/função", !jurisdiction && "esfera/estado"].filter(Boolean).join(", ");
    return { decision: "review", reason: "O edital parece relacionado a seleção pública, mas faltam dados confiáveis para cadastro automático: " + missing + "." };
  }

  const vacancyMatch = text.match(/\b(\d{1,5})\s+vagas?\b/i);
  const editalMatch = evidence.match(/\bedital\s+(?:n[º°.]?\s*)?[\w./-]{1,24}(?:\s*,?\s*de\s+\d{1,2}\s+de\s+[\p{L}]+\s+de\s+20\d{2})?/iu);
  const level = /nível\s+(?:médio|técnico)/i.test(text) ? "Médio/Técnico"
    : /nível\s+(?:superior|graduação)/i.test(text) ? "Superior"
      : /nível\s+fundamental/i.test(text) ? "Fundamental" : "A confirmar no edital";
  const status = /inscrições\s+abertas|inscricoes\s+abertas/i.test(text)
    ? "Edital publicado · inscrições abertas"
    : /inscrições\s+encerradas|inscricoes\s+encerradas/i.test(text)
      ? "Edital publicado · inscrições encerradas"
      : "Edital publicado · cronograma a confirmar";
  const atoOficial = editalMatch?.[0]?.trim() || "Edital publicado na página oficial";
  const sigla = orgao.split(/\s+/).filter(word => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}$/.test(word)).join("").slice(0, 12)
    || orgao.replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 8).toUpperCase();
  const recruitmentType = /processo\s+seletivo|seleção\s+pública/i.test(evidence) ? "Processo seletivo público" : "Concurso público";

  return {
    decision: "publish",
    reason: "Fonte oficial contém edital, seleção pública, cargo e órgão identificáveis.",
    data: {
      sigla,
      cargo: cargo.slice(0, 160),
      orgao: orgao.slice(0, 160),
      vinculo: recruitmentType + " · " + atoOficial,
      nivel: level,
      vagas: vacancyMatch ? Number(vacancyMatch[1]) : null,
      atoOficial,
      status,
      area: jurisdiction.area,
      estado: jurisdiction.estado,
      localidade: jurisdiction.localidade,
      sourceUrl: candidate.toString(),
      observacao: "Registro estruturado automaticamente pelo EditalRadar a partir da publicação oficial. Confira o edital e suas retificações antes de tomar decisões. Fonte monitorada: " + String(discovery?.source_url || "").slice(0, 500)
    }
  };
}


export function normalizeContestIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\\s+/g, " ");
}

function normalizeOfficialUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\\/+$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

export function buildRetificationUpdate(existingData, extractedData, discovery, document) {
  const text = String(document?.text || "");
  const evidence = [discovery?.title, document?.title, document?.heading, text].filter(Boolean).join("\\n");
  const isRetification = /\\b(retifica(?:ç(?:ã|a)o|ç(?:õ|o)es|do|da|dos|das)?|errata|aditivo|alteraç(?:ã|a)o do edital)\\b/i.test(evidence);
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

  const explicitVacancy = text.match(/(?:leia-se|passa(?:m)? a ser|passa(?:m)? para|totalizando|retifica(?:-se)?(?: o total de)?)\\D{0,80}(\\d{1,5})\\s+vagas?\\b/i);
  const vacancyMentions = [...text.matchAll(/\\b(\\d{1,5})\\s+vagas?\\b/gi)].map(match => Number(match[1]));
  const uniqueVacancies = [...new Set(vacancyMentions)];
  const nextVacancies = explicitVacancy
    ? Number(explicitVacancy[1])
    : uniqueVacancies.length === 1 ? uniqueVacancies[0] : null;
  if (nextVacancies !== null && Number.isInteger(nextVacancies) && nextVacancies >= 0) {
    setIfChanged("vagas", nextVacancies);
  }

  const saysOpen = /inscriç(?:ã|a)ões?\\s+(?:estão\\s+)?abertas|período de inscriç(?:ã|a)ões?\\s+aberto/i.test(text);
  const saysClosed = /inscriç(?:ã|a)ões?\\s+(?:estão\\s+)?encerradas|período de inscriç(?:ã|a)ões?\\s+encerrado/i.test(text);
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
    const metadata = execFileSync("curl", [
      "--silent",
      "--show-error",
      "--location",
      "--max-redirs", "5",
      "--connect-timeout", String(Math.min(10, Math.ceil(timeoutMs / 1000))),
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--max-filesize", String(MAX_BYTES),
      "--user-agent", "Mozilla/5.0 (compatible; EditalRadar-AutoReview/1.2; +https://github.com/dagamavasco170-lang/editalradar)",
      "--header", "Accept: text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.7",
      "--dump-header", headersPath,
      "--output", bodyPath,
      "--write-out", "%{http_code}\\n%{url_effective}\\n%{content_type}",
      candidateUrl
    ], {
      encoding: "utf8",
      timeout: timeoutMs + 5000,
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

export async function fetchCandidateWithRetry(request, candidateUrl, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 2);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || TIMEOUT_MS);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 500));
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(candidateUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; EditalRadar-AutoReview/1.2; +https://github.com/dagamavasco170-lang/editalradar)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.7"
        }
      });
      lastResponse = response;
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, retryDelayMs * attempt));
    }
  }

  const shouldUseFallback = !lastResponse || (!lastResponse.ok && (lastResponse.status >= 500 || lastResponse.status === 429));
  if (shouldUseFallback && typeof options.fallbackRequest === "function") {
    try {
      console.warn("Acesso HTTP direto falhou; tentando transporte alternativo para " + String(candidateUrl).slice(0, 240) + ".");
      const fallbackResponse = await options.fallbackRequest(candidateUrl, { timeoutMs });
      if (fallbackResponse?.ok || (fallbackResponse && fallbackResponse.status < 500 && fallbackResponse.status !== 429)) {
        return fallbackResponse;
      }
      if (fallbackResponse) lastResponse = fallbackResponse;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Falha de rede sem detalhes adicionais.");
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
  const pending = await requestJson(request, baseUrl + "/rest/v1/contest_discoveries?select=id,source_url,candidate_url,title,context,discovery_type,status&status=eq.pending&order=detected_at.asc&limit=200", key);
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

  for (const item of discoveries) {
    result.inspected += 1;
    try {
      let candidate;
      try { candidate = new URL(item.candidate_url); } catch {
        await keepPending(item, "O link armazenado não é uma URL válida.");
        continue;
      }
      if (candidate.protocol !== "https:" || !isTrustedOfficialHost(candidate.hostname)) {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, "Link descartado porque não pertence a um domínio oficial autorizado.")
        });
        result.dismissed += 1;
        continue;
      }

      let response;
      try {
        response = await fetchCandidateWithRetry(request, candidate.toString(), {
          fallbackRequest: fetchCandidateWithCurl
        });
      } catch (error) {
        await keepPending(item, "Não foi possível abrir a publicação oficial após 2 tentativas: " + summarizeFetchError(error));
        continue;
      }
      const finalUrl = response.url || candidate.toString();
      let finalHost;
      try { finalHost = new URL(finalUrl).hostname; } catch {
        await keepPending(item, "O endereço final após redirecionamento é inválido.");
        continue;
      }
      const contentType = response.headers?.get?.("content-type") || "";
      const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl);
      if (!response.ok) {
        await keepPending(item, "A fonte oficial respondeu HTTP " + response.status + ".");
        continue;
      }
      if (!isTrustedOfficialHost(finalHost)) {
        await keepPending(item, "O link redirecionou para um domínio que não está na lista de fontes oficiais autorizadas.");
        continue;
      }
      if (!isPdf && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        await keepPending(item, "Formato ainda não suportado pela extração automática: " + (contentType || "tipo de conteúdo não informado") + ".");
        continue;
      }
      const document = await extractCandidateDocument(response, item, finalUrl, contentType);
      if (!document) {
        await keepPending(item, isPdf
          ? "O PDF não contém texto extraível suficiente; pode ser digitalizado como imagem ou estar protegido."
          : "Não foi possível extrair texto legível da página oficial.");
        continue;
      }

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

      const candidateKey = normalizeOfficialUrl(candidate.toString());
      const matchingDatabase = existingRows.find(row =>
        !row.deleted
        && normalizeOfficialUrl(row.data?.sourceUrl) === candidateKey
        && normalizeContestIdentity(row.data?.orgao) === normalizeContestIdentity(decision.data.orgao)
        && normalizeContestIdentity(row.data?.cargo) === normalizeContestIdentity(decision.data.cargo)
      );
      const matchingStatic = !matchingDatabase
        ? concursos.find(row =>
          normalizeOfficialUrl(row.sourceUrl) === candidateKey
          && normalizeContestIdentity(row.orgao) === normalizeContestIdentity(decision.data.orgao)
          && normalizeContestIdentity(row.cargo) === normalizeContestIdentity(decision.data.cargo)
        )
        : null;
      const sameSourceAlreadyCatalogued = existingRows.some(row =>
        !row.deleted && normalizeOfficialUrl(row.data?.sourceUrl) === candidateKey
      ) || concursos.some(row => normalizeOfficialUrl(row.sourceUrl) === candidateKey);

      if (matchingDatabase || matchingStatic) {
        const currentRecord = matchingDatabase || matchingStatic;
        const retification = buildRetificationUpdate(currentRecord.data || currentRecord, decision.data, item, document);
        const isRetification = /\\b(retifica|errata|aditivo|alteraç(?:ã|a)o do edital)\\b/i
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

      if (sameSourceAlreadyCatalogued) {
        const isRetification = /\\b(retifica|errata|aditivo|alteraç(?:ã|a)o do edital)\\b/i
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
  console.log("Triagem automática concluída: " + JSON.stringify(result));
  if (result.errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error("Falha na triagem automática:", error);
    process.exitCode = 1;
  });
}
