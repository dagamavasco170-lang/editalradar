import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { concursos } from "../src/data/concursos.js";

const STATE_PATH = process.env.SOURCE_MONITOR_STATE || ".cache/source-monitor-state.json";
const REPORT_PATH = process.env.SOURCE_MONITOR_REPORT || ".cache/source-monitor-report.json";
const MARKDOWN_PATH = process.env.SOURCE_MONITOR_MARKDOWN || ".cache/source-monitor-report.md";
const MAX_BYTES = 12 * 1024 * 1024;

export function collectSourceUrls(items = concursos) {
  return [...new Set(items.map((item) => item?.sourceUrl).filter((value) => {
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }))].sort();
}

export function normalizeHtml(html) {
  return String(html)
    .replace(/<!--[\\s\\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)[^>]*>[\\s\\S]*?<\\/\\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function fingerprintContent(content, contentType = "text/html") {
  const stableContent = /html|text\\//i.test(contentType) ? normalizeHtml(content) : content;
  return createHash("sha256").update(stableContent).digest("hex");
}

export function compareSource(url, previous, current) {
  if (!current.ok) return { type: "unavailable", url, message: current.error || "Falha ao consultar a fonte." };
  if (!previous?.sha256) return { type: "new_baseline", url, message: "Primeira leitura desta fonte." };
  if (previous.sha256 !== current.sha256) return { type: "changed", url, message: "O conteúdo textual da página mudou desde a última verificação." };
  return null;
}

async function fetchSource(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": "EditalRadar-SourceMonitor/1.0 (+https://github.com/dagamavasco170-lang/editalradar)",
      Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.7"
    }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) throw new Error("Resposta excede o limite de 12 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("Resposta excede o limite de 12 MB.");
  const content = /html|text\\//i.test(contentType) ? new TextDecoder("utf-8").decode(bytes) : bytes;

  return {
    ok: true,
    sha256: fingerprintContent(content, contentType),
    status: response.status,
    finalUrl: response.url,
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
  for (const entry of checked) {
    const previous = oldState.sources[entry.url];
    const result = compareSource(entry.url, previous, entry.current);
    if (result?.type === "changed") changed.push(result);
    if (result?.type === "unavailable") unavailable.push(result);
    if (!previous?.sha256 && entry.current.ok && !firstRun) added.push({ ...result, type: "added" });
    if (entry.current.ok) nextSources[entry.url] = entry.current;
    else nextSources[entry.url] = { ...(previous || {}), lastError: entry.current.error, lastCheckedAt: entry.current.checkedAt };
  }

  const removed = Object.keys(oldState.sources)
    .filter((url) => !urls.includes(url))
    .map((url) => ({ type: "removed", url, message: "A fonte deixou de estar vinculada ao catálogo." }));

  const report = { generatedAt: new Date().toISOString(), monitoredCount: urls.length, firstRun, changed, unavailable, added, removed };
  await writeFile(STATE_PATH, JSON.stringify({ version: 1, sources: nextSources }, null, 2) + "\n");
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  const groups = [
    ["Páginas alteradas", changed],
    ["Fontes indisponíveis", unavailable],
    ["Novas fontes no catálogo", added],
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
      for (const entry of entries) lines.push("- [" + entry.url + "](" + entry.url + ") — " + entry.message);
    } else lines.push("- Nenhuma.");
    lines.push("");
  }
  lines.push("Atenção: mudanças são apenas sinais para revisão. O catálogo não é atualizado automaticamente; confirme o conteúdo na publicação oficial antes de alterar vagas, inscrições, datas ou requisitos.");
  await writeFile(MARKDOWN_PATH, lines.join("\n") + "\n");

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      "changed_count=" + (changed.length + added.length + removed.length),
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
