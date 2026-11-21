import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";

describe("EditalRadar", () => {
  it("renderiza a página inicial e os concursos oficiais", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Encontre concursos com informação verificada/i })
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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Médio" } });

    expect(screen.getByText("Técnico — Carreira de Especialista")).toBeInTheDocument();
    expect(screen.queryByText("Auditor — Carreira de Especialista")).not.toBeInTheDocument();
  });

  it("salva um concurso nos favoritos e mostra a lista", () => {
    render(<App />);

    fireEvent.click(screen.getAllByLabelText("Salvar favorito")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Meus favoritos/ }));

    expect(screen.getByRole("heading", { name: "Seus concursos favoritos" })).toBeInTheDocument();
    expect(screen.getByText("Auditor — Carreira de Especialista")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
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
