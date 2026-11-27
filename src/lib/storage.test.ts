import { describe, expect, it, vi } from "vitest";
import { safeGetItem, safeSetItem, type StorageLike } from "./storage.js";

describe("armazenamento local resiliente", () => {
  it("lê e grava valores quando o armazenamento está disponível", () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: vi.fn(key => values.get(key) ?? null),
      setItem: vi.fn((key, value) => { values.set(key, value); })
    };
    expect(safeSetItem("er-preferences", '{"view":"grid"}', storage)).toBe(true);
    expect(safeGetItem("er-preferences", storage)).toBe('{"view":"grid"}');
    expect(storage.getItem).toHaveBeenCalledWith("er-preferences");
  });
  it("não derruba o aplicativo quando leitura ou gravação são bloqueadas", () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); }
    };
    expect(safeGetItem("er-alerts", blocked)).toBeNull();
    expect(safeSetItem("er-alerts", "[]", blocked)).toBe(false);
  });
  it("trata armazenamento ausente como indisponível", () => {
    expect(safeGetItem("er-alerts", null)).toBeNull();
    expect(safeSetItem("er-alerts", "[]", null)).toBe(false);
  });
});
