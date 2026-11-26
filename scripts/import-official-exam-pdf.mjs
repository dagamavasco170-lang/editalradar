#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedOfficialUrl } from "../src/lib/official-sources.js";

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const MAX_OCR_PAGES = 12;
const RIGHTS_BASES = new Set([
  "official_publication", "public_domain", "permission_granted", "cc_by", "cc_by_sa", "other_reviewed"
]);

export function normalizeQuestionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseQuestionStart(line) {
  const labelled = String(line).match(/^\s*QUEST(?:Ã|A)O(?:\s+N[º°.]?)?\s*0*(\d{1,3})\s*[:.)-]?\s*(.*)$/iu);
  if (labelled) return { number: Number(labelled[1]), rest: labelled[2] || "" };
  const numbered = String(line).match(/^\s*0*(\d{1,3})\s*[.)-]\s*(.*)$/u);
  if (numbered) return { number: Number(numbered[1]), rest: numbered[2] || "" };
  return null;
}

function parseOption(line) {
  const match = String(line).match(/^\s*(?:\(([A-F])\)|([A-F])[\).:-])\s*(.*?)\s*$/iu);
  if (!match) return null;
  return { id: String(match[1] || match[2]).toLowerCase(), text: String(match[3] || "").trim() };
}

export function parseExamPages(pages, documentSha256) {
  const parsed = [];
  const seenFingerprints = new Set();
  const seenQuestionNumbers = new Set();
  let current = null;

  const flush = () => {
    if (!current) return;
    const prompt = current.promptLines.join(" ").replace(/\s+/g, " ").trim();
    const options = current.options
      .map((item) => ({ id: item.id, text: item.text.replace(/\s+/g, " ").trim() }))
      .filter((item) => item.text.length >= 2);
    const issues = [];
    if (prompt.length < 20) issues.push("Enunciado curto ou não identificado com segurança.");
    if (prompt.length > 5000) issues.push("Enunciado excede 5.000 caracteres.");
    if (options.length < 2 || options.length > 6) issues.push("Quantidade de alternativas fora do intervalo de 2 a 6.");
    if (new Set(options.map((item) => item.id)).size !== options.length) issues.push("Identificadores de alternativas repetidos.");
    if (options.some((item, index) => item.id !== String.fromCharCode(97 + index))) {
      issues.push("Alternativas não seguem sequência contínua A-F.");
    }
    if (/(figura|imagem|gráfico|grafico|tabela|mapa|charge|tirinha|texto a seguir)/i.test(prompt)) {
      issues.push("Possível dependência de imagem, tabela, mapa ou texto externo; conferir o PDF visualmente.");
    }

    if (prompt.length >= 20 && prompt.length <= 5000 && options.length >= 2 && options.length <= 6
      && !issues.some((item) => item.includes("Identificadores") || item.includes("sequência contínua"))) {
      const canonical = normalizeQuestionText(prompt + " " + options.map((item) => item.id + " " + item.text).join(" "));
      const fingerprint = sha256(canonical);
      if (!seenFingerprints.has(fingerprint) && !seenQuestionNumbers.has(current.number)) {
        parsed.push({
          source_page: current.page,
          source_question_number: current.number,
          prompt,
          options,
          suggested_answer: null,
          fingerprint,
          review_notes: issues.join(" ") || "Extração automática; conferir enunciado, alternativas, imagens e gabarito oficial."
        });
        seenFingerprints.add(fingerprint);
        seenQuestionNumbers.add(current.number);
      }
    }
    current = null;
  };

  for (const page of pages) {
    const pageNumber = Number(page.page);
    const lines = String(page.text || "").replace(/\r/g, "").split("\n");
    for (const line of lines) {
      const start = parseQuestionStart(line);
      if (start && start.number > 0) {
        flush();
        current = { number: start.number, page: pageNumber, promptLines: [], options: [] };
        if (start.rest.trim()) current.promptLines.push(start.rest.trim());
        continue;
      }
      if (!current) continue;
      const option = parseOption(line);
      if (option) {
        current.options.push(option);
      } else if (current.options.length) {
        if (line.trim()) current.options[current.options.length - 1].text += " " + line.trim();
      } else if (line.trim()) {
        current.promptLines.push(line.trim());
      }
    }
  }
  flush();
  return parsed;
}

