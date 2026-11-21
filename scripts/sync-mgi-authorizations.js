import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const SOURCE_PAGE = "https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/autorizacoes-e-provimentos";
const FALLBACK_XLSX = "https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/arquivos-autorizacoes/autorizacoes02julho2026.xlsx";
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/\\s+/g, " ").trim();
const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();

function findSpreadsheet(html) {
  const anchors = [...html.matchAll(/<a\\b[^>]*href=["']([^"']+\\.xlsx(?:\\?[^"']*)?)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)];
  const candidate = anchors.find((match) => /2026/.test(clean(match[2]).replace(/<[^>]*>/g, "")) || /2026/.test(match[1]));
  if (!candidate) return { url: FALLBACK_XLSX, label: "Tabela de Autorizações e Provimentos - 2026" };
  return { url: new URL(candidate[1].replace(/&amp;/g, "&"), SOURCE_PAGE).href, label: clean(candidate[2].replace(/<[^>]*>/g, "")) };
}

function parseWorkbook(buffer, sourceUrl) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const records = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
    let headerIndex = -1;
    let columns = null;
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 40); rowIndex++) {
      const headers = rows[rowIndex].map(normalize);
      const orgIndex = headers.findIndex((v) => v.includes("orgao") && v.includes("entidade"));
      const cargoIndex = headers.findIndex((v) => v.includes("cargo"));
      const educationIndex = headers.findIndex((v) => v.includes("escolaridade") || v === "esc.");
      const vacanciesIndex = headers.findIndex((v) => v.includes("vaga"));
      if (orgIndex >= 0 && cargoIndex >= 0 && educationIndex >= 0 && vacanciesIndex >= 0) {
        headerIndex = rowIndex;
        columns = {
          orgao: orgIndex,
          vinculo: headers.findIndex((v) => v.includes("vinculo")),
          cargo: cargoIndex,
          escolaridade: educationIndex,
          vagas: vacanciesIndex,
          ato: headers.findIndex((v) => v.includes("ato oficial") || v.includes("norma juridica")),
          tipo: headers.findIndex((v) => v.includes("tipo de autorizacao"))
        };
        break;
      }
    }
    if (headerIndex < 0 || !columns) continue;
    if (columns.tipo < 0) columns.tipo = 7;
    for (const row of rows.slice(headerIndex + 1)) {
      const orgao = clean(row[columns.orgao]);
      const cargo = clean(row[columns.cargo]);
      if (!orgao || !cargo) continue;
      const tipoAutorizacao = clean(row[columns.tipo]);
      if (!normalize(tipoAutorizacao).includes("concurso publico")) continue;
      const rawVagas = row[columns.vagas];
      const vagas = typeof rawVagas === "number" ? Math.round(rawVagas) : Number(clean(rawVagas).replace(/[^0-9]/g, "")) || 0;
      const rawEducation = clean(row[columns.escolaridade]);
      const educationKey = normalize(rawEducation);
      const nivel = educationKey === "ni" ? "Nível intermediário" : educationKey === "ns" ? "Nível superior" : rawEducation || "Não informada";
      const vinculo = columns.vinculo >= 0 ? clean(row[columns.vinculo]) : "";
      const atoOficial = columns.ato >= 0 ? clean(row[columns.ato]) : "";
      const id = normalize([orgao, cargo, atoOficial, vinculo].join("|")).replace(/[^a-z0-9|]+/g, "-");
      records.push({
        id, sigla: (vinculo || orgao).slice(0, 4).toUpperCase(),
        cargo, orgao, vinculo, nivel, vagas, atoOficial,
        status: "Autorizado pelo MGI",
        area: "Federal", estado: "Brasil",
        tipoAutorizacao, sourceUrl
      });
    }
  }
  const unique = new Map();
  for (const record of records) unique.set(record.id, record);
  return [...unique.values()];
}

async function main() {
  const pageResponse = await fetch(SOURCE_PAGE, { headers: { "user-agent": "EditalRadar/1.0" } });
  if (!pageResponse.ok) throw new Error("Não foi possível consultar a página do MGI: HTTP " + pageResponse.status);
  const spreadsheet = findSpreadsheet(await pageResponse.text());
  console.log("Planilha oficial selecionada:", spreadsheet.url);
  const fileResponse = await fetch(spreadsheet.url, { headers: { "user-agent": "EditalRadar/1.0" } });
  if (!fileResponse.ok) throw new Error("Não foi possível baixar a planilha: HTTP " + fileResponse.status);
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.length < 1000) throw new Error("O arquivo baixado não parece ser um XLSX válido.");
  const records = parseWorkbook(buffer, spreadsheet.url);
  if (!records.length) throw new Error("Nenhuma autorização de concurso foi encontrada; o site não será publicado com dados vazios.");
  const fetchedAt = new Date().toISOString();
  const moduleContent = [
    "export const sourceUrl = " + JSON.stringify(SOURCE_PAGE) + ";",
    "export const spreadsheetUrl = " + JSON.stringify(spreadsheet.url) + ";",
    "export const sourceUpdated = " + JSON.stringify("Planilha do MGI - 2026; confirme a data na fonte") + ";",
    "export const fetchedAt = " + JSON.stringify(fetchedAt) + ";",
    "export const concursos = " + JSON.stringify(records, null, 2) + ";",
    "export const materias = " + JSON.stringify([
      { nome: "Língua Portuguesa", descricao: "Interpretação e gramática", icon: "Aa" },
      { nome: "Raciocínio lógico", descricao: "Lógica e matemática", icon: "∑" },
      { nome: "Direito constitucional", descricao: "Princípios e fundamentos", icon: "§" },
      { nome: "Informática", descricao: "Conceitos e ferramentas", icon: "⌘" }
    ], null, 2) + ";",
    ""
  ].join("\n");
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/data/concursos.js");
  await fs.writeFile(out, moduleContent);
  console.log("Registros importados:", records.length);
  console.log("Vagas autorizadas:", records.reduce((sum, item) => sum + item.vagas, 0));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
