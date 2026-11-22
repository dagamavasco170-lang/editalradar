import { describe, expect, it } from "vitest";
import {
  classifyWorkerFcmFailure,
  currentPushDeliveryAttempt,
  getWorkerRetryDelaySeconds,
  hasPushRetryBudget,
} from "../../supabase/functions/push-queue-worker/policy.js";

const fcmDetails = (errorCode) => [{
  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
  errorCode
}];

describe("fila durável de notificações push", () => {
  it("reconhece tokens não registrados e os classifica como falha permanente", () => {
    const error = classifyWorkerFcmFailure(404, {
      error: { status: "NOT_FOUND", details: fcmDetails("UNREGISTERED") }
    });
    expect(error.permanentTokenError).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it("conta corretamente uma entrega recuperada após timeout e limita o total a sete envios", () => {
    expect(currentPushDeliveryAttempt(1, 1)).toBe(2);
    expect(currentPushDeliveryAttempt(1, 2)).toBe(3);
    expect(currentPushDeliveryAttempt(4, 2)).toBe(6);
    expect(hasPushRetryBudget(6, 7)).toBe(true);
    expect(hasPushRetryBudget(7, 7)).toBe(false);
    expect(hasPushRetryBudget(currentPushDeliveryAttempt(5, 2), 7)).toBe(false);
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
