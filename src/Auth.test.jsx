import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App.jsx";

const createAuthClient = () => {
  const database = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: { favorites: [], alerts: [], tasks: [false, false, false, false], notifications: [] },
      error: null
    }),
    upsert: vi.fn().mockResolvedValue({ error: null })
  };
  const adminCatalog = {
    upsert: vi.fn((payload) => ({
      select: () => ({
        single: async () => ({
          data: { id: payload.id ?? 1000001, data: payload.data, deleted: Boolean(payload.deleted), updated_at: payload.updated_at },
          error: null
        })
      })
    }))
  };
  const adminDiscoveries = {
    items: [],
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: adminDiscoveries.items.filter(item => item.status === "pending"),
          error: null
        }))
      }))
    })),
    update: vi.fn(payload => ({
      eq: vi.fn(async (_column, id) => {
        const item = adminDiscoveries.items.find(row => String(row.id) === String(id));
        if (item) Object.assign(item, payload);
        return { error: null };
      })
    }))
  };
  const client = {
    database,
    adminCatalog,
    adminDiscoveries,
    callback: null,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((callback) => {
        client.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.com/" }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    },
    from: vi.fn((table) => table === "contest_catalog" ? {
      upsert: adminCatalog.upsert
    } : table === "contest_discoveries" ? adminDiscoveries : ({
      select: () => ({
        eq: () => ({
          maybeSingle: database.maybeSingle
        })
      }),
      upsert: database.upsert
    }))
  };
  return client;
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Autenticação EditalRadar", () => {
  it("inicia autenticação com Google e retorna ao GitHub Pages", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);

    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    await waitFor(() => expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    }));
  });


  it("carrega favoritos, alertas e tarefas da nuvem ao entrar na conta", async () => {
    const client = createAuthClient();
    const cloudAlert = { id: "cloud-alert", name: "Concursos estaduais", filters: { esfera: "Estadual" } };
    client.database.maybeSingle.mockResolvedValueOnce({
      data: { favorites: [101, 102], alerts: [cloudAlert], tasks: [true, false, true, false] },
      error: null
    });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "user-cloud", email: "aluno@exemplo.com" }
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("er-account:user-cloud:favorites"))).toEqual([101, 102]);
      expect(JSON.parse(localStorage.getItem("er-account:user-cloud:alerts"))).toEqual([cloudAlert]);
      expect(JSON.parse(localStorage.getItem("er-account:user-cloud:tasks"))).toEqual([true, false, true, false]);
    });
    expect(await screen.findByText("Dados sincronizados")).toBeInTheDocument();
    expect(client.database.upsert).not.toHaveBeenCalled();
  });

  it("não transfere favoritos, alertas ou tarefas do visitante para uma conta nova", async () => {
    const client = createAuthClient();
    const visitorAlert = { id: "visitor-alert", name: "Dados locais", filters: {} };
    localStorage.setItem("er-favorites", JSON.stringify([101]));
    localStorage.setItem("er-alerts", JSON.stringify([visitorAlert]));
    localStorage.setItem("er-tasks", JSON.stringify([true, true, false, false]));
    client.database.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "new-account", email: "novo@exemplo.com" }
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("er-account:new-account:favorites"))).toEqual([]);
      expect(JSON.parse(localStorage.getItem("er-account:new-account:alerts"))).toEqual([]);
      expect(JSON.parse(localStorage.getItem("er-account:new-account:tasks"))).toEqual([false, false, false, false]);
      expect(client.database.upsert).toHaveBeenCalled();
    });
    expect(localStorage.getItem("er-favorites")).toBe(JSON.stringify([101]));
    expect(localStorage.getItem("er-alerts")).toBe(JSON.stringify([visitorAlert]));
    expect(localStorage.getItem("er-tasks")).toBe(JSON.stringify([true, true, false, false]));
    expect(screen.getByRole("button", { name: /Meus favoritos/ })).toHaveTextContent("0");
  });

  it("carrega o histórico de notificações da conta e o grava no armazenamento local", async () => {
    const client = createAuthClient();
    const cloudNotification = {
      id: "cloud-notice-1",
      type: "new",
      itemId: "101",
      title: "Aviso sincronizado",
      message: "Concurso adicionado ao catálogo",
      createdAt: "2026-11-21T12:00:00.000Z",
      read: false
    };
    client.database.maybeSingle.mockResolvedValueOnce({
      data: { favorites: [], alerts: [], tasks: [false, false, false, false], notifications: [cloudNotification] },
      error: null
    });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", { user: { id: "user-notifications", email: "aluno@exemplo.com" } });

    await waitFor(() => expect(
      JSON.parse(localStorage.getItem("er-notifications:user-notifications"))
    ).toEqual([cloudNotification]));
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    expect(await screen.findByRole("button", { name: /Aviso sincronizado/ })).toBeInTheDocument();
    expect(await screen.findByText("Dados sincronizados")).toBeInTheDocument();
  });

  it("sincroniza leitura das notificações com a conta", async () => {
    const client = createAuthClient();
    const cloudNotification = {
      id: "cloud-notice-2",
      type: "new",
      itemId: "102",
      title: "Aviso para marcar",
      message: "Atualização do concurso",
      createdAt: "2026-11-21T12:00:00.000Z",
      read: false
    };
    client.database.maybeSingle.mockResolvedValueOnce({
      data: { favorites: [], alerts: [], tasks: [false, false, false, false], notifications: [cloudNotification] },
      error: null
    });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", { user: { id: "user-notification-write", email: "aluno@exemplo.com" } });
    await screen.findByText("Dados sincronizados");
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    await screen.findByRole("button", { name: /Aviso para marcar/ });
    fireEvent.click(screen.getByRole("button", { name: /Marcar como lidas/ }));

    await waitFor(() => expect(client.database.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-notification-write",
        notifications: [expect.objectContaining({ id: "cloud-notice-2", read: true })]
      })
    ));
  });

  it("mantém a sincronização antiga e orienta sobre a migração quando a coluna ainda não existe", async () => {
    const client = createAuthClient();
    client.database.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'notifications' column of 'user_data' in the schema cache"
        }
      })
      .mockResolvedValueOnce({
        data: { favorites: [], alerts: [], tasks: [false, false, false, false] },
        error: null
      });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", { user: { id: "user-old-schema", email: "aluno@exemplo.com" } });

    expect(await screen.findByText(/202611220001_user_notifications.sql/)).toBeInTheDocument();
    expect(await screen.findByText("Dados sincronizados")).toBeInTheDocument();
  });

  it("envia favoritos, alertas e tarefas alterados para a nuvem", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "user-sync", email: "aluno@exemplo.com" }
    });

    await screen.findByText("Dados sincronizados");
    fireEvent.click(screen.getAllByLabelText("Salvar favorito")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Salvar alerta/ }));
    fireEvent.click(screen.getByRole("button", { name: /Área de estudos/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Revisar português/ }));

    await waitFor(() => expect(client.database.upsert).toHaveBeenCalledTimes(3));
    const writes = client.database.upsert.mock.calls.map(([payload]) => payload);
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: "user-sync", favorites: [101] }),
      expect.objectContaining({ user_id: "user-sync", alerts: expect.any(Array) }),
      expect.objectContaining({ user_id: "user-sync", tasks: [true, false, false, false] })
    ]));
    await waitFor(() => expect(screen.getByText("Dados sincronizados")).toBeInTheDocument());
  });

  it("renova os claims do Supabase e reconhece a permissão administrativa", async () => {
    const client = createAuthClient();
    const refreshedAdmin = {
      id: "admin-refresh",
      email: "admin@example.com",
      app_metadata: { role: "admin" }
    };
    client.auth.refreshSession = vi.fn().mockResolvedValue({
      data: { user: refreshedAdmin, session: { user: refreshedAdmin } },
      error: null
    });

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "admin-refresh", email: "admin@example.com", app_metadata: {} }
    });

    expect(await screen.findByRole("button", { name: "Administração" })).toBeInTheDocument();
    expect(client.auth.refreshSession).toHaveBeenCalled();
  });

  it("permite ao administrador cadastrar concurso com link HTTPS", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", { user: { id: "admin-user", email: "admin@example.com", app_metadata: { role: "admin" } } });
    await screen.findByText("Dados sincronizados");
    fireEvent.click(screen.getByRole("button", { name: "Administração" }));
    fireEvent.click(screen.getByRole("button", { name: /Novo concurso/ }));
    fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "Analista de Controle" } });
    fireEvent.change(screen.getByLabelText("Órgão"), { target: { value: "Controladoria Exemplo" } });
    fireEvent.change(screen.getByLabelText("Escolaridade"), { target: { value: "Superior" } });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "Edital publicado" } });
    fireEvent.change(screen.getByLabelText("Link oficial (HTTPS)"), { target: { value: "https://exemplo.gov.br/edital" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar concurso" }));
    await waitFor(() => expect(client.adminCatalog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cargo: "Analista de Controle", orgao: "Controladoria Exemplo", sourceUrl: "https://exemplo.gov.br/edital" }),
      deleted: false
    })));
    expect(await screen.findByText("Analista de Controle")).toBeInTheDocument();
  });

  it("mostra descobertas na fila e preenche o formulário ao revisar", async () => {
    const client = createAuthClient();
    client.adminDiscoveries.items = [{
      id: 88,
      source_url: "https://orgao.gov.br/concursos",
      candidate_url: "https://orgao.gov.br/editais/edital-2027.pdf",
      title: "Edital 2027 - Analista",
      context: "Link identificado em página oficial",
      discovery_type: "new_link",
      detected_at: "2026-11-21T12:00:00.000Z",
      status: "pending"
    }];

    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "admin-queue", email: "admin@example.com", app_metadata: { role: "admin" } }
    });
    await screen.findByText("Dados sincronizados");
    fireEvent.click(await screen.findByRole("button", { name: "Administração" }));

    expect(await screen.findByText("Edital 2027 - Analista")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e cadastrar" }));
    expect(screen.getByLabelText("Cargo")).toHaveValue("Edital 2027 - Analista");
    expect(screen.getByLabelText("Link oficial (HTTPS)")).toHaveValue("https://orgao.gov.br/editais/edital-2027.pdf");
  });

  it("permite editar e salvar o nome de exibição no perfil da conta", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: {
        id: "user-profile",
        email: "aluno@exemplo.com",
        user_metadata: { full_name: "Nome Antigo" }
      }
    });

    await screen.findByText("Dados sincronizados");
    expect(screen.getByText("Nome Antigo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar perfil" }));

    const profileDialog = screen.getByRole("dialog", { name: "Editar perfil" });
    const nameInput = within(profileDialog).getByLabelText("Nome de exibição");
    expect(nameInput).toHaveValue("Nome Antigo");
    fireEvent.change(nameInput, { target: { value: "Maria Concurseira" } });
    fireEvent.change(within(profileDialog).getByLabelText("Cidade"), { target: { value: "Maceió" } });
    fireEvent.change(within(profileDialog).getByLabelText("Estado"), { target: { value: "Alagoas" } });
    fireEvent.change(within(profileDialog).getByLabelText("Escolaridade"), { target: { value: "Superior completo" } });
    fireEvent.change(within(profileDialog).getByLabelText("Área de interesse"), { target: { value: "Tribunais" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    await waitFor(() => expect(client.auth.updateUser).toHaveBeenCalledWith({
      data: {
        full_name: "Maria Concurseira",
        city: "Maceió",
        state: "Alagoas",
        education_level: "Superior completo",
        interest_area: "Tribunais"
      }
    }));
    expect(await screen.findByText("Maria Concurseira")).toBeInTheDocument();
    expect(within(profileDialog).getByLabelText("Cidade")).toHaveValue("Maceió");
    expect(within(profileDialog).getByLabelText("Estado")).toHaveValue("Alagoas");
  });

  it("mostra erro e mantém a edição aberta se o Supabase rejeitar a alteração do perfil", async () => {
    const client = createAuthClient();
    client.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Falha ao salvar perfil" }
    });
    render(<App authClient={client} authConfigured />);
    await waitFor(() => expect(client.callback).toBeTypeOf("function"));
    client.callback("SIGNED_IN", {
      user: { id: "user-profile-error", email: "aluno@exemplo.com", user_metadata: {} }
    });

    await screen.findByText("Dados sincronizados");
    fireEvent.click(screen.getByRole("button", { name: "Editar perfil" }));
    fireEvent.change(await screen.findByLabelText("Nome de exibição"), {
      target: { value: "Nome de Teste" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect(await screen.findByText("Falha ao salvar perfil")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Editar perfil" })).toBeInTheDocument();
  });

  it("mostra mensagem quando o provedor Google ainda não está habilitado", async () => {
    const client = createAuthClient();
    client.auth.signInWithOAuth.mockResolvedValueOnce({
      data: { provider: "google", url: null },
      error: { message: "Unsupported provider: google" }
    });
    render(<App authClient={client} authConfigured />);

    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    expect(await screen.findByText("Unsupported provider: google")).toBeInTheDocument();
  });

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

  it("limpa todos os filtros do catálogo e volta aos resultados gerais", () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);

    const search = screen.getByPlaceholderText("Buscar cargo ou órgão...");
    fireEvent.change(search, { target: { value: "termo sem correspondência" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Alagoas" } });
    fireEvent.click(screen.getByRole("button", { name: "Inscrições abertas", exact: true }));

    const clearButton = screen.getByRole("button", { name: /Limpar filtros/ });
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);

    expect(search).toHaveValue("");
    expect(screen.getByLabelText("Estado")).toHaveValue("Todos os estados");
    expect(screen.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Limpar filtros/ })).not.toBeInTheDocument();
  });

  it("abre a página completa de um concurso, mostra cronograma e permite focar a preparação", async () => {
    const client = createAuthClient();
    render(<App authClient={client} authConfigured />);

    fireEvent.change(screen.getByPlaceholderText("Buscar cargo ou órgão..."), {
      target: { value: "Polícia Civil" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "Agente e Escrivão de Polícia Civil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cronograma e etapas" })).toBeInTheDocument();
    expect(screen.getByText(/06 de dezembro de 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acessar fonte oficial/ })).toHaveAttribute("href", "https://www.cebraspe.org.br/concursos/pc_al_26");

    fireEvent.click(screen.getByRole("button", { name: "Preparar para este concurso" }));
    expect(screen.getByRole("heading", { name: "Área de estudos" })).toBeInTheDocument();
    expect(screen.getByText("FOCO DA SUA PREPARAÇÃO")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos detalhes" }));
    expect(screen.getByRole("heading", { name: "Agente e Escrivão de Polícia Civil" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Voltar para concursos/ }));
    expect(screen.getByRole("heading", { name: "Concursos e avisos no catálogo" })).toBeInTheDocument();
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
