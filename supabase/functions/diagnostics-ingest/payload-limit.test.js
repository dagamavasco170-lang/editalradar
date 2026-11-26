import { describe, expect, it } from "vitest";
import { MAX_DIAGNOSTIC_BODY_BYTES, PayloadTooLargeError, readBoundedJsonBody } from "./payload-limit.js";

describe("diagnostics request payload limit", () => {
  it("rejects declared oversized payloads before reading", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": String(MAX_DIAGNOSTIC_BODY_BYTES + 1) },
      body: "{}"
    });
    await expect(readBoundedJsonBody(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("limits actual bytes when content-length is absent or misleading", async () => {
    const bytes = new TextEncoder().encode("x".repeat(MAX_DIAGNOSTIC_BODY_BYTES + 1));
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        }
      }),
      duplex: "half"
    });
    await expect(readBoundedJsonBody(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("accepts a valid bounded JSON body", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "client-identifier-12345", logs: [{ message: "ok" }] })
    });
    await expect(readBoundedJsonBody(request)).resolves.toEqual({
      client_id: "client-identifier-12345",
      logs: [{ message: "ok" }]
    });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://example.test", { method: "POST", body: "{" });
    await expect(readBoundedJsonBody(request)).rejects.toThrow(SyntaxError);
  });
});