function validateMetadata(metadata) {
  const required = ["board", "exam_name", "exam_year", "discipline", "source_url", "exam_pdf_url"];
  for (const field of required) {
    if (metadata?.[field] === undefined || String(metadata[field]).trim() === "") {
      throw new Error("Metadado obrigatório ausente: " + field);
    }
  }
  const year = Number(metadata.exam_year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("Ano da prova inválido.");
  }
  for (const field of ["source_url", "exam_pdf_url", "source_terms_url"]) {
    if (!metadata[field]) continue;
    let url;
    try { url = new URL(metadata[field]); } catch { throw new Error("URL inválida em " + field + "."); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error(field + " deve ser uma URL HTTPS sem credenciais.");
    }
    if ((field === "source_url" || field === "exam_pdf_url") && !isTrustedOfficialUrl(url.href)) {
      throw new Error(field + " precisa pertencer ao domínio oficial da banca/órgão ou a um provedor oficial autorizado.");
    }
  }
  const rightsBasis = String(metadata.rights_basis || "official_publication");
  if (!RIGHTS_BASES.has(rightsBasis)) throw new Error("Fundamento de reutilização não reconhecido.");
  if (rightsBasis === "official_publication" && metadata.official_release_verified !== true) {
    throw new Error("Confirme official_release_verified=true somente após verificar a publicação no domínio oficial da banca/órgão.");
  }
  return { ...metadata, exam_year: year, rights_basis: rightsBasis };
}

