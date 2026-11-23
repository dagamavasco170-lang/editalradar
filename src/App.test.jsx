import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { concursos } from "./data/concursos.js";
import { scoreRecommendation } from "./App.jsx";
import { buildCatalogSnapshot, getVisibleNotifications } from "./lib/notifications";

describe("EditalRadar", () => {
  it("alterna o modo escuro, sincroniza com o Android e restaura a preferência após recarregar", () => {
    localStorage.clear();
    const postMessage = vi.fn();
    Object.defineProperty(window, "EditalRadarNative", {
      configurable: true,
      value: { postMessage }
    });

    const firstRender = render(<App authClient={null} authConfigured={false} />);
    const darkToggle = screen.getByRole("button", { name: "Ativar modo escuro" });
    expect(darkToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(darkToggle);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("er-theme")).toBe(JSON.stringify("dark"));
    expect(screen.getByRole("button", { name: "Ativar modo claro" })).toHaveAttribute("aria-pressed", "true");
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: "set_theme", theme: "dark" }));

    firstRender.unmount();
    render(<App authClient={null} authConfigured={false} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Ativar modo claro" })).toHaveAttribute("aria-pressed", "true");
    delete window.EditalRadarNative;
  });
  it("atualiza o estado quando o Android confirma a permissão de notificações", () => {
    localStorage.clear();
    const postMessage = vi.fn();
    Object.defineProperty(window, "EditalRadarNative", {
      configurable: true,
      value: { postMessage }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar notificações" }));
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({
      action: "request_notification_permission"
    }));
    expect(screen.getByText(/Permita os avisos quando o Android solicitar/)).toBeInTheDocument();

    fireEvent(window, new CustomEvent("editalradar:native-notification-permission", {
      detail: { granted: true }
    }));

    expect(screen.getByRole("button", { name: "Notificações ativadas" })).toBeDisabled();
    expect(screen.getByText(/Notificações ativadas! Avisaremos quando houver novidades/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("er-browser-notifications"))).toBe(true);
    delete window.EditalRadarNative;
  });

  it("não exibe detalhes técnicos na central de notificações para usuários comuns", () => {
    localStorage.clear();
    render(<App authClient={null} authConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    const panel = within(screen.getByRole("region", { name: "Notificações do EditalRadar" }));
    expect(panel.queryByText(/Firebase|Cloud Messaging|Supabase|SQL Editor|FCM|token|sincronização|cache/i)).not.toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /Testar recebimento push|Testar em segundo plano/i })).not.toBeInTheDocument();
  });

  it("não mostra instruções técnicas de configuração no acesso à conta", () => {
    localStorage.clear();
    render(<App authClient={null} authConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    expect(screen.getByText(/O acesso à conta está temporariamente indisponível/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Supabase|SQL Editor|VITE_SUPABASE|GitHub Actions/);
  });

  it("detecta um novo concurso e abre seus detalhes pela central de notificações", async () => {
    localStorage.clear();
    const latest = [...concursos].reverse().find((item) => !String(item.status || "").toLowerCase().includes("concurso listado"));
    const previous = buildCatalogSnapshot(concursos.filter((item) => String(item.id) !== String(latest.id)));
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(previous));

    render(<App />);

    const notification = await screen.findByRole("button", { name: /Novo concurso no catálogo/ });
    expect(notification).toHaveTextContent(latest.cargo);
    fireEvent.click(notification);

    expect(await screen.findByRole("heading", { level: 1, name: latest.cargo })).toBeInTheDocument();
  });
  it("filtra, marca como lidas e limpa notificações", async () => {
    localStorage.clear();
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(buildCatalogSnapshot(concursos)));
    localStorage.setItem("er-notifications:visitor", JSON.stringify([
      {
        id: "notification-unread",
        type: "new",
        itemId: String(concursos[0].id),
        title: "Notificação recente",
        message: "Novo concurso para acompanhar",
        createdAt: "2026-11-21T12:00:00.000Z",
        read: false
      },
      {
        id: "notification-read",
        type: "favorite-update",
        itemId: String(concursos[1].id),
        title: "Notificação antiga",
        message: "Uma atualização já conferida",
        createdAt: "2026-11-20T12:00:00.000Z",
        read: true
      }
    ]));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    expect(screen.getByRole("region", { name: "Notificações do EditalRadar" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Notificação recente/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Não lidas \(1\)/ }));
    expect(screen.getByRole("button", { name: /Notificação recente/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Notificação antiga/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Marcar como lidas/ }));
    expect(screen.getByText(/Não há notificações não lidas/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Todas \(2\)/ }));
    expect(screen.getByRole("button", { name: /Notificação antiga/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Limpar histórico/ }));
    expect(screen.getByText(/Nenhuma novidade por enquanto/)).toBeInTheDocument();
    const storedHistory = JSON.parse(localStorage.getItem("er-notifications:visitor"));
    expect(storedHistory).toHaveLength(2);
    expect(storedHistory.every((item) => item.dismissedAt && item.read)).toBe(true);
    expect(getVisibleNotifications(storedHistory)).toEqual([]);
  });

  it("permite dispensar um aviso individual sem apagar os outros e sem fazê-lo voltar", async () => {
    localStorage.clear();
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(buildCatalogSnapshot(concursos)));
    localStorage.setItem("er-notifications:visitor", JSON.stringify([
      {
        id: "notice-to-dismiss",
        type: "new",
        itemId: String(concursos[0].id),
        title: "Aviso individual",
        message: "Este aviso será dispensado",
        createdAt: "2026-11-21T12:00:00.000Z",
        read: false
      },
      {
        id: "notice-to-keep",
        type: "new",
        itemId: String(concursos[1].id),
        title: "Aviso preservado",
        message: "Este aviso continua",
        createdAt: "2026-11-21T12:01:00.000Z",
        read: false
      }
    ]));

    const firstRender = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    expect(await screen.findByRole("button", { name: /Aviso individual/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Aviso individual" })).getByRole("button", { name: "Dispensar este aviso" }));

    expect(screen.queryByRole("button", { name: /Aviso individual/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aviso preservado/ })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem("er-notifications:visitor"));
    expect(stored).toEqual([
      expect.objectContaining({ id: "notice-to-dismiss", dismissedAt: expect.any(String), read: true }),
      expect.objectContaining({ id: "notice-to-keep", title: "Aviso preservado" })
    ]);

    firstRender.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    expect(screen.queryByRole("button", { name: /Aviso individual/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aviso preservado/ })).toBeInTheDocument();
  });

  it("não recria como nova uma notificação já apagada mesmo se o catálogo voltar a ser comparado", async () => {
    localStorage.clear();
    const latest = [...concursos].reverse().find((item) => !String(item.status || "").toLowerCase().includes("concurso listado"));
    const previous = buildCatalogSnapshot(concursos.filter((item) => String(item.id) !== String(latest.id)));
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(previous));

    const firstRender = render(<App />);
    expect(await screen.findByRole("button", { name: /Novo concurso no catálogo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));
    fireEvent.click(screen.getByRole("button", { name: /Limpar histórico/ }));

    const storedAfterDismissal = JSON.parse(localStorage.getItem("er-notifications:visitor"));
    expect(storedAfterDismissal).toEqual([
      expect.objectContaining({ id: `new-${latest.id}`, dismissedAt: expect.any(String), read: true })
    ]);

    // Simulate a stale catalog snapshot after refresh; the dismissal marker must win.
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(previous));
    firstRender.unmount();
    render(<App />);

    expect(screen.queryByRole("button", { name: /Novo concurso no catálogo/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhuma novidade por enquanto/)).toBeInTheDocument();
  });

  it("permite carregar o histórico completo além dos oito avisos iniciais", async () => {
    localStorage.clear();
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(buildCatalogSnapshot(concursos)));
    const history = Array.from({ length: 10 }, (_, index) => ({
      id: `history-${index + 1}`,
      type: "new",
      itemId: String(concursos[index % concursos.length].id),
      title: `Aviso ${index + 1}`,
      message: `Detalhe do aviso ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 10, 21, 12, index)).toISOString(),
      read: true
    }));
    localStorage.setItem("er-notifications:visitor", JSON.stringify(history));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Ver notificações/ }));

    expect(screen.getByText("Aviso 1")).toBeInTheDocument();
    expect(screen.getByText("Aviso 8")).toBeInTheDocument();
    expect(screen.queryByText("Aviso 9")).not.toBeInTheDocument();
    expect(screen.queryByText("Aviso 10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver mais avisos (2 restantes)" }));

    expect(screen.getByText("Aviso 9")).toBeInTheDocument();
    expect(screen.getByText("Aviso 10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver mais avisos/ })).not.toBeInTheDocument();
  });

  it("exibe o painel inteligente do candidato e abre a rotina de estudos pelo atalho", async () => {
    localStorage.clear();
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(buildCatalogSnapshot(concursos)));

    render(<App />);

    const dashboard = screen.getByRole("region", { name: "Painel inteligente do candidato" });
    expect(dashboard).toHaveTextContent("Sua jornada em um só lugar");
    expect(dashboard).toHaveTextContent("Próximas datas importantes");
    expect(dashboard).toHaveTextContent(/Agenda de oportunidades/i);
    expect(within(dashboard).getByRole("button", { name: /Rotina de estudos: 0% concluída/ })).toBeInTheDocument();

    fireEvent.click(within(dashboard).getByRole("button", { name: /Rotina de estudos/ }));
    expect(await screen.findByRole("heading", { name: "Área de estudos" })).toBeInTheDocument();
  });

  it("mostra instruções para instalar o aplicativo em diferentes dispositivos", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Como instalar" }));
    const dialog = screen.getByRole("dialog", { name: "Instale o EditalRadar" });
    expect(within(dialog).getByText("Android")).toBeInTheDocument();
    expect(within(dialog).getByText("iPhone ou iPad")).toBeInTheDocument();
    expect(within(dialog).getByText("Computador")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Entendi" }));
    expect(screen.queryByRole("dialog", { name: "Instale o EditalRadar" })).not.toBeInTheDocument();
  });

  it("informa quando o dispositivo fica sem conexão e quando reconecta", () => {
    render(<App />);

    fireEvent(window, new Event("offline"));
    expect(screen.getByRole("status")).toHaveTextContent(/Sem conexão no momento/);

    fireEvent(window, new Event("online"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renderiza a página inicial e os concursos oficiais", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Encontre concursos/i })
    ).toBeInTheDocument();

    expect(screen.getAllByText("Banco Central do Brasil").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Receita Federal do Brasil").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Controladoria-Geral da União").length).toBeGreaterThan(0);
  });

  it("filtra concursos pelo nome do órgão", () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Buscar cargo ou órgão..."), {
      target: { value: "Controladoria" }
    });

    expect(screen.getAllByText("Controladoria-Geral da União").length).toBeGreaterThan(0);
    expect(screen.queryByText("Banco Central do Brasil")).not.toBeInTheDocument();
    expect(screen.queryByText("Receita Federal do Brasil")).not.toBeInTheDocument();
  });

  it("filtra concursos por escolaridade", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Escolaridade"), { target: { value: "Médio" } });

    expect(screen.getByText("Técnico — Carreira de Especialista")).toBeInTheDocument();
    expect(screen.queryByText("Auditor — Carreira de Especialista")).not.toBeInTheDocument();
  });

  it("filtra oportunidades pela esfera estadual", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Esfera"), { target: { value: "Estadual" } });

    expect(screen.getAllByText("Polícia Civil do Estado de Alagoas").length).toBeGreaterThan(0);
    expect(screen.queryByText("Banco Central do Brasil")).not.toBeInTheDocument();
  });

  it("filtra por cidade e mostra oportunidades de Paripueira", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Paripueira" } });

    expect(screen.getByText("Cargos efetivos a definir")).toBeInTheDocument();
    expect(within(document.querySelector(".cards")).getByText("Professor — Matemática (lotação em Paripueira)")).toBeInTheDocument();
    expect(within(document.querySelector(".cards")).getByText("Professor — Português (lotação em Paripueira)")).toBeInTheDocument();
    expect(screen.queryByText("Banco Central do Brasil")).not.toBeInTheDocument();
  });

  it("identifica concurso municipal sem vagas publicadas", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Esfera"), { target: { value: "Municipal" } });

    expect(screen.getByText("Cargos efetivos a definir")).toBeInTheDocument();
    expect(screen.getAllByText(/Vagas a divulgar/).length).toBeGreaterThan(0);
  });

  it("lista concursos municipais de Pão de Açúcar e Teotônio Vilela", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Esfera"), { target: { value: "Municipal" } });

    expect(screen.getByText("Diversos cargos efetivos (31 cargos)")).toBeInTheDocument();
    expect(screen.getByText("Cargos da Secretaria Municipal de Educação (11 cargos)")).toBeInTheDocument();
    expect(screen.getByText("Cargos efetivos a definir")).toBeInTheDocument();
  });

  it("filtra oportunidades municipais por cidade", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Pão de Açúcar" } });

    expect(screen.getByText("Diversos cargos efetivos (31 cargos)")).toBeInTheDocument();
    expect(screen.queryByText("Banco Central do Brasil")).not.toBeInTheDocument();
  });

  it("inclui o PROCON/AL na esfera estadual com link oficial", () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Buscar cargo ou órgão..."), {
      target: { value: "PROCON" }
    });

    expect(within(document.querySelector(".cards")).getByText("Analista e Fiscal de Proteção e Defesa do Consumidor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByRole("link", { name: /Acessar fonte oficial/ }))
      .toHaveAttribute("href", "https://www.cebraspe.org.br/concursos/SEPLAG_AL_26_PROCON");
  });

  it("salva alerta personalizado usando os filtros atuais", () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Buscar cargo ou órgão..."), {
      target: { value: "PROCON" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alerta/ }));

    expect(screen.getByText("PROCON")).toBeInTheDocument();
    expect(screen.getByText("1 oportunidade(s) correspondente(s)")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("er-alerts"))).toHaveLength(1);
  });

  it("evita duplicar alertas e permite removê-los", () => {
    render(<App />);

    const saveButton = screen.getByRole("button", { name: /Salvar alerta/ });
    fireEvent.click(saveButton);

    expect(screen.getByRole("button", { name: "Alerta já salvo" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem("er-alerts"))).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Remover alerta Todos os concursos/ }));
    expect(screen.getByText(/Você ainda não salvou alertas/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("er-alerts"))).toHaveLength(0);
  });

  it("mostra como ativar cadastro e login quando o Supabase ainda não está conectado", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));

    expect(screen.getByRole("dialog", { name: /Entrar na sua conta/ })).toBeInTheDocument();
    expect(screen.getByText(/O acesso à conta está temporariamente indisponível/)).toBeInTheDocument();
    expect(screen.queryByText(/Supabase|SQL Editor|VITE_SUPABASE|GitHub Actions/)).not.toBeInTheDocument();
  });

  it("fecha o modal de autenticação pelo botão de fechar", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Entrar \/ cadastrar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar cadastro e login" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });


  it("identifica registros preliminares e deixa claro que a listagem não é edital", () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Buscar cargo ou órgão..."), {
      target: { value: "Departamento de Estradas e Rodagem" }
    });

    expect(screen.getByText("Listagem de referência")).toBeInTheDocument();
    expect(screen.getByText(/Concurso listado · verificar edital e cronograma/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByRole("link", { name: /Abrir referência externa — confirme no órgão/ }))
      .toHaveAttribute("href", "https://concursor.com.br/editais?uf=AL");
    expect(screen.getByText(/ainda não foram confirmados individualmente em edital oficial/i)).toBeInTheDocument();
  });

  it("não soma as vagas dos registros preliminares à métrica principal", () => {
    render(<App />);

    const verifiedVacancies = concursos
      .filter((item) => item && !/concurso listado\s*·\s*verificar/i.test(item.status || ""))
      .reduce((sum, item) => sum + (Number(item.vagas) || 0), 0);
    const metric = screen.getByText("Vagas em fichas com fonte oficial").closest(".stat");

    expect(metric.querySelector("strong")).toHaveTextContent(
      new Intl.NumberFormat("pt-BR").format(verifiedVacancies)
    );
    expect(screen.getByText(/registro\(s\) são preliminares/)).toBeInTheDocument();
  });

  it("oculta os registros preliminares e atualiza a quantidade exibida", () => {
    render(<App />);

    expect(screen.getByText("39 registros")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Ocultar registros preliminares"));

    expect(screen.getByText("28 registros")).toBeInTheDocument();
    expect(screen.getByLabelText("Ocultar registros preliminares")).toBeChecked();
  });

  it("salva o filtro de registros não preliminares dentro do alerta", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Ocultar registros preliminares"));
    fireEvent.click(screen.getByRole("button", { name: /Salvar alerta/ }));

    expect(screen.getByText(/Somente fichas não preliminares/)).toBeInTheDocument();
    expect(screen.getByText("28 oportunidade(s) correspondente(s)")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("er-alerts"))[0].filters.ocultarPreliminares).toBe(true);
  });

  it("salva um concurso nos favoritos e mostra a lista", () => {
    render(<App />);

    fireEvent.click(screen.getAllByLabelText("Salvar favorito")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Meus favoritos/ }));

    expect(screen.getByRole("heading", { name: "Seus concursos favoritos" })).toBeInTheDocument();
    expect(screen.getByText("Auditor — Carreira de Especialista")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Meus favoritos/ })).toHaveTextContent("1");
  });

  it("abre os detalhes de um concurso e exibe sua fonte oficial", () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);

    expect(screen.getByRole("heading", { level: 1, name: "Auditor — Carreira de Especialista" })).toBeInTheDocument();
    expect(screen.getByText(/100 vagas autorizadas para Auditor/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cronograma e etapas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acessar fonte oficial/ }))
      .toHaveAttribute("href", "https://www.bcb.gov.br/acessoinformacao/concursospublicos");
  });

  it("compara duas oportunidades lado a lado e informa quando a remuneração não está cadastrada", () => {
    localStorage.removeItem("er-comparison:visitor");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar Auditor — Carreira de Especialista à comparação" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Técnico — Carreira de Especialista à comparação" }));
    expect(screen.getByRole("button", { name: "Comparar concursos (2)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Comparar concursos (2)" }));
    expect(screen.getByRole("heading", { name: "Comparador de concursos" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tabela de comparação dos concursos" })).toBeInTheDocument();
    expect(screen.getAllByText("Não informado nesta ficha").length).toBeGreaterThan(0);
    expect(screen.getByText("Vagas informadas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover Auditor — Carreira de Especialista da comparação" }));
    expect(screen.getByText("Escolha pelo menos dois concursos")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("er-comparison:visitor"))).toEqual([concursos[1].id]);
  });

  it("limita a comparação a três oportunidades", () => {
    localStorage.removeItem("er-comparison:visitor");
    render(<App />);

    const compareButtons = screen.getAllByRole("button", { name: /Adicionar .* à comparação/ });
    fireEvent.click(compareButtons[0]);
    fireEvent.click(compareButtons[1]);
    fireEvent.click(compareButtons[2]);
    expect(screen.getByRole("button", { name: "Comparar concursos (3)" })).toBeInTheDocument();
    const disabledButtons = screen.getAllByRole("button", { name: /Adicionar .* à comparação/ });
    expect(disabledButtons.length).toBeGreaterThan(0);
    expect(disabledButtons.every((button) => button.disabled)).toBe(true);
  });

  it("abre a área de estudos e permite concluir uma tarefa", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Área de estudos/ }));
    const task = await screen.findByRole("checkbox", { name: /Revisar português/ });

    expect(task).not.toBeChecked();
    fireEvent.click(task);
    expect(task).toBeChecked();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});

describe("recomendações personalizadas",()=>{it("pontua melhor concursos alinhados à área fiscal e escolaridade superior",()=>{const profile={interest_area:"Fiscal e controle",education_level:"Superior completo",state:"Alagoas"};const aligned=concursos.find(item=>/auditor/i.test(item.cargo)&&/Brasil|Alagoas/.test(item.estado||""));const unrelated=concursos.find(item=>/professor/i.test(item.cargo));expect(scoreRecommendation(aligned,profile)).toBeGreaterThan(scoreRecommendation(unrelated,profile));});});
