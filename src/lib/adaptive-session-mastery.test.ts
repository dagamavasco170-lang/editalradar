import { describe, expect, it } from "vitest";
import { buildAdaptiveTopicTrends } from "./adaptive-session-mastery.ts";

describe("buildAdaptiveTopicTrends", () => {
  it("groups adaptive history and computes score delta and average", () => {
    const trends = buildAdaptiveTopicTrends([
      { type: "adaptive", topic: "Crase", discipline: "Português", accuracy: 55, completion: 100, completedAt: "2026-11-01" },
      { type: "adaptive", topic: "Crase", discipline: "Português", accuracy: 80, completion: 90, completedAt: "2026-11-10" },
      { type: "manual", topic: "Crase", discipline: "Português", accuracy: 10, completedAt: "2026-11-11" }
    ]);
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ sessions: 2, latestAccuracy: 80, previousAccuracy: 55, delta: 25, averageAccuracy: 68, completionRate: 95, direction: "improving" });
  });

  it("marks new topics and excludes invalid scores and empty records", () => {
    const trends = buildAdaptiveTopicTrends([
      { topic: "Constitucional", discipline: "Direito", accuracy: 72, completedAt: "2026-11-20" },
      { topic: "Inválido", accuracy: 101 },
      null,
      { topic: "Sem pontuação" }
    ]);
    expect(trends).toHaveLength(1);
    expect(trends[0].direction).toBe("new");
    expect(trends[0].delta).toBeNull();
    expect(trends[0].recommendation).toContain("mais uma sessão");
  });

  it("flags declines and tolerates absent completion data", () => {
    const trends = buildAdaptiveTopicTrends([
      { topic: "Licitações", discipline: "Administrativo", accuracy: 85, completedAt: "2026-11-02" },
      { topic: "Licitações", discipline: "Administrativo", accuracy: 60, completedAt: "2026-11-12" }
    ]);
    expect(trends[0]).toMatchObject({ direction: "declining", delta: -25, completionRate: 0 });
    expect(trends[0].recommendation).toContain("revisão teórica");
  });

  it("uses stable status for small differences and configurable threshold", () => {
    const records = [
      { topic: "Poderes", accuracy: 70, completedAt: "2026-11-01" },
      { topic: "Poderes", accuracy: 73, completedAt: "2026-11-02" }
    ];
    expect(buildAdaptiveTopicTrends(records)[0].direction).toBe("stable");
    expect(buildAdaptiveTopicTrends(records, { minDelta: 2 })[0].direction).toBe("improving");
  });
});
