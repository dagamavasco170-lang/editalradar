import { afterEach, describe, expect, it } from "vitest";
import { clearKnowledgeSources, getKnowledgeSource, listKnowledgeSources, registerKnowledgeSource } from "./source-registry.js";

const source = { id: "law-1", title: "Lei oficial", url: "https://example.gov.br/lei", license: "public domain", attribution: "Fonte oficial", official: true, sourceType: "official-law", licenseVerified: true };

afterEach(() => clearKnowledgeSources());

describe("Radar AI source registry", () => {
  it("registers only sources with explicit verified provenance", () => {
    expect(registerKnowledgeSource(source).registered).toBe(true);
    expect(getKnowledgeSource(source.id)?.url).toBe(source.url);
    expect(listKnowledgeSources()).toHaveLength(1);
  });
  it("rejects unverified licensing and missing source category", () => {
    const result = registerKnowledgeSource({ ...source, licenseVerified: false });
    expect(result.registered).toBe(false);
    expect(result.errors).toContain("Source license/permission must be verified before ingestion.");
  });
  it("rejects malformed HTTPS URLs instead of throwing", () => {\n    const result = registerKnowledgeSource({ ...source, url: "https://" });\n    expect(result.registered).toBe(false);\n    expect(result.errors).toContain("Source URL must be a valid HTTPS URL without credentials.");\n  });\n  it("rejects credential-bearing source URLs", () => {\n    const result = registerKnowledgeSource({ ...source, url: "https://user:pass@example.gov.br/" });\n    expect(result.registered).toBe(false);\n  });\n  it("prevents id collisions with different source URLs", () => {
    registerKnowledgeSource(source);
    const result = registerKnowledgeSource({ ...source, url: "https://another.gov.br/", title: "Different source" });
    expect(result.registered).toBe(false);
    expect(result.errors).toContain("Source id already exists with a different URL.");
  });
});
