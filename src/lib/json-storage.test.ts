import { describe, expect, it } from "vitest";
import { isJsonRecord, parseStoredJson, stringifyStoredJson } from "./json-storage.js";

describe("typed JSON persistence helpers", () => {
  it("parses valid JSON", () => {
    expect(parseStoredJson('{"enabled":true}', { enabled: false })).toEqual({ enabled: true });
  });

  it("returns fallback for missing, malformed, and validator-rejected data", () => {
    expect(parseStoredJson<string[]>(null, [])).toEqual([]);
    expect(parseStoredJson<string[]>("{", [])).toEqual([]);
    expect(parseStoredJson('{"count":"invalid"}', { count: 0 }, value =>
      isJsonRecord(value) && typeof value.count === "number"
    )).toEqual({ count: 0 });
  });

  it("allows validators to narrow parsed data", () => {
    const isStringArray = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every(item => typeof item === "string");
    expect(parseStoredJson<string[]>('["a","b"]', [], isStringArray)).toEqual(["a", "b"]);
    expect(parseStoredJson<string[]>('[1,2]', [], isStringArray)).toEqual([]);
  });

  it("stringifies JSON and handles unsupported values without throwing", () => {
    expect(stringifyStoredJson({ saved: ["q1"] })).toBe('{"saved":["q1"]}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringifyStoredJson(circular)).toBeNull();
    expect(stringifyStoredJson(undefined)).toBeNull();
  });

  it("rejects arrays and null as records", () => {
    expect(isJsonRecord({ key: "value" })).toBe(true);
    expect(isJsonRecord([])).toBe(false);
    expect(isJsonRecord(null)).toBe(false);
  });
});