export function buildImportManifest(metadata, documentSha256, questions, warnings = []) {
  if (!/^[0-9a-f]{64}$/.test(String(documentSha256 || ""))) {
    throw new Error("Hash SHA-256 do documento inválido.");
  }
  const verifiedMetadata = validateMetadata(metadata);
  return {
    format: "editalradar-exam-import-v1",
    generated_at: new Date().toISOString(),
    metadata: {
      board: String(verifiedMetadata.board).trim(),
      exam_name: String(verifiedMetadata.exam_name).trim(),
      exam_year: verifiedMetadata.exam_year,
      discipline: String(verifiedMetadata.discipline).trim(),
      topic: String(verifiedMetadata.topic || "A classificar").trim(),
      role_name: String(verifiedMetadata.role_name || "").trim(),
      source_url: verifiedMetadata.source_url,
      exam_pdf_url: verifiedMetadata.exam_pdf_url,
      rights_basis: verifiedMetadata.rights_basis,
      rights_holder: verifiedMetadata.rights_holder || null,
      license_proof_url: verifiedMetadata.license_proof_url || null,
      source_terms_url: verifiedMetadata.source_terms_url || null,
      source_restrictions: verifiedMetadata.source_restrictions || "",
      source_license: verifiedMetadata.source_license || null,
      source_attribution: verifiedMetadata.source_attribution || null,
      official_release_verified: verifiedMetadata.official_release_verified === true
    },
    source_document_sha256: documentSha256,
    rights_review_status: "not_reviewed",
    publication_status: "pending_admin_review",
    warnings,
    imports: questions.map((question) => ({
      ...question,
      source_document_sha256: documentSha256,
      board: String(verifiedMetadata.board).trim(),
      exam_name: String(verifiedMetadata.exam_name).trim(),
      exam_year: verifiedMetadata.exam_year,
      discipline: String(verifiedMetadata.discipline).trim(),
      topic: String(verifiedMetadata.topic || "A classificar").trim(),
      role_name: String(verifiedMetadata.role_name || "").trim(),
      source_url: verifiedMetadata.source_url,
      exam_pdf_url: verifiedMetadata.exam_pdf_url,
      rights_basis: verifiedMetadata.rights_basis,
      rights_review_status: "not_reviewed",
      status: "pending"
    }))
  };
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    encoding: options.encoding || "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 20000,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function extractPdfPages(pdfPath) {
  const info = command("pdfinfo", [pdfPath]);
  const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  if (!pageCount || pageCount > MAX_PDF_PAGES) {
    throw new Error("PDF sem paginação identificável ou acima do limite de " + MAX_PDF_PAGES + " páginas.");
  }
  const allText = command("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"]);
  const pageTexts = allText.split("\f");
  while (pageTexts.length < pageCount) pageTexts.push("");
  const pages = pageTexts.slice(0, pageCount).map((text, index) => ({ page: index + 1, text }));
  const sparsePages = pages.filter((page) => page.text.replace(/\s/g, "").length < 40);
  const warnings = [];

  if (sparsePages.length) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "editalradar-pdf-"));
    try {
      let ocrCount = 0;
      for (const page of sparsePages.slice(0, MAX_OCR_PAGES)) {
        const prefix = path.join(tempDir, "page-" + page.page);
        try {
          command("pdftoppm", ["-f", String(page.page), "-l", String(page.page), "-r", "120", "-singlefile", "-png", pdfPath, prefix], { timeout: 12000 });
          const imagePath = prefix + ".png";
          if (!existsSync(imagePath)) continue;
          const ocrText = command("tesseract", [imagePath, "stdout", "-l", "por+eng", "--psm", "6"], { timeout: 8000 });
          if (ocrText.trim().length > page.text.trim().length) {
            page.text = ocrText;
            ocrCount += 1;
          }
        } catch {
          warnings.push("OCR indisponível ou falhou na página " + page.page + "; revisão visual necessária.");
        }
      }
      if (sparsePages.length > MAX_OCR_PAGES) {
        warnings.push("Limite de OCR aplicado: " + MAX_OCR_PAGES + " de " + sparsePages.length + " páginas sem camada textual foram processadas. Documento não deve ser considerado integralmente extraído.");
      }
      if (ocrCount) warnings.push(String(ocrCount) + " página(s) sem camada textual receberam OCR em português/inglês a 120 DPI.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return { pages, warnings, pageCount };
}

export async function importPdfToManifest({ pdfPath, metadata }) {
  const stats = statSync(pdfPath);
  if (!stats.isFile() || stats.size < 8 || stats.size > MAX_PDF_BYTES) {
    throw new Error("PDF deve ser arquivo local entre 8 bytes e 25 MB.");
  }
  const header = await readFile(pdfPath);
  if (header.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("O arquivo informado não possui assinatura PDF válida.");
  }
  const documentSha256 = sha256(header);
  const { pages, warnings } = await extractPdfPages(pdfPath);
  const questions = parseExamPages(pages, documentSha256);
  if (!questions.length) {
    throw new Error("Nenhuma questão objetiva foi identificada. Não foi gerado manifesto; revise o PDF ou faça importação assistida.");
  }
  if (warnings.some((warning) => warning.startsWith("Limite de OCR aplicado"))) {
    warnings.push("A extração está incompleta; valide todas as páginas antes de inserir os itens no banco.");
  }
  return buildImportManifest(metadata, documentSha256, questions, warnings);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--pdf") result.pdfPath = argv[++index];
    else if (argv[index] === "--metadata") result.metadataPath = argv[++index];
    else if (argv[index] === "--out") result.outputPath = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") result.help = true;
    else throw new Error("Argumento desconhecido: " + argv[index]);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Uso: node scripts/import-official-exam-pdf.mjs --pdf prova.pdf --metadata prova.json [--out manifesto.json]");
    return;
  }
  if (!args.pdfPath || !args.metadataPath) {
    throw new Error("Informe --pdf e --metadata. Use --help para ver o formato.");
  }
  const metadata = JSON.parse(await readFile(args.metadataPath, "utf8"));
  const manifest = await importPdfToManifest({ pdfPath: args.pdfPath, metadata });
  const output = JSON.stringify(manifest, null, 2) + "\n";
  if (args.outputPath) {
    await writeFile(args.outputPath, output, { encoding: "utf8", flag: "wx" });
    console.log("Manifesto criado em " + args.outputPath + " com " + manifest.imports.length + " questão(ões) em revisão.");
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
