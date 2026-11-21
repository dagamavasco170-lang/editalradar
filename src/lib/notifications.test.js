import { describe, expect, it } from "vitest";
import { buildCatalogSnapshot, detectCatalogNotifications } from "./notifications";

const contest = (overrides = {}) => ({
  id: 10,
  cargo: "Analista",
  orgao: "Órgão público",
  status: "Inscrições abertas",
  vagas: 20,
  nivel: "Superior",
  estado: "Alagoas",
  localidade: "Maceió",
  atoOficial: "Edital 01/2026",
  sourceUrl: "https://example.gov.br/concurso",
  ...overrides
});

describe("Notificações do catálogo", () => {
  it("cria uma linha de base na primeira visita sem gerar alertas falsos", () => {
    const result = detectCatalogNotifications({ catalog: [contest()] });
    expect(result.initialized).toBe(true);
    expect(result.notifications).toEqual([]);
    expect(result.snapshot).toEqual(buildCatalogSnapshot([contest()]));
  });

  it("detecta um novo concurso após uma atualização do catálogo", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const added = contest({ id: 11, cargo: "Técnico" });
    const result = detectCatalogNotifications({
      catalog: [contest(), added],
      previousSnapshot
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toEqual(expect.objectContaining({
      type: "new",
      itemId: "11",
      title: "Novo concurso no catálogo",
      read: false
    }));
  });

  it("avisa quando a situação ou o número de vagas de um favorito muda", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const updated = contest({ status: "Resultado publicado", vagas: 25 });
    const result = detectCatalogNotifications({
      catalog: [updated],
      previousSnapshot,
      favoriteIds: [10]
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe("favorite-update");
    expect(result.notifications[0].message).toContain("Resultado publicado");
    expect(result.notifications[0].message).toContain("20 → 25");
  });

  it("não avisa sobre mudanças em concursos que não são favoritos", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const result = detectCatalogNotifications({
      catalog: [contest({ status: "Resultado publicado" })],
      previousSnapshot,
      favoriteIds: []
    });

    expect(result.notifications).toEqual([]);
  });

  it("ignora a inclusão de referências preliminares sem confirmação", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const preliminary = contest({
      id: 12,
      status: "Concurso listado · verificar edital e cronograma"
    });
    const result = detectCatalogNotifications({
      catalog: [contest(), preliminary],
      previousSnapshot
    });

    expect(result.notifications).toEqual([]);
  });
});
