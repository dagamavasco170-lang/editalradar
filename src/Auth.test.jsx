import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";

const authMocks = vi.hoisted(() => {
  const mocks = {
    configured: true,
    callback: null,
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn((callback) => {
      mocks.callback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { favorites: [], alerts: [], tasks: [false, false, false, false] },
            error: null
          })
        })
      }),
      upsert: vi.fn().mockResolvedValue({ error: null })
    }))
  };
  return mocks;
});

vi.mock("./lib/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return authMocks.configured;
  },
  supabase: {
    auth: {
      getSession: (...args) => authMocks.getSession(...args),
      onAuthStateChange: (...args) => authMocks.onAuthStateChange(...args),
      signInWithPassword: (...args) => authMocks.signInWithPassword(...args),
      signUp: (...args) => authMocks.signUp(...args),
      resetPasswordForEmail: (...args) => authMocks.resetPasswordForEmail(...args),
      updateUser: (...args) => authMocks.updateUser(...args),
      signOut: (...args) => authMocks.signOut(...args)
    },
    from: (...args) => authMocks.from(...args)
  }
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authMocks.configured = true;
  authMocks.callback = null;
});

describe("Autenticação EditalRadar", () => {
  it("envia solicitação de recuperação sem revelar se o e-mail existe", async () => {
    render(<App />);
    await waitFor(() => expect(authMocks.onAuthStateChange).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Esqueci minha senha/ }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "aluno@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar link de recuperação/ }));

    await waitFor(() => expect(authMocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "aluno@exemplo.com",
      { redirectTo: window.location.origin + window.location.pathname }
    ));
    expect(await screen.findByText(/Se este e-mail estiver cadastrado/)).toBeInTheDocument();
  });

  it("abre formulário de nova senha ao receber PASSWORD_RECOVERY", async () => {
    render(<App />);
    await waitFor(() => expect(authMocks.callback).toBeTypeOf("function"));

    authMocks.callback("PASSWORD_RECOVERY", {
      user: { id: "user-123", email: "aluno@exemplo.com" }
    });

    expect(await screen.findByRole("heading", { name: "Criar nova senha" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    await waitFor(() => expect(authMocks.updateUser).toHaveBeenCalledWith({ password: "SenhaSegura123" }));
  });

  it("não altera senha quando os campos de confirmação são diferentes", async () => {
    render(<App />);
    await waitFor(() => expect(authMocks.callback).toBeTypeOf("function"));
    authMocks.callback("PASSWORD_RECOVERY", {
      user: { id: "user-456", email: "aluno@exemplo.com" }
    });

    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "SenhaDiferente123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText("As senhas não coincidem.")).toBeInTheDocument();
    expect(authMocks.updateUser).not.toHaveBeenCalled();
  });
});
