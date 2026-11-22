import { afterEach, describe, expect, it, vi } from "vitest";
import { isAndroidApp, sendNativeMessage } from "./android-bridge.js";

afterEach(() => {
  delete window.EditalRadarNative;
});

describe("ponte segura do aplicativo Android", () => {
  it("reconhece apenas a ponte moderna baseada em postMessage", () => {
    expect(isAndroidApp()).toBe(false);
    window.EditalRadarNative = { requestFcmToken: vi.fn() };
    expect(isAndroidApp()).toBe(false);

    window.EditalRadarNative = { postMessage: vi.fn() };
    expect(isAndroidApp()).toBe(true);
  });

  it("envia mensagens JSON com ações e dados explícitos", () => {
    const postMessage = vi.fn();
    window.EditalRadarNative = { postMessage };

    expect(sendNativeMessage("show_notification", {
      title: "EditalRadar",
      message: "Há novidades."
    })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({
      title: "EditalRadar",
      message: "Há novidades.",
      action: "show_notification"
    }));
  });

  it("falha com segurança quando a ponte não está disponível", () => {
    expect(sendNativeMessage("request_fcm_token")).toBe(false);
    window.EditalRadarNative = { postMessage: vi.fn(() => { throw new Error("unavailable"); }) };
    expect(sendNativeMessage("request_fcm_token")).toBe(false);
  });
});
