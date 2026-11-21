import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildDiscoveryRows(discoveries = []) {
  const unique = new Map();
  for (const item of discoveries) {
    if (!item || !["new_link", "page_change", "source_baseline"].includes(item.discovery_type)) continue;
    try {
      const source = new URL(item.source_url);
      const candidate = new URL(item.candidate_url);
      if (source.protocol !== "https:" || candidate.protocol !== "https:") continue;
      if (!item.discovery_key || !String(item.title || "").trim()) continue;
      const key = [source.toString(), candidate.toString(), item.discovery_key].join("|");
      unique.set(key, {
        source_url: source.toString(),
        candidate_url: candidate.toString(),
        discovery_key: String(item.discovery_key).slice(0, 600),
        title: String(item.title).trim().slice(0, 240),
        context: String(item.context || "").trim().slice(0, 1200),
        discovery_type: item.discovery_type,
        status: "pending"
      });
    } catch {
      // Descarta URLs inválidas antes de enviar dados ao Supabase.
    }
  }
  return [...unique.values()];
}

export async function publishDiscoveries(discoveries, options = {}) {
  const rows = buildDiscoveryRows(discoveries);
  if (!rows.length) return { published: 0, skipped: 0 };
  const supabaseUrl = String(options.supabaseUrl || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Há descobertas pendentes, mas os secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não estão configurados. " +
      "A execução deve falhar para preservar a linha de base e tentar novamente depois da configuração."
    );
  }
  if (new URL(supabaseUrl).protocol !== "https:") {
    throw new Error("SUPABASE_URL precisa usar HTTPS.");
  }

  const request = options.fetchImpl || fetch;
  let published = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const response = await request(
      supabaseUrl + "/rest/v1/contest_discoveries?on_conflict=source_url,candidate_url,discovery_key",
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          ...(serviceRoleKey.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + serviceRoleKey }),
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify(batch)
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Supabase recusou o envio da fila (HTTP " + response.status + "). " + detail.slice(0, 500));
    }
    published += batch.length;
  }
  return { published, skipped: 0 };
}

async function main() {
  const reportPath = process.env.SOURCE_MONITOR_REPORT || ".cache/source-monitor-report.json";
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = await publishDiscoveries(report.discoveries || []);
  console.log("Oportunidades enviadas à fila do Supabase: " + result.published + "; ignoradas: " + result.skipped + ".");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("Falha ao sincronizar fila de oportunidades:", error);
    process.exitCode = 1;
  });
}
