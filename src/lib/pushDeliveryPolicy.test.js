import { describe, expect, it } from "vitest";
import {
  canRetryFcmFailure,
  classifyFcmFailure,
  getFcmRetryDelayMs,
} from "../../supabase/functions/push-notifications/policy.js";

const fcmDetails = (errorCode) => [{
  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
  errorCode
}];

describe("política de saúde e retentativa FCM", () => {
  it("reconhece token não registrado como inválido permanentemente", () => {
    const failure = classifyFcmFailure(404, {
      error: { status: "NOT_FOUND", details: fcmDetails("UNREGISTERED") }
    });
    expect(failure).toMatchObject({
      code: "UNREGISTERED",
      permanentTokenError: true,
      retryable: false
    });
  });

  it("desativa INVALID_ARGUMENT somente quando o erro é específico de token FCM", () => {
    const invalidToken = classifyFcmFailure(400, {
      error: { status: "INVALID_ARGUMENT", details: fcmDetails("INVALID_ARGUMENT") }
    });
    const badPayload = classifyFcmFailure(400, {
      error: {
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [] }]
      }
    });
    expect(invalidToken.permanentTokenError).toBe(true);
    expect(badPayload.permanentTokenError).toBe(false);
    expect(badPayload.retryable).toBe(false);
  });

  it("trata quota excedida como temporária e respeita o mínimo de 60 segundos", () => {
    const failure = classifyFcmFailure(429, { error: { status: "QUOTA_EXCEEDED" } });
    expect(failure.retryable).toBe(true);
    expect(failure.quotaLimited).toBe(true);
    expect(getFcmRetryDelayMs(failure, 1, Date.now(), () => 0)).toBe(60_000);
    expect(canRetryFcmFailure(failure, 0)).toBe(true);
    expect(canRetryFcmFailure(failure, 1)).toBe(false);
  });

  it("aplica espera exponencial e honra Retry-After", () => {
    const failure = {
      ...classifyFcmFailure(503, { error: { status: "UNAVAILABLE" } }),
      retryAfter: "5"
    };
    expect(getFcmRetryDelayMs(failure, 1, Date.now(), () => 0)).toBe(5_000);
    expect(getFcmRetryDelayMs({ ...failure, retryAfter: null }, 2, Date.now(), () => 0)).toBe(2_000);
    expect(canRetryFcmFailure(failure, 0)).toBe(true);
    expect(canRetryFcmFailure(failure, 2)).toBe(false);
  });

  it("não tenta novamente erros permanentes ou falhas de credencial", () => {
    const mismatch = classifyFcmFailure(403, { error: { status: "SENDER_ID_MISMATCH" } });
    const unregistered = classifyFcmFailure(404, { error: { status: "UNREGISTERED" } });
    expect(canRetryFcmFailure(mismatch, 0)).toBe(false);
    expect(canRetryFcmFailure(unregistered, 0)).toBe(false);
  });
});
