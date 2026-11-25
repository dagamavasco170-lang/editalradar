import { describe, expect, it } from "vitest";
import { createDiagnosticEntry, sanitizeResourceTarget, sanitizePagePath } from "./telemetry.js";

describe("client diagnostics payload", () => {
  it("bounds and normalizes fields and includes runtime platform", () => {
    const entry = createDiagnosticEntry({
      level: "fatal",
      event: "E ".repeat(50),
      message: "M ".repeat(600),
      stack: "S ".repeat(1000),
    });
    expect(entry.level).toBe("error");
    expect(entry.event).toHaveLength(80);
    expect(entry.message).toHaveLength(1000);
    expect(entry.stack).toHaveLength(1600);
    expect(["web", "android"]).toContain(entry.platform);
    expect(entry.page.length).toBeLessThanOrEqual(180);
  });
  it("redacts emails, bearer credentials, secret assignments, URL query strings and long tokens before upload", () => {
    const entry = createDiagnosticEntry({
      message: "Contact dev@example.com; Bearer eyJabc.def.ghi; api_key=abc123; https://app.example.com/path?access_token=secret#fragment; token=0123456789abcdef0123456789abcdef",
      stack: "password=hunter2 https://example.org/error?email=private@example.org"
    });
    expect(entry.message).toContain("[email]");
    expect(entry.message).toContain("Bearer [redacted]");
    expect(entry.message).toContain("api_key=[redacted]");
    expect(entry.message).toContain("https://app.example.com");
    expect(entry.message).not.toContain("/path");
    expect(entry.message).not.toContain("access_token=secret");
    expect(entry.message).not.toContain("0123456789abcdef0123456789abcdef");
    expect(entry.stack).toContain("password=[redacted]");
    expect(entry.stack).toContain("https://example.org");
    expect(entry.stack).not.toContain("/error");
    expect(entry.stack).not.toContain("private@example.org");
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

describe("sanitizePagePath", () => {
  it("replaces numeric and identifier-like route segments", () => {
    expect(sanitizePagePath("/concursos/12345/edital/abcdef0123456789abcdef012345"))
      .toBe("/concursos/:id/edital/:id");
  });

  it("rejects invalid paths and bounds static segments", () => {
    expect(sanitizePagePath("https://example.com/user/123")).toBe("");
    expect(sanitizePagePath("/" + "x".repeat(100))).toHaveLength(81);
  });
});
