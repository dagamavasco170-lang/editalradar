import { describe, expect, it } from "vitest";
import { createDiagnosticEntry, sanitizeResourceTarget } from "./telemetry.js";

describe("client diagnostics payload", () => {
  it("bounds and normalizes fields and includes runtime platform", () => {
    const entry = createDiagnosticEntry({
      level: "fatal",
      event: "E".repeat(100),
      message: "M".repeat(1200),
      stack: "S".repeat(2000),
    });
    expect(entry.level).toBe("error");
    expect(entry.event).toHaveLength(80);
    expect(entry.message).toHaveLength(1000);
    expect(entry.stack).toHaveLength(1600);
    expect(["web", "android"]).toContain(entry.platform);
    expect(entry.page.length).toBeLessThanOrEqual(180);
  });
});

describe("sanitizeResourceTarget", () => {
  it("keeps only the origin and discards path, query and fragment", () => {
    expect(sanitizeResourceTarget("https://cdn.example.com/assets/app.js?token=secret#frag"))
      .toBe("https://cdn.example.com");
  });

  it("resolves relative resources but does not expose their path", () => {
    expect(sanitizeResourceTarget("/editalradar/assets/image.png?user=private", "https://app.example.org/editalradar/"))
      .toBe("https://app.example.org");
  });

  it("uses a generic value for missing or invalid URLs", () => {
    expect(sanitizeResourceTarget("")).toBe("resource");
    expect(sanitizeResourceTarget("not a valid url", null)).toBe("resource");
  });
});
