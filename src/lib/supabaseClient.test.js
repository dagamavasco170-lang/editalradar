import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ auth: {} }))
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  createClientMock.mockClear();
});

describe("configuração de autenticação Supabase", () => {
  it("usa PKCE e detecta o código de retorno do OAuth no deep link", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    const { supabase, isSupabaseConfigured } = await import("./supabaseClient.js");

    expect(isSupabaseConfigured).toBe(true);
    expect(supabase).toBeTruthy();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      }
    );
  });
});
