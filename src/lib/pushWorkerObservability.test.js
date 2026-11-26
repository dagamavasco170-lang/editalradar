import { describe, expect, it, vi } from "vitest";
import {
  persistPushWorkerRun,
  summarizePushWorkerOutcomes,
} from "../../supabase/functions/push-queue-worker/observability.js";

describe("métricas persistentes do worker push", () => {
  it("agrega todos os resultados sem carregar dados das mensagens", () => {
    const counts = summarizePushWorkerOutcomes([
      { outcome: "sent" },
      { outcome: "sent" },
      { outcome: "rescheduled" },
      { outcome: "expired" },
      { outcome: "expired_before_retry" },
      { outcome: "disabled_invalid" },
      { outcome: "invalid_message" },
      { outcome: "dead_letter" },
      { outcome: "pending_redelivery" },
      { outcome: "unknown_result", token: "never-store-this" }
    ]);

    expect(counts).toEqual({
      sent: 2,
      rescheduled: 1,
      expired: 1,
      expired_before_retry: 1,
      disabled_invalid: 1,
      invalid_message: 1,
      dead_letter: 1,
      pending_redelivery: 1
    });
    expect(JSON.stringify(counts)).not.toContain("never-store-this");
  });

  it("registra contagens e duração num único RPC agregado", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 14, error: null });
    const adminDb = { rpc };
    const summary = summarizePushWorkerOutcomes([{ outcome: "sent" }, { outcome: "rescheduled" }]);

    await expect(persistPushWorkerRun(adminDb, { processed: 2, ...summary }, 137)).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith("record_push_worker_run", {
      p_counts: {
        processed: 2,
        sent: 1,
        rescheduled: 1,
        expired: 0,
        expired_before_retry: 0,
        disabled_invalid: 0,
        invalid_message: 0,
        dead_letter: 0,
        pending_redelivery: 0,
        duration_ms: 137
      }
    });
  });

  it("grava a execução vazia para manter um heartbeat mesmo sem mensagens", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 15, error: null });

    await expect(persistPushWorkerRun({ rpc }, { processed: 0 }, 4)).resolves.toBe(true);
    expect(rpc.mock.calls[0][1].p_counts.processed).toBe(0);
    expect(rpc.mock.calls[0][1].p_counts.duration_ms).toBe(4);
  });

  it("limita contagens e duração a valores inteiros e seguros", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 16, error: null });

    await persistPushWorkerRun({ rpc }, {
      processed: 200,
      sent: -3,
      dead_letter: 2.8
    }, 90_000);

    expect(rpc.mock.calls[0][1].p_counts).toMatchObject({
      processed: 20,
      sent: 0,
      dead_letter: 2,
      duration_ms: 55_000
    });
  });

  it("não interrompe o processamento quando o RPC de observabilidade retorna erro", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("database down") });
    const onError = vi.fn();

    await expect(persistPushWorkerRun({ rpc }, { processed: 1 }, 20, onError)).resolves.toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("não interrompe o processamento quando o cliente de observabilidade lança exceção", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network down"));
    const onError = vi.fn();

    await expect(persistPushWorkerRun({ rpc }, { processed: 1 }, 20, onError)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
