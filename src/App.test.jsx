import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";

describe("EditalRadar", () => {
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
