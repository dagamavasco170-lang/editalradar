import { describe, expect, it } from "vitest";
import { createKnowledgeChunks, normalizeKnowledgeText, searchKnowledgeChunks, splitKnowledgeText, validateKnowledgeSource } from "./knowledge-engine.js";

const source = { id: "cf88", title: "Constituição", url: "https://www.planalto.gov.br/", license: "Public domain / verify terms", attribution: "Portal oficial", official: true };

describe("Radar AI knowledge engine", () => {
  it("requires source provenance metadata and HTTPS URL", () => {
    expect(validateKnowledgeSource(source).valid).toBe(true);
    expect(validateKnowledgeSource({ ...source, url: "http://example.com" }).valid).toBe(false);
  });
  it("normalizes text consistently", () => {
    expect(normalizeKnowledgeText("  texto\u00a0  \n\n\n outro ")).toBe("texto\n\noutro");
  });
  it("splits content into bounded chunks", () => {
    const chunks = splitKnowledgeText("a".repeat(250), { maxChars: 120, overlapChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 120)).toBe(true);
  });
  it("preserves source metadata and deterministic chunk ids", () => {
    const chunks = createKnowledgeChunks(source, "Princípios administrativos.\n\nLegalidade e impessoalidade.", { subject: "Direito Administrativo", topic: "Princípios" });
    expect(chunks[0].sourceUrl).toBe(source.url);
    expect(chunks[0].subject).toBe("Direito Administrativo");
    expect(chunks[0].id).toBe(createKnowledgeChunks(source, "Princípios administrativos.\n\nLegalidade e impessoalidade.", { subject: "Direito Administrativo", topic: "Princípios" })[0].id);
  });
  it("retrieves lexical matches and honors subject/topic filters", () => {
    const chunks = createKnowledgeChunks(source, "A administração pública deve observar legalidade e impessoalidade.", { subject: "Direito Administrativo", topic: "Princípios" });
    expect(searchKnowledgeChunks(chunks, "legalidade").length).toBe(1);
    expect(searchKnowledgeChunks(chunks, "legalidade", { subject: "Português" })).toHaveLength(0);
  });
});
