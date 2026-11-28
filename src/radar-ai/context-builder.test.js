import { describe, expect, it } from "vitest";
import { createKnowledgeChunks } from "./knowledge-engine.js";
import { buildTutorContext } from "./context-builder.js";

const source = { id: "lei", title: "Fonte oficial", url: "https://www.planalto.gov.br/", license: "public domain", attribution: "Planalto", official: true };

describe("Radar AI context builder", () => {
  it("returns attributed source snippets and grounding flag", () => {
    const chunks = createKnowledgeChunks(source, "A legalidade é princípio expresso da administração pública.", { subject: "Direito Administrativo", topic: "Princípios" });
    const context = buildTutorContext(chunks, "legalidade");
    expect(context.grounded).toBe(true);
    expect(context.sources[0].url).toBe(source.url);
    expect(context.contextText).toContain("[Fonte 1]");
  });
  it("signals when retrieval finds no evidence", () => {
    const context = buildTutorContext([], "assunto sem documentos");
    expect(context.grounded).toBe(false);
    expect(context.limitations).toHaveLength(1);
  });
  it("bounds the context length", () => {
    const longText = "legalidade ".repeat(2000);
    const chunks = createKnowledgeChunks(source, longText, { subject: "Direito", topic: "Princípios", chunkOptions: { maxChars: 800, overlapChars: 80 } });
    const context = buildTutorContext(chunks, "legalidade", { maxContextChars: 1000 });
    expect(context.contextText.length).toBeLessThanOrEqual(1000);
  });
});
