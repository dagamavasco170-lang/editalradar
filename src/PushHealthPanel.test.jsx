import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PushHealthPanel from "./PushHealthPanel.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const healthSnapshot = {
  generated_at: "2026-11-22T14:35:00.000Z",
  queue: { queue_length: 0, visible_length: 0, oldest_message_age_seconds: null },
  scheduler: {
    active: true,
    schedule: "* * * * *",
    last_run_at: "2026-11-22T14:35:00.000Z",
    last_run_status: "succeeded",
    last_run_age_seconds: 20
  },
  worker_http: { status_code: 200, created_at: "2026-11-22T14:35:00.000Z", timed_out: false, error: null },
  devices: { total: 1, enabled: 1, disabled: 0 },
  failures: { total: 0, last_24h: 0, latest_at: null },
  recent_errors: []
};

describe("PushHealthPanel", () => {
  it("loads the protected metrics and renders operational indicators", async () => {
    const authClient = { rpc: vi.fn().mockResolvedValue({ data: healthSnapshot, error: null }) };
    render(<PushHealthPanel authClient={authClient} />);

    expect(await screen.findByText("Operação normal")).toBeTruthy();
    expect(screen.getByText("HTTP 200")).toBeTruthy();
    expect(screen.getByText("1 ativos")).toBeTruthy();
    expect(authClient.rpc).toHaveBeenCalledWith("get_push_notification_health");
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
