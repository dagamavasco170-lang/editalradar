import { execFileSync } from "node:child_process";
import { statSync, openSync, readSync, closeSync } from "node:fs";

export const MAX_KNOWLEDGE_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_KNOWLEDGE_PDF_PAGES = 300;
const MAX_TEXT_BYTES = 15 * 1024 * 1024;

/** Extract text from a locally supplied PDF only. No URL fetching is performed. */
export function extractKnowledgePdf(pdfPath, {
  execFile = execFileSync,
  stat = statSync,
  maxBytes = MAX_KNOWLEDGE_PDF_BYTES,
  maxPages = MAX_KNOWLEDGE_PDF_PAGES
} = {}) {
  const errors = [];
  if (typeof pdfPath !== "string" || !pdfPath.trim()) {
    return { extracted: false, errors: ["PDF path is required."], pages: [], stats: { pageCount: 0, byteSize: 0 } };
  let fileStats;
  try {
    fileStats = stat(pdfPath);
  } catch (error) {
    return { extracted: false, errors: ["PDF file could not be accessed: " + String(error?.message || error).slice(0, 200)], pages: [], stats: { pageCount: 0, byteSize: 0 } };
  }
  if (!fileStats.isFile?.()) return { extracted: false, errors: ["Input must be a regular PDF file."], pages: [], stats: { pageCount: 0, byteSize: fileStats.size || 0 } };
  if (!Number.isFinite(fileStats.size) || fileStats.size <= 0 || fileStats.size > Math.min(MAX_KNOWLEDGE_PDF_BYTES, maxBytes)) {
    return { extracted: false, errors: ["PDF size must be between 1 byte and the configured limit."], pages: [], stats: { pageCount: 0, byteSize: fileStats.size || 0 } };
  }
  let header;
  const fd = openSync(pdfPath, "r");
  try {
    const buffer = Buffer.alloc(5);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    header = buffer.subarray(0, read).toString("ascii");
  } finally {
    closeSync(fd);
  }
  if (header !== "%PDF-") return { extracted: false, errors: ["File does not have a PDF signature."], pages: [], stats: { pageCount: 0, byteSize: fileStats.size } };

  let pageCount;
  try {
    const info = execFile("pdfinfo", [pdfPath], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    const match = String(info).match(/^Pages:\s*(\d+)\s*$/m);
    if (!match) throw new Error("Page count was not found.");
    pageCount = Number(match[1]);
  } catch (error) {
    return { extracted: false, errors: ["PDF metadata extraction failed: " + String(error?.message || error).slice(0, 250)], pages: [], stats: { pageCount: 0, byteSize: fileStats.size } };
  }
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > Math.min(MAX_KNOWLEDGE_PDF_PAGES, maxPages)) {
    return { extracted: false, errors: ["PDF page count is outside the supported limit."], pages: [], stats: { pageCount, byteSize: fileStats.size } };
  }
  try {
    const text = execFile("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8", timeout: 30000, maxBuffer: MAX_TEXT_BYTES });
    const rawPages = String(text).split("\f").slice(0, pageCount);
    const pages = rawPages.map((pageText, index) => ({ page: index + 1, text: String(pageText).normalize("NFC").replace(/[\t\u00a0]+/g, " ").replace(/ *\n */g, "\n").trim() }));
    const extractedChars = pages.reduce((sum, page) => sum + page.text.length, 0);
    if (!extractedChars) errors.push("PDF contains no extractable text; OCR is not included in this stage.");
    return { extracted: extractedChars > 0, errors, pages, stats: { pageCount, byteSize: fileStats.size, extractedChars } };
  } catch (error) {
    return { extracted: false, errors: ["PDF text extraction failed: " + String(error?.message || error).slice(0, 250)], pages: [], stats: { pageCount, byteSize: fileStats.size } };
  }
}
