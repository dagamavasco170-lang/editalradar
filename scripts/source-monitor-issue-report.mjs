import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const list = value => Array.isArray(value) ? value : [];

export function buildSourceMonitorIssueReport({ report = {}, env = {}, runUrl = "" } = {}) {
  const findings = [
    ...list(report.changed).map(item => ({ ...item, category: "Conteúdo alterado" })),
    ...list(report.unavailable).map(item => ({ ...item, category: "Fonte indisponível" })),
    ...list(report.restricted).map(item => ({ ...item, category: "Acesso automatizado bloqueado/limitado — verificar no navegador" })),
    ...list(report.recovered).map(item => ({ ...item, category: "Fonte recuperada" })),
    ...list(report.added).map(item => ({ ...item, category: "Nova fonte cadastrada" })),
    ...list(report.removed).map(item => ({ ...item, category: "Fonte removida" })),
    ...list(report.discoveries).map(item => ({
      ...item,
      category: item.discovery_type === "web_search_lead"
        ? "Pista da busca automática na internet (não confirmada)"
        : item.discovery_type === "new_link" ? "Novo link de oportunidade oficial" : "Página oficial alterada para revisão"
    }))
  ];

  const details = findings.map(item => {
    const url = item.candidate_url || item.url;
    const reference = url ? "[" + url + "](" + url + ")" : "Fonte sem URL informada";
    const message = item.title
      ? item.title + (item.context ? " — " + item.context : "")
      : item.message || "Sem detalhes adicionais";
    return "- **" + item.category + ":** " + reference + " — " + message;
  }).join("\n");

  const stableBody = [
    "O monitor automático encontrou mudanças nas páginas vinculadas ao catálogo do EditalRadar.",
    "",
    details || "Nenhum detalhe individual foi fornecido nesta execução.",
    "",
    "**Resultado do monitor:** " + String(env.MONITOR_OUTCOME || "não executado") + ".",
    "**Envio da fila:** " + String(env.PUBLISH_OUTCOME || "não necessário") + ".",
    "**Busca automática na internet:** " + String(env.WEB_SEARCH_COUNT || "0") + " pista(s) nova(s); falhas em " + String(env.WEB_SEARCH_FAILED || "0") + " consulta(s).",
    "**Triagem automática:** " + String(env.TRIAGE_OUTCOME || "não executada") + ". Elegíveis: " + String(env.TRIAGE_ELIGIBLE || "0") + "; processadas nesta rodada: " + String(env.TRIAGE_INSPECTED || "0") + "; reservadas para próximas rodadas: " + String(env.TRIAGE_DEFERRED || "0") + " (limite: " + String(env.TRIAGE_MAX_ITEMS || "40") + "); publicadas: " + String(env.TRIAGE_PUBLISHED || "0") + "; atualizadas: " + String(env.TRIAGE_UPDATED || "0") + "; pendentes nesta execução: " + String(env.TRIAGE_PENDING || "0") + "; pendentes totais no banco: " + String(env.TRIAGE_PENDING_TOTAL || "não confirmado") + "; linhas de base encerradas: " + String(env.TRIAGE_BASELINES_DISMISSED || "0") + "; falhas: " + String(env.TRIAGE_ERRORS || "0") + ".",
    "**Importação automática de questões oficiais:** " + String(env.EXAM_IMPORT_OUTCOME || "não executada") + " (" + String(env.EXAM_IMPORT_STATUS || "sem status") + "). Publicadas: " + String(env.EXAM_IMPORT_PUBLISHED || "0") + "; tentativas recuperadas: " + String(env.EXAM_IMPORT_RETRIED || "0") + "; descartadas: " + String(env.EXAM_IMPORT_SKIPPED || "0") + "; falhas: " + String(env.EXAM_IMPORT_ERRORS || "0") + "; execução: " + String(env.EXAM_IMPORT_RUN_ID || "não registrada") + ".",
    "",
    "A triagem de concursos tenta novamente falhas temporárias. A importação de questões publica apenas quando prova e gabarito definitivo, integridade, estrutura, autonomia textual, deduplicação e demais critérios objetivos passam; casos ambíguos são adiados ou descartados automaticamente, sem fila humana.",
    "",
    "O sistema não inventa vagas, requisitos, datas ou situação de inscrições. Confira sempre o edital oficial antes de tomar decisões."
  ].join("\n");

  const fingerprint = createHash("sha256").update(stableBody).digest("hex");
  const body = [
    stableBody,
    "",
    runUrl ? "Relatório da execução: " + runUrl : "",
    "",
    "<!-- source-monitor-fingerprint:" + fingerprint + " -->"
  ].join("\n");

  return { body, fingerprint, stableBody };
}

export function sourceMonitorIssueNeedsUpdate(existingBody, nextFingerprint) {
  const previousFingerprint = String(existingBody || "")
    .match(/<!-- source-monitor-fingerprint:([a-f0-9]{64}) -->/)?.[1];
  return !previousFingerprint || previousFingerprint !== String(nextFingerprint || "");
}

async function main() {
  const reportPath = process.env.REPORT_PATH || ".cache/source-monitor-report.json";
  const outputPath = process.env.ISSUE_REPORT_PATH || ".cache/source-monitor-issue.json";
  let report = {};
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const { body, fingerprint } = buildSourceMonitorIssueReport({
    report,
    env: process.env,
    runUrl: process.env.RUN_URL || ""
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ body, fingerprint }, null, 2) + "\n", "utf8");
  process.stdout.write("Relatório estável preparado; fingerprint " + fingerprint + ".\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(String(error?.stack || error) + "\n");
    process.exitCode = 1;
  });
}
