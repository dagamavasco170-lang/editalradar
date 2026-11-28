import { validateKnowledgeSource } from "./knowledge-engine.js";

const sources = new Map();
const ALLOWED_SOURCE_TYPES = new Set(["official-law", "official-exam", "official-notice", "licensed", "public-domain", "authorized"]);

export function registerKnowledgeSource(source) {
  const errors = [...validateKnowledgeSource(source).errors];
  if (!ALLOWED_SOURCE_TYPES.has(source?.sourceType)) errors.push("sourceType must identify an authorized source category.");
  if (typeof source?.licenseVerified !== "boolean") errors.push("licenseVerified must be explicitly boolean.");
  if (source?.licenseVerified !== true) errors.push("Source license/permission must be verified before ingestion.");
  if (["official-law", "official-exam", "official-notice"].includes(source?.sourceType) && source.official !== true) errors.push("Official source categories must be marked official.");
  if (errors.length) return { registered: false, errors };
  const existing = sources.get(source.id);
  if (existing && existing.url !== source.url) return { registered: false, errors: ["Source id already exists with a different URL."] };
  let normalizedUrl;
  try {
    normalizedUrl = new URL(source.url).toString();
  } catch {
    return { registered: false, errors: ["Source URL must be a valid HTTPS URL without credentials."] };
  }
  const normalized = Object.freeze({ ...source, url: normalizedUrl });
  sources.set(source.id, normalized);
  return { registered: true, errors: [], source: normalized };
}

export function getKnowledgeSource(id) {
  return sources.get(id) ?? null;
}

export function listKnowledgeSources() {
  return [...sources.values()];
}

export function clearKnowledgeSources() {
  sources.clear();
}
