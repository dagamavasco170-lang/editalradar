import { describe, expect, it, vi } from "vitest";
import { safeGetItem, safeSetItem } from "./storage.js";

describe("armazenamento local resiliente", () => {
  it("lê e grava valores quando o armazenamento está disponível", () => {
    const values = new Map();
    const storage = {
      getItem: vi.fn(key => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value))
    };

    expect(safeSetItem("er-preferences", "{\"view\":\"grid\"}", storage)).toBe(true);
    expect(safeGetItem("er-preferences", storage)).toBe("{\"view\":\"grid\"}");
    expect(storage.getItem).toHaveBeenCalledWith("er-preferences");
  });

  it("não derruba o aplicativo quando o navegador bloqueia a leitura ou gravação", () => {
    const blocked = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); }
    };

    expect(safeGetItem("er-alerts", blocked)).toBeNull();
    expect(safeSetItem("er-alerts", "[]", blocked)).toBe(false);
  });

  it("trata uma API de armazenamento ausente como indisponível", () => {
    expect(safeGetItem("er-alerts", null)).toBeNull();
    expect(safeSetItem("er-alerts", "[]", null)).toBe(false);
  });
});
