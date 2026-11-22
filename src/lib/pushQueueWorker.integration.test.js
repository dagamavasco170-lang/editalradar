import { describe, expect, it, vi } from "vitest";
import { processPushDeliveryJob } from "../../supabase/functions/push-queue-worker/delivery.js";

const NOW = Date.parse("2030-05-20T12:00:00.000Z");
const TOKEN = "f".repeat(64);
const EXPIRY = new Date(NOW + 120_000).toISOString();

function createAdminDb({ rpcErrors = {} } = {}) {
  const calls = [];
  const adminDb = {
    calls,
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      if (rpcErrors[name]) return { data: null, error: new Error(rpcErrors[name]) };
      if (name === "ack_push_delivery_retry") return { data: true, error: null };
      return { data: 1, error: null };
    },
    from(table) {
      return {
        update(values) {
          return {
            async eq(column, value) {
              calls.push({ kind: "update", table, values, column, value });
              return { error: null };
            }
          };
        }
      };
    }
  };
  return adminDb;
}

function job({ message = {}, readCount = 1, enqueuedAt = new Date(NOW - 1000).toISOString() } = {}) {
  return {
    msg_id: 73,
    read_ct: readCount,
    enqueued_at: enqueuedAt,
    message: {
      token: TOKEN,
      title: "Aviso de teste",
      body: "Conteúdo sintético",
      url: "/",
      attempt: 1,
      expires_at: EXPIRY,
      ...message
    }
  };
}

function options(adminDb, sendMessage, overrides = {}) {
  return {
    adminDb,
    job: job(),
    projectId: "firebase-project-test",
    accessToken: "fake-access-token",
    sendMessage,
    now: () => NOW,
    random: () => 0,
    ...overrides
  };
}

describe("integração simulada do worker de notificações", () => {
  it("confirma uma entrega bem-sucedida sem fazer uma chamada de rede real", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });

    const result = await processPushDeliveryJob(options(db, sendMessage));

    expect(result).toEqual({ outcome: "sent" });
    expect(sendMessage).toHaveBeenCalledWith(
      TOKEN,
      { title: "Aviso de teste", body: "Conteúdo sintético", url: "/" },
      "firebase-project-test",
      "fake-access-token",
      120
    );
    expect(db.calls).toContainEqual({
      kind: "rpc",
      name: "ack_push_delivery_retry",
      args: { p_msg_id: 73 }
    });
  });

  it("reagenda falha temporária e mantém a expiração original", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      retryable: true,
      permanentTokenError: false,
      quotaLimited: false,
      code: "UNAVAILABLE",
      retryAfter: null
    });

    const result = await processPushDeliveryJob(options(db, sendMessage));

    expect(result).toMatchObject({ outcome: "rescheduled", error_code: "UNAVAILABLE", attempts: 2 });
    const retry = db.calls.find(call => call.name === "reschedule_push_delivery_retry");
    expect(retry.args.p_old_msg_id).toBe(73);
    expect(retry.args.p_delay_seconds).toBe(2);
    expect(retry.args.p_message.expires_at).toBe(EXPIRY);
    expect(retry.args.p_message.attempt).toBe(2);
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(false);
    expect(db.calls.some(call => call.name === "fail_push_delivery_retry")).toBe(false);
  });

  it("não agenda Retry-After que ultrapassa a validade e arquiva a mensagem", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      retryable: true,
      permanentTokenError: false,
      quotaLimited: false,
      code: "UNAVAILABLE",
      retryAfter: "180"
    });
    const nearExpiry = new Date(NOW + 60_000).toISOString();

    const result = await processPushDeliveryJob(options(db, sendMessage, {
      job: job({ message: { expires_at: nearExpiry } })
    }));

    expect(result).toEqual({ outcome: "expired_before_retry" });
    expect(db.calls.some(call => call.name === "reschedule_push_delivery_retry")).toBe(false);
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(true);
  });

  it("descarta mensagem já vencida sem chamar o Firebase", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn();
    const expired = new Date(NOW - 1).toISOString();

    const result = await processPushDeliveryJob(options(db, sendMessage, {
      job: job({ message: { expires_at: expired } })
    }));

    expect(result).toEqual({ outcome: "expired" });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(true);
  });

  it("desativa token permanentemente inválido e confirma a fila", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      retryable: false,
      permanentTokenError: true,
      code: "UNREGISTERED"
    });

    const result = await processPushDeliveryJob(options(db, sendMessage));

    expect(result).toEqual({ outcome: "disabled_invalid" });
    expect(db.calls.some(call => call.kind === "update" && call.table === "push_devices" && call.values.enabled === false)).toBe(true);
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(true);
    expect(db.calls.some(call => call.name === "fail_push_delivery_retry")).toBe(false);
  });

  it("registra erro permanente que não é token como falha terminal", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      retryable: false,
      permanentTokenError: false,
      code: "SENDER_ID_MISMATCH"
    });

    const result = await processPushDeliveryJob(options(db, sendMessage));

    expect(result).toMatchObject({ outcome: "dead_letter", error_code: "SENDER_ID_MISMATCH" });
    expect(db.calls.some(call => call.name === "fail_push_delivery_retry")).toBe(true);
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(false);
  });

  it("usa a data original de entrada para calcular expiração de mensagens legadas", async () => {
    const db = createAdminDb();
    const sendMessage = vi.fn();
    const enqueuedAt = new Date(NOW - 3_600_001).toISOString();

    const result = await processPushDeliveryJob(options(db, sendMessage, {
      job: job({ enqueuedAt, message: { expires_at: undefined } })
    }));

    expect(result).toEqual({ outcome: "expired" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("mantém a mensagem sem ACK quando a persistência da retentativa falha", async () => {
    const db = createAdminDb({ rpcErrors: { reschedule_push_delivery_retry: "database unavailable" } });
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      retryable: true,
      permanentTokenError: false,
      quotaLimited: false,
      code: "UNAVAILABLE",
      retryAfter: null
    });

    await expect(processPushDeliveryJob(options(db, sendMessage))).rejects.toThrow(/reagendar/i);
    expect(db.calls.some(call => call.name === "ack_push_delivery_retry")).toBe(false);
    expect(db.calls.some(call => call.name === "reschedule_push_delivery_retry")).toBe(true);
  });
});
