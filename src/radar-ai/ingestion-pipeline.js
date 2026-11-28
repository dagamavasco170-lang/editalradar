import { createKnowledgeChunks, normalizeKnowledgeText } from "./knowledge-engine.js";
import { getKnowledgeSource } from "./source-registry.js";

/** Processes supplied text only; it deliberately performs no network fetching. */
export function ingestKnowledgeText(sourceId, text, metadata = {}) {
  const source = getKnowledgeSource(sourceId);
  if (!source) return { ingested: false, errors: ["Source is not registered or its permission was not verified."], chunks: [], stats: { inputChars: 0, normalizedChars: 0, chunkCount: 0 } };
  const normalizedText = normalizeKnowledgeText(text);
  if (!normalizedText) return { ingested: false, errors: ["Source content is empty after normalization."], chunks: [], stats: { inputChars: String(text ?? "").length, normalizedChars: 0, chunkCount: 0 } };
  try {
    const chunks = createKnowledgeChunks(source, normalizedText, { ...metadata, retrievedAt: metadata.retrievedAt ?? new Date().toISOString() });
    return { ingested: chunks.length > 0, errors: [], chunks, stats: { inputChars: String(text ?? "").length, normalizedChars: normalizedText.length, chunkCount: chunks.length } };
  } catch (error) {
    return { ingested: false, errors: [error instanceof Error ? error.message : String(error)], chunks: [], stats: { inputChars: String(text ?? "").length, normalizedChars: normalizedText.length, chunkCount: 0 } };
  }
}

/** Deduplicates chunk ids across ingestion batches without changing source provenance. */
export function mergeKnowledgeChunks(existing = [], incoming = []) {
  const chunksById = new Map();
  for (const chunk of [...existing, ...incoming]) {
    if (chunk?.id) chunksById.set(chunk.id, chunk);
  }
  return [...chunksById.values()];
}
