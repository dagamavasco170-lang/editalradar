import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";
import { concursos } from "./data/concursos.js";
import { scoreRecommendation } from "./App.jsx";
import { buildCatalogSnapshot } from "./lib/notifications";

describe("EditalRadar", () => {
  it("detecta um novo concurso e abre seus detalhes pela central de notificações", async () => {
    localStorage.clear();
    const latest = [...concursos].reverse().find((item) => !String(item.status || "").toLowerCase().includes("concurso listado"));
    const previous = buildCatalogSnapshot(concursos.filter((item) => String(item.id) !== String(latest.id)));
    localStorage.setItem("er-catalog-snapshot:visitor", JSON.stringify(previous));

    render(<App />);

    const notification = await screen.findByRole("button", { name: /Novo concurso no catálogo/ });
    expect(notification).toHaveTextContent(latest.cargo);
    fireEvent.click(notification);

    expect(await screen.findByRole("heading", { level: 2, name: latest.cargo })).toBeInTheDocument();
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
    expect(JSON.parse(localStorage.getItem("er-notifications:visitor"))).toEqual([]);
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
    expect(screen.getByRole("status")).toHaveTextContent(/Você está offline/);

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
    expect(screen.getByText("Professor — Matemática (lotação em Paripueira)")).toBeInTheDocument();
    expect(screen.getByText("Professor — Português (lotação em Paripueira)")).toBeInTheDocument();
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

    expect(screen.getByText("Analista e Fiscal de Proteção e Defesa do Consumidor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByRole("link", { name: /Consultar página oficial do concurso/ }))
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
    expect(screen.getByText(/falta conectar o projeto ao Supabase/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir guia de configuração/ }))
      .toHaveAttribute("href", "https://github.com/dagamavasco170-lang/editalradar/blob/main/SUPABASE_SETUP.md");
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
      target: { value: "Agência Reguladora" }
    });

    expect(screen.getByText("Listagem de referência")).toBeInTheDocument();
    expect(screen.getByText(/Concurso listado · verificar edital e cronograma/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByRole("link", { name: /Abrir listagem de referência — não é edital/ }))
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

    expect(screen.getByText("35 registros")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Ocultar registros preliminares"));

    expect(screen.getByText("23 registros")).toBeInTheDocument();
    expect(screen.getByLabelText("Ocultar registros preliminares")).toBeChecked();
  });

  it("salva o filtro de registros não preliminares dentro do alerta", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Ocultar registros preliminares"));
    fireEvent.click(screen.getByRole("button", { name: /Salvar alerta/ }));

    expect(screen.getByText(/Somente fichas não preliminares/)).toBeInTheDocument();
    expect(screen.getByText("23 oportunidade(s) correspondente(s)")).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { level: 2, name: "Auditor — Carreira de Especialista" })).toBeInTheDocument();
    expect(screen.getByText(/100 vagas autorizadas para Auditor/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Consultar página oficial do concurso/ }))
      .toHaveAttribute("href", "https://www.bcb.gov.br/acessoinformacao/concursospublicos");
  });

  it("abre a área de estudos e permite concluir uma tarefa", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Área de estudos/ }));
    const task = screen.getByRole("checkbox", { name: /Revisar português/ });

    expect(task).not.toBeChecked();
    fireEvent.click(task);
    expect(task).toBeChecked();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});

describe("recomendações personalizadas",()=>{it("pontua melhor concursos alinhados à área fiscal e escolaridade superior",()=>{const profile={interest_area:"Fiscal e controle",education_level:"Superior completo",state:"Alagoas"};const aligned=concursos.find(item=>/auditor/i.test(item.cargo)&&/Brasil|Alagoas/.test(item.estado||""));const unrelated=concursos.find(item=>/professor/i.test(item.cargo));expect(scoreRecommendation(aligned,profile)).toBeGreaterThan(scoreRecommendation(unrelated,profile));});});
