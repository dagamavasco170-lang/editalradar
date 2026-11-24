import { describe, expect, it } from "vitest";
import { MAX_PUSH_REQUEST_BYTES, PayloadTooLargeError, readBoundedJsonBody } from "./request-limit.js";

describe("push notification request body limit", () => {
  it("rejects declared oversized payloads before reading", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": String(MAX_PUSH_REQUEST_BYTES + 1) },
      body: "{}"
    });
    await expect(readBoundedJsonBody(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("enforces the byte limit when content-length is absent", async () => {
    const bytes = new TextEncoder().encode("x".repeat(MAX_PUSH_REQUEST_BYTES + 1));
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

  it("accepts bounded JSON and rejects malformed JSON", async () => {
    const valid = new Request("https://example.test", { method: "POST", body: JSON.stringify({ action: "test_self" }) });
    await expect(readBoundedJsonBody(valid)).resolves.toEqual({ action: "test_self" });
    const invalid = new Request("https://example.test", { method: "POST", body: "{" });
    await expect(readBoundedJsonBody(invalid)).rejects.toThrow(SyntaxError);
  });
});
