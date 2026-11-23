import { describe, expect, it } from "vitest";
import { createDiagnosticEntry } from "./telemetry.js";

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
