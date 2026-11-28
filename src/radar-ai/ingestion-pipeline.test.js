import { afterEach, describe, expect, it } from "vitest";
import { clearKnowledgeSources, registerKnowledgeSource } from "./source-registry.js";
import { MAX_KNOWLEDGE_TEXT_CHARS } from "./knowledge-engine.js";
import { ingestKnowledgeText, mergeKnowledgeChunks } from "./ingestion-pipeline.js";

const source = { id: "ingest-1", title: "Fonte teste", url: "https://example.gov.br/doc", license: "public domain", attribution: "Fonte", official: true, sourceType: "official-law", licenseVerified: true };

afterEach(() => clearKnowledgeSources());

describe("Radar AI ingestion pipeline", () => {
  it("requires registered and permission-verified sources", () => {
    expect(ingestKnowledgeText(source.id, "Conteúdo relevante para estudo.").ingested).toBe(false);
  });
  it("normalizes and chunks provided source text with metadata", () => {
    registerKnowledgeSource(source);
    const result = ingestKnowledgeText(source.id, "  Conteúdo de teste.\n\nSegundo parágrafo.  ", { subject: "Direito", topic: "Teste" });
    expect(result.ingested).toBe(true);
    expect(result.stats.chunkCount).toBeGreaterThan(0);
    expect(result.chunks[0].sourceUrl).toBe(source.url);
    expect(result.chunks[0].subject).toBe("Direito");
  });
  it("rejects empty normalized content", () => {
    registerKnowledgeSource(source);
    expect(ingestKnowledgeText(source.id, " \n ").errors).toContain("Source content is empty after normalization.");
  });
  it("rejects oversized text before normalization", () => {
    registerKnowledgeSource(source);
    const result = ingestKnowledgeText(source.id, "x".repeat(MAX_KNOWLEDGE_TEXT_CHARS + 1));
    expect(result.ingested).toBe(false);
    expect(result.errors[0]).toContain("Source text exceeds the 1,000,000-character limit.");
    expect(result.stats.chunkCount).toBe(0);
  });
  it("deduplicates chunks deterministically", () => {
    const sample = [{ id: "a", text: "one" }, { id: "b", text: "two" }];
    expect(mergeKnowledgeChunks(sample, [{ id: "a", text: "updated" }, { id: "c", text: "three" }])).toEqual([{ id: "a", text: "updated" }, { id: "b", text: "two" }, { id: "c", text: "three" }]);
  });
});
