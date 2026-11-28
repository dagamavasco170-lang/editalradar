import { describe, expect, it } from "vitest";
import { extractKnowledgePdf } from "./pdf-extractor.js";

const validStats = { size: 2048, isFile: () => true };
function fakeExec(outputs = {}) {
  return (cmd) => outputs[cmd] ?? (cmd === "pdfinfo" ? "Pages: 2\n" : "Page one text\fPage two text\f");
}
function stubHeader() {
  return { open: () => 1, read: (_fd, buffer) => { buffer.write("%PDF-"); return 5; }, close: () => {} };
}

describe("Radar AI PDF text extractor", () => {
  it("extracts normalized text into page-indexed records", () => {
    const result = extractKnowledgePdf("sample.pdf", { stat: () => validStats, execFile: fakeExec(), ...stubHeader() });
    expect(result.extracted).toBe(true);
    expect(result.pages).toEqual([{ page: 1, text: "Page one text" }, { page: 2, text: "Page two text" }]);
    expect(result.stats.pageCount).toBe(2);
  });
  it("requires a path", () => {
    expect(extractKnowledgePdf("").extracted).toBe(false);
  });
  it("rejects files that are not PDFs", () => {
    const result = extractKnowledgePdf("sample.txt", { stat: () => validStats, ...stubHeader(), readSync: (_fd, buffer) => { buffer.write("TEXT!"); return 5; } });
    expect(result.errors).toContain("File does not have a PDF signature.");
  });
  it("enforces byte and page limits before extraction", () => {
    const large = extractKnowledgePdf("sample.pdf", { stat: () => ({ size: 40 * 1024 * 1024, isFile: () => true }) });
    expect(large.errors[0]).toMatch(/size/);
    const tooMany = extractKnowledgePdf("sample.pdf", { stat: () => validStats, execFile: () => "Pages: 301\n", ...stubHeader() });
    expect(tooMany.errors[0]).toMatch(/page count/);
  });
  it("reports PDFs without selectable text and does not claim OCR", () => {
    const result = extractKnowledgePdf("scan.pdf", { stat: () => validStats, execFile: fakeExec({ pdftotext: "\f\f" }), ...stubHeader() });
    expect(result.extracted).toBe(false);
    expect(result.errors).toContain("PDF contains no extractable text; OCR is not included in this stage.");
  });
  it("returns safe extraction errors when pdftotext fails", () => {
    const result = extractKnowledgePdf("sample.pdf", { stat: () => validStats, execFile: (cmd) => cmd === "pdfinfo" ? "Pages: 1\n" : (() => { throw new Error("tool unavailable"); })(), ...stubHeader() });
    expect(result.extracted).toBe(false);
    expect(result.errors[0]).toContain("PDF text extraction failed");
  });
});
