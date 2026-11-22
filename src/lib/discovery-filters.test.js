import { describe, expect, it } from "vitest";
import {
  classifyDiscoveryKind,
  countDiscoveriesByStatus,
  filterDiscoveries,
  discoveryKindLabel,
  discoveryStatusLabel
} from "./discovery-filters.js";

const rows = [
  { id: 1, status: "pending", discovery_type: "new_link", title: "Edital 01/2026", context: "Fonte oficial", detected_at: "2026-11-22T10:00:00.000Z" },
  { id: 2, status: "published", discovery_type: "new_link", title: "Retificação do edital 02/2026", context: "Errata publicada", detected_at: "2026-11-20T10:00:00.000Z" },
  { id: 3, status: "dismissed", discovery_type: "web_search_lead", title: "[Edital] Busca na internet: Prefeitura anuncia concurso", context: "Pista secundária", detected_at: "2026-11-21T10:00:00.000Z" },
  { id: 4, status: "pending", discovery_type: "page_change", title: "Resultado final homologado", context: "Convocação", detected_at: "2026-10-01T10:00:00.000Z" },
  { id: 5, status: "pending", discovery_type: "new_link", title: "Comissão formada para novo concurso", context: "Pré-edital", detected_at: "2026-11-22T11:00:00.000Z" }
];

describe("filtros da fila de descobertas", () => {
  it("classifica origem externa, retificação, resultado e pré-edital", () => {
    expect(classifyDiscoveryKind(rows[2])).toBe("secondary");
    expect(classifyDiscoveryKind(rows[1])).toBe("retification");
    expect(classifyDiscoveryKind(rows[3])).toBe("result");
    expect(classifyDiscoveryKind(rows[4])).toBe("pre_notice");
    expect(discoveryKindLabel("secondary")).toBe("Pista externa");
    expect(discoveryStatusLabel("published")).toBe("Publicada");
  });

  it("filtra por status, tipo e texto ignorando acentos e caixa", () => {
    expect(filterDiscoveries(rows, { status: "pending", kind: "official", query: "edital" }).map(item => item.id)).toEqual([1]);
    expect(filterDiscoveries(rows, { status: "all", kind: "retification", query: "RETIFICACAO" }).map(item => item.id)).toEqual([2]);
    expect(filterDiscoveries(rows, { status: "all", kind: "secondary" }).map(item => item.id)).toEqual([3]);
  });

  it("aplica janela de tempo e mantém itens sem filtro temporal", () => {
    const now = Date.parse("2026-11-22T12:00:00.000Z");
    expect(filterDiscoveries(rows, { status: "all", period: "24h" }, now).map(item => item.id)).toEqual([1, 5]);
    expect(filterDiscoveries(rows, { status: "all", period: "all" }, now)).toHaveLength(5);
  });

  it("conta pendentes, publicadas e descartadas", () => {
    expect(countDiscoveriesByStatus(rows)).toEqual({ pending: 3, published: 1, dismissed: 1, total: 5 });
    expect(countDiscoveriesByStatus(null)).toEqual({ pending: 0, published: 0, dismissed: 0, total: 0 });
  });
});
