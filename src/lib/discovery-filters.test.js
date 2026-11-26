import { describe, expect, it } from "vitest";
import {
  classifyDiscoveryKind,
  classifyDiscoveryPriority,
  classifyDiscoveryTopic,
  countDiscoveriesByStatus,
  discoveryKindLabel,
  discoveryPriorityLabel,
  discoveryStatusLabel,
  discoveryTopicLabel,
  filterDiscoveries,
  scoreDiscoveryPriority,
  sortDiscoveriesByPriority
} from "./discovery-filters.js";

const rows = [
  { id: 1, status: "pending", discovery_type: "new_link", title: "Edital 01/2026 — concurso público, 20 vagas", candidate_url: "https://banca.org.br/concursos/edital-01-2026.pdf", context: "Cargo e inscrições", detected_at: "2026-11-22T10:00:00.000Z" },
  { id: 2, status: "published", discovery_type: "new_link", title: "Retificação do edital 02/2026", context: "Errata publicada", detected_at: "2026-11-20T10:00:00.000Z" },
  { id: 3, status: "dismissed", discovery_type: "web_search_lead", title: "[Edital] Busca na internet: Prefeitura anuncia concurso", context: "Pista secundária", detected_at: "2026-11-21T10:00:00.000Z" },
  { id: 4, status: "pending", discovery_type: "new_link", title: "Resultado final homologado", context: "Convocação", detected_at: "2026-10-01T10:00:00.000Z" },
  { id: 5, status: "pending", discovery_type: "new_link", title: "Comissão formada para novo concurso", context: "Pré-edital", detected_at: "2026-11-22T11:00:00.000Z" },
  { id: 6, status: "pending", discovery_type: "web_search_lead", title: "[Notícia] Concurso público com edital e vagas", context: "Pista externa", detected_at: "2026-11-22T11:30:00.000Z" }
];

describe("filtros e prioridade da fila de descobertas", () => {
  it("separa origem oficial ou secundária do assunto da publicação", () => {
    expect(classifyDiscoveryKind(rows[2])).toBe("secondary");
    expect(classifyDiscoveryKind(rows[1])).toBe("official");
    expect(classifyDiscoveryTopic(rows[1])).toBe("retification");
    expect(classifyDiscoveryTopic(rows[3])).toBe("result");
    expect(classifyDiscoveryTopic(rows[4])).toBe("pre_notice");
    expect(discoveryKindLabel("secondary")).toBe("Pista externa");
    expect(discoveryTopicLabel("retification")).toBe("Retificação / errata");
    expect(discoveryStatusLabel("published")).toBe("Publicada");
  });

  it("dá prioridade alta a edital oficial específico e limita notícia externa à faixa média", () => {
    expect(classifyDiscoveryPriority(rows[0], Date.parse("2026-11-22T12:00:00.000Z"))).toBe("high");
    expect(classifyDiscoveryPriority(rows[5], Date.parse("2026-11-22T12:00:00.000Z"))).toBe("medium");
    expect(scoreDiscoveryPriority(rows[5], Date.parse("2026-11-22T12:00:00.000Z"))).toBe(39);
    expect(discoveryPriorityLabel("high")).toBe("Alta prioridade");
    expect(scoreDiscoveryPriority(rows[0], Date.parse("2026-11-22T12:00:00.000Z")))
      .toBeGreaterThan(scoreDiscoveryPriority(rows[5], Date.parse("2026-11-22T12:00:00.000Z")));
  });

  it("ordena pendências por evidência e usa a idade como desempate progressivo", () => {
    const now = Date.parse("2026-11-22T12:00:00.000Z");
    const sorted = sortDiscoveriesByPriority(rows, now);
    expect(sorted.map(item => item.id).slice(0, 3)).toEqual([1, 4, 5]);
    expect(sorted.findIndex(item => item.id === 6)).toBeGreaterThan(sorted.findIndex(item => item.id === 1));
  });

  it("filtra por origem, assunto, prioridade, situação e texto ignorando acentos e caixa", () => {
    expect(filterDiscoveries(rows, { status: "pending", kind: "official", query: "edital 01" }).map(item => item.id)).toEqual([1]);
    expect(filterDiscoveries(rows, { status: "all", kind: "official", topic: "retification", query: "RETIFICACAO" }).map(item => item.id)).toEqual([2]);
    expect(filterDiscoveries(rows, { status: "all", kind: "secondary" }).map(item => item.id)).toEqual([3, 6]);
    expect(filterDiscoveries(rows, { status: "pending", priority: "high" }, Date.parse("2026-11-22T12:00:00.000Z")).map(item => item.id)).toContain(1);
  });

  it("aplica janela de tempo e mantém itens sem filtro temporal", () => {
    const now = Date.parse("2026-11-22T12:00:00.000Z");
    expect(filterDiscoveries(rows, { status: "all", period: "24h" }, now).map(item => item.id)).toEqual([1, 5, 6]);
    expect(filterDiscoveries(rows, { status: "all", period: "all" }, now)).toHaveLength(6);
  });

  it("conta pendentes, publicadas e descartadas", () => {
    expect(countDiscoveriesByStatus(rows)).toEqual({ pending: 4, published: 1, dismissed: 1, total: 6 });
    expect(countDiscoveriesByStatus(null)).toEqual({ pending: 0, published: 0, dismissed: 0, total: 0 });
  });
});
