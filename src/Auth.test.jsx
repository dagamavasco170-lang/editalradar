import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";

const createAuthClient = () => {
  const client = {
    callback: null,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((callback) => {
        client.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    },
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
  return client;
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Autenticação EditalRadar", () => {
  it("permite abrir o cadastro e envia a criação da conta ao Supabase", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);

    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Não tem conta\? Criar conta/ }));

    expect(screen.getByRole("heading", { name: "Criar sua conta" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "novo@exemplo.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta", exact: true }));

    await waitFor(() => expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "novo@exemplo.com",
      password: "SenhaSegura123",
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    }));
    expect(await screen.findByText(/Cadastro iniciado\. Confira seu e-mail/)).toBeInTheDocument();
  });

  it("envia solicitação de recuperação sem revelar se o e-mail existe", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);

    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Esqueci minha senha/ }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "aluno@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar link de recuperação/ }));

    await waitFor(() => expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "aluno@exemplo.com",
      { redirectTo: window.location.origin + window.location.pathname }
    ));
    expect(await screen.findByText(/Se este e-mail estiver cadastrado/)).toBeInTheDocument();
  });

  it("abre formulário de nova senha ao receber PASSWORD_RECOVERY", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));

    client.callback("PASSWORD_RECOVERY", {
      user: { id: "user-123", email: "aluno@exemplo.com" }
    });

    expect(await screen.findByRole("heading", { name: "Criar nova senha" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveValue("aluno@exemplo.com");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    await waitFor(() => expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "SenhaSegura123" }));
  });

  it("não altera senha quando os campos de confirmação são diferentes", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("PASSWORD_RECOVERY", {
      user: { id: "user-456", email: "aluno@exemplo.com" }
    });

    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "SenhaSegura123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "SenhaDiferente123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText("As senhas não coincidem.")).toBeInTheDocument();
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });
});
