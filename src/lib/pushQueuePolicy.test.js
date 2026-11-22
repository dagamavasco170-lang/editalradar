import { describe, expect, it } from "vitest";
import {
  classifyWorkerFcmFailure,
  getWorkerRetryDelaySeconds,
  nextPushRetryAttempt,
} from "../../supabase/functions/push-queue-worker/policy.js";

const fcmDetails = (errorCode) => [{
  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
  errorCode
}];

describe("fila durável de notificações push", () => {
  it("reconhece tokens não registrados e não os recoloca na fila", () => {
    const error = classifyWorkerFcmFailure(404, {
      error: { status: "NOT_FOUND", details: fcmDetails("UNREGISTERED") }
    });
    expect(error.permanentTokenError).toBe(true);
    expect(error.retryable).toBe(false);
    expect(nextPushRetryAttempt(1, 1)).toBe(2);
  });

  it("respeita limite de tentativas mesmo quando uma execução é recuperada após timeout", () => {
    expect(nextPushRetryAttempt(1, 1, 7)).toBe(2);
    expect(nextPushRetryAttempt(4, 2, 7)).toBe(6);
    expect(nextPushRetryAttempt(6, 1, 7)).toBeNull();
    expect(nextPushRetryAttempt(5, 3, 7)).toBeNull();
  });

  it("aplica atraso exponencial e o intervalo mínimo para quota", () => {
    const temporary = classifyWorkerFcmFailure(503, { error: { status: "UNAVAILABLE" } });
    const quota = classifyWorkerFcmFailure(429, { error: { status: "QUOTA_EXCEEDED" } });
    expect(getWorkerRetryDelaySeconds(temporary, 1, Date.now(), () => 0)).toBe(1);
    expect(getWorkerRetryDelaySeconds(temporary, 3, Date.now(), () => 0)).toBe(4);
    expect(getWorkerRetryDelaySeconds(quota, 1, Date.now(), () => 0)).toBe(60);
  });

  it("distingue erro de payload de token FCM inválido", () => {
    const payloadError = classifyWorkerFcmFailure(400, {
      error: {
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [] }]
      }
    });
    expect(payloadError.permanentTokenError).toBe(false);
    expect(payloadError.retryable).toBe(false);
  });

  it("respeita o cabeçalho Retry-After", () => {
    const quota = classifyWorkerFcmFailure(429, { error: { status: "QUOTA_EXCEEDED" } }, "120");
    expect(getWorkerRetryDelaySeconds(quota, 1, Date.now(), () => 0)).toBe(120);
  });
});
