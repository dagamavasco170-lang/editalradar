import { describe, expect, it } from "vitest";
import {
  canScheduleBeforePushExpiry,
  classifyWorkerFcmFailure,
  currentPushDeliveryAttempt,
  getWorkerRetryDelaySeconds,
  hasPushRetryBudget,
  remainingPushTtlSeconds,
  resolvePushExpiryMs,
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

  it("define a expiração absoluta no primeiro envio e não renova o prazo ao reagendar", () => {
    const enqueuedAt = "2026-11-22T10:00:00.000Z";
    const expiry = "2026-11-22T11:00:00.000Z";
    expect(resolvePushExpiryMs(expiry, enqueuedAt)).toBe(Date.parse(expiry));
    expect(resolvePushExpiryMs(undefined, enqueuedAt)).toBe(Date.parse(expiry));
    expect(resolvePushExpiryMs("data inválida", enqueuedAt)).toBeNull();
  });

  it("descarta mensagens vencidas e calcula o TTL restante em segundos", () => {
    const expiry = Date.parse("2026-11-22T11:00:00.000Z");
    const now = Date.parse("2026-11-22T10:59:58.500Z");
    expect(remainingPushTtlSeconds(expiry, now)).toBe(1);
    expect(remainingPushTtlSeconds(expiry, expiry - 500)).toBe(0);
    expect(remainingPushTtlSeconds(expiry, expiry)).toBe(0);
    expect(remainingPushTtlSeconds(expiry, expiry + 1)).toBe(0);
  });

  it("não agenda nova tentativa quando o Retry-After alcança ou ultrapassa a expiração", () => {
    const expiry = Date.parse("2026-11-22T11:00:00.000Z");
    const now = Date.parse("2026-11-22T10:59:00.000Z");
    expect(canScheduleBeforePushExpiry(expiry, 59, now)).toBe(true);
    expect(canScheduleBeforePushExpiry(expiry, 60, now)).toBe(false);
    expect(canScheduleBeforePushExpiry(expiry, 61, now)).toBe(false);
    expect(canScheduleBeforePushExpiry(expiry, 1, expiry)).toBe(false);
  });

  it("concede prazo legado com base na data original de entrada na fila, não no horário da retentativa", () => {
    const enqueuedAt = "2026-11-22T10:00:00.000Z";
    const now = Date.parse("2026-11-22T11:00:00.001Z");
    const expiry = resolvePushExpiryMs(undefined, enqueuedAt);
    expect(remainingPushTtlSeconds(expiry, now)).toBe(0);
  });
});
