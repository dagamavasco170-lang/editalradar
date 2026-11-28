import { createHash } from "node:crypto";

export const MAX_KNOWLEDGE_TEXT_CHARS = 1_000_000;
export const MAX_KNOWLEDGE_CHUNKS = 5_000;

const REQUIRED_SOURCE_FIELDS = ["id", "title", "url", "license", "attribution"];
const VALID_URL = /^https:\/\//i;

export function validateKnowledgeSource(source) {
  const errors = [];
  if (!source || typeof source !== "object") return { valid: false, errors: ["Source must be an object."] };
  for (const field of REQUIRED_SOURCE_FIELDS) {
    if (typeof source[field] !== "string" || !source[field].trim()) errors.push(`Source field "${field}" is required.`);
  }
  if (typeof source.url === "string") {
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) errors.push("Source URL must be a valid HTTPS URL without credentials.");
    } catch {
      errors.push("Source URL must be a valid HTTPS URL without credentials.");
    }
  }
  if (source.official !== undefined && typeof source.official !== "boolean") errors.push("official must be boolean when provided.");
  return { valid: errors.length === 0, errors };
}

export function normalizeKnowledgeText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitKnowledgeText(text, { maxChars = 1200, overlapChars = 180, maxInputChars = MAX_KNOWLEDGE_TEXT_CHARS, maxChunks = MAX_KNOWLEDGE_CHUNKS } = {}) {
  const normalized = normalizeKnowledgeText(text);
  if (!normalized) return [];
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) throw new RangeError("maxInputChars must be a positive integer");
  if (normalized.length > Math.min(maxInputChars, MAX_KNOWLEDGE_TEXT_CHARS)) throw new RangeError("Knowledge text exceeds the input limit");
  if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_KNOWLEDGE_CHUNKS) throw new RangeError(`maxChunks must be between 1 and ${MAX_KNOWLEDGE_CHUNKS}`);
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new RangeError("maxChars must be >= 100");
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) throw new RangeError("overlapChars must be >= 0 and < maxChars");

  const paragraphs = normalized.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  const pushChunk = chunk => {
    if (chunks.length >= maxChunks) throw new RangeError("Knowledge chunk count exceeds the limit");
    chunks.push(chunk.trim());
  };
  let current = "";
  const flush = () => {
    if (current) pushChunk(current);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      for (let start = 0; start < paragraph.length; start += maxChars - overlapChars) {
        pushChunk(paragraph.slice(start, start + maxChars));
        if (start + maxChars >= paragraph.length) break;
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > maxChars) flush();
    current = current ? current + "\n\n" + paragraph : paragraph;
  }
  flush();
  return chunks;
}

function lexicalTokens(text) {
  return normalizeKnowledgeText(text).toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/).filter(token => token.length > 1);
}

export function createKnowledgeChunks(source, text, metadata = {}) {
  const validation = validateKnowledgeSource(source);
  if (!validation.valid) throw new TypeError(validation.errors.join(" "));
  const parts = splitKnowledgeText(text, metadata.chunkOptions);
  return parts.map((part, index) => ({
    id: createHash("sha256").update(`${source.id}: ${index}: ${part}`).digest("hex"),
    sourceId: source.id,
    sourceTitle: source.title,
    sourceUrl: source.url,
    license: source.license,
    attribution: source.attribution,
    official: source.official ?? false,
    subject: metadata.subject ?? null,
    topic: metadata.topic ?? null,
    section: metadata.section ?? null,
    page: metadata.pages?.[index] ?? null,
    text: part,
    chunkIndex: index,
    retrievedAt: metadata.retrievedAt ?? new Date().toISOString(),
  }));
}

/** Deterministic baseline retrieval. Score is a simple token overlap, not semantic search. */
export function searchKnowledgeChunks(chunks, query, filters = {}) {
  const queryTokens = new Set(lexicalTokens(query));
  if (!queryTokens.size) return [];
  return chunks
    .filter(chunk => (!filters.subject || chunk.subject === filters.subject) && (!filters.topic || chunk.topic === filters.topic))
    .map(chunk => {
      const tokens = lexicalTokens(chunk.text);
      const tokenSet = new Set(tokens);
      let score = 0;
      for (const token of queryTokens) if (tokenSet.has(token)) score += 1 + Math.log(1 + tokens.filter(t => t === token).length);
      return { chunk, score: score / queryTokens.size };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, Math.max(1, Math.min(filters.limit ?? 5, 20)));
}
