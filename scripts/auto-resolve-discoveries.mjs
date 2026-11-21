import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
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

function appendContext(existing, reason) {
  return (String(existing || "") + "\n\n[Triagem automática do EditalRadar] " + reason).trim().slice(0, 4000);
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
  const result = { inspected: 0, published: 0, dismissed: 0, pending: 0, errors: 0 };

  for (const item of discoveries) {
    result.inspected += 1;
    try {
      let candidate;
      try { candidate = new URL(item.candidate_url); } catch { result.pending += 1; continue; }
      if (candidate.protocol !== "https:" || !isTrustedOfficialHost(candidate.hostname)) {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, "Link descartado porque não pertence a um domínio oficial autorizado.")
        });
        result.dismissed += 1;
        continue;
      }

      const existing = existingRows.find(row => !row.deleted && row.data?.sourceUrl === candidate.toString());
      if (existing) {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "published",
          published_catalog_id: Number(existing.id),
          context: appendContext(item.context, "Duplicata identificada: o link já existe no catálogo.")
        });
        result.published += 1;
        continue;
      }
      const staticDuplicate = concursos.some(row => row.sourceUrl === candidate.toString());
      if (staticDuplicate) {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, "O link já está representado no catálogo-base do aplicativo.")
        });
        result.dismissed += 1;
        continue;
      }

      let response;
      try {
        response = await request(candidate.toString(), {
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "User-Agent": "EditalRadar-AutoReview/1.0 (+https://github.com/dagamavasco170-lang/editalradar)", Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.8,*/*;q=0.5" }
        });
      } catch {
        result.pending += 1;
        continue;
      }
      const finalUrl = response.url || candidate.toString();
      let finalHost;
      try { finalHost = new URL(finalUrl).hostname; } catch { result.pending += 1; continue; }
      const contentType = response.headers?.get?.("content-type") || "";
      if (!response.ok || !isTrustedOfficialHost(finalHost) || !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        result.pending += 1;
        continue;
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BYTES) {
        result.pending += 1;
        continue;
      }

      const decision = classifyDiscovery(item, extractDocumentText(body), finalUrl);
      if (decision.decision === "dismiss") {
        await updateDiscovery(request, baseUrl, key, item, {
          status: "dismissed",
          context: appendContext(item.context, decision.reason)
        });
        result.dismissed += 1;
        continue;
      }
      if (decision.decision !== "publish") {
        result.pending += 1;
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
    }
  }
  result.pending += result.errors;
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
