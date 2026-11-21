import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { concursos } from "../src/data/concursos.js";

const OUTPUT = process.env.CONTEST_DIGEST_PATH || ".cache/contest-notification-digest.json";

export function buildContestDigest(previousItems = [], currentItems = []) {
  const previous = new Map(previousItems.map((item) => [String(item.id), item]));
  const changed = currentItems.filter((item) => {
    const old = previous.get(String(item.id));
    return !old || JSON.stringify(old) !== JSON.stringify(item);
  });
  const updates = changed.map((item) => ({
    id: item.id,
    cargo: item.cargo,
    orgao: item.orgao,
    status: item.status,
    nivel: item.nivel,
    estado: item.estado,
    localidade: item.localidade,
    sourceUrl: item.sourceUrl
  }));
  const digestId = process.env.GITHUB_SHA || createHash("sha256").update(JSON.stringify(updates)).digest("hex");
  return { digest_id: digestId, updates };
}

async function main() {
  let previousItems = [];
  const before = process.env.GITHUB_EVENT_BEFORE;
  const base = before && !/^0+$/.test(before) ? before : "HEAD^";
  try {
    const previousSource = execFileSync("git", ["show", base + ":src/data/concursos.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const previousPath = resolve(tmpdir(), "editalradar-previous-" + process.pid + ".mjs");
    await writeFile(previousPath, previousSource);
    const previousModule = await import(pathToFileURL(previousPath).href + "?run=" + Date.now());
    previousItems = previousModule.concursos || [];
  } catch {
    previousItems = [];
  }

  const digest = buildContestDigest(previousItems, concursos);
  await mkdir(dirname(resolve(OUTPUT)), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(digest, null, 2) + "\n");

  if (process.env.GITHUB_OUTPUT) {
    const output = "changed_count=" + digest.updates.length + "\n";
    await writeFile(process.env.GITHUB_OUTPUT, output, { flag: "a" });
  }
  console.log(JSON.stringify({ digest_id: digest.digest_id, changed_count: digest.updates.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("Não foi possível gerar digest de alterações:", error);
    process.exitCode = 1;
  });
}
