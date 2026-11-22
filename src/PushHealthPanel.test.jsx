import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PushHealthPanel from "./PushHealthPanel.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const snapshotNow = new Date().toISOString();

const healthSnapshot = {
  generated_at: snapshotNow,
  queue: { queue_length: 0, visible_length: 0, oldest_message_age_seconds: null },
  scheduler: {
    active: true,
    schedule: "* * * * *",
    last_run_at: snapshotNow,
    last_run_status: "succeeded",
    last_run_age_seconds: 20
  },
  worker_http: {
    status_code: 200,
    created_at: snapshotNow,
    timed_out: false,
    error: null,
    result_counts: {
      available: true, processed: 4, sent: 1, rescheduled: 1, expired: 1,
      expired_before_retry: 0, disabled_invalid: 0, invalid_message: 0,
      dead_letter: 0, pending_redelivery: 0
    }
  },
  devices: { total: 1, enabled: 1, disabled: 0 },
  worker_history: {
    available: true,
    last_run_at: snapshotNow,
    last_duration_ms: 135,
    runs_24h: 1440,
    processed_24h: 12,
    sent_24h: 9,
    rescheduled_24h: 2,
    expired_24h: 1,
    disabled_invalid_24h: 0,
    dead_letter_24h: 0,
    pending_redelivery_24h: 0
  },
  failures: { total: 0, last_24h: 0, latest_at: null },
  recent_errors: []
};

describe("PushHealthPanel", () => {
  it("loads the protected metrics and renders operational indicators", async () => {
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: healthSnapshot, error: null }) };
    render(<PushHealthPanel authClient={authClient} />);

    expect(await screen.findByText("Operação normal")).toBeTruthy();
    expect(screen.getByText("HTTP 200")).toBeTruthy();
    expect(screen.getByText("1 ativo")).toBeTruthy();
    expect(screen.getByText("Resultado do último lote")).toBeTruthy();
    expect(screen.getAllByText("Aguardando recuperação")).toHaveLength(2);
    expect(screen.getByText("Falhas definitivas")).toBeTruthy();
    expect(screen.getByText("Histórico das últimas 24 horas")).toBeTruthy();
    expect(screen.getByText("1.440 execuções · última em " + new Date(snapshotNow).toLocaleString("pt-BR"))).toBeTruthy();
    expect(authClient.rpc).toHaveBeenCalledWith("get_push_notification_health");
  });

  it("warns when the worker leaves a message pending redelivery", async () => {
    const snapshot = {
      ...healthSnapshot,
      worker_http: {
        ...healthSnapshot.worker_http,
        result_counts: { ...healthSnapshot.worker_http.result_counts, pending_redelivery: 1 }
      }
    };
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: snapshot, error: null }) };
    render(<PushHealthPanel authClient={authClient} />);

    expect(await screen.findByText("Atenção necessária")).toBeTruthy();
    expect(screen.getAllByText("Aguardando recuperação")).toHaveLength(2);
  });

  it("warns from persistent 24-hour history even when the latest batch is clean", async () => {
    const snapshot = {
      ...healthSnapshot,
      worker_history: { ...healthSnapshot.worker_history, dead_letter_24h: 1 }
    };
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: snapshot, error: null }) };
    render(<PushHealthPanel authClient={authClient} />);

    expect(await screen.findByText("Atenção necessária")).toBeTruthy();
  });

  it("allows an administrator to refresh the snapshot", async () => {
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: healthSnapshot, error: null }) };
    render(<PushHealthPanel authClient={authClient} />);
    await screen.findByText("Operação normal");

    fireEvent.click(screen.getByRole("button", { name: /atualizar/i }));
    await waitFor(() => expect(authClient.rpc).toHaveBeenCalledTimes(2));
  });

  it("shows a safe access message when the RPC is rejected", async () => {
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("permission denied") }) };
    render(<PushHealthPanel authClient={authClient} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/acesso de administrador/i);
    expect(screen.queryByText(/token|service_role/i)).toBeNull();
  });
});
