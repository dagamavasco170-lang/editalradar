import type { JsonValue } from "../types/domain.js";

/** Parses persisted JSON without throwing and optionally validates its shape. */
export function parseStoredJson<T extends JsonValue>(
  raw: string | null,
  fallback: T,
  validate?: (value: unknown) => value is T,
): T {
  if (raw == null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (validate && !validate(value)) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

/** Stringifies JSON values safely; returns null for unsupported/circular data. */
export function stringifyStoredJson(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
