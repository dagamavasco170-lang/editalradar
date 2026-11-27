export interface AdaptiveSessionHistoryEntry {
  id?: string;
  type?: string;
  topic?: string | null;
  discipline?: string | null;
  accuracy?: number | null;
  baselineAccuracy?: number | null;
  completion?: number | null;
  correct?: number | null;
  total?: number | null;
  completedAt?: string | null;
}

export interface AdaptiveTopicTrend {
  topic: string;
  discipline: string;
  sessions: number;
  latestAccuracy: number;
  previousAccuracy: number | null;
  delta: number | null;
  averageAccuracy: number;
  completionRate: number;
  direction: "improving" | "declining" | "stable" | "new";
  recommendation: string;
  lastCompletedAt: string | null;
}

const validScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

const timestamp = (value?: string | null): number => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Summarizes adaptive-session history by topic without mutating stored history. */
export function buildAdaptiveTopicTrends(
  history: Array<AdaptiveSessionHistoryEntry | null | undefined> = [],
  options: { minDelta?: number } = {}
): AdaptiveTopicTrend[] {
  const minDelta = Math.max(0, options.minDelta ?? 5);
  const grouped = new Map<string, AdaptiveSessionHistoryEntry[]>();

  for (const entry of history) {
    if (!entry || (entry.type && entry.type !== "adaptive")) continue;
    if (!validScore(entry.accuracy)) continue;
    const topic = String(entry.topic || "Assunto").trim() || "Assunto";
    const discipline = String(entry.discipline || "Disciplina").trim() || "Disciplina";
    const key = discipline + "::" + topic;
    const bucket = grouped.get(key) || [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()].map(([key, entries]) => {
    const [discipline, topic] = key.split("::");
    const sorted = entries.slice().sort((a, b) => timestamp(a.completedAt) - timestamp(b.completedAt));
    const latest = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const latestAccuracy = latest.accuracy as number;
    const previousAccuracy = validScore(previous?.accuracy) ? previous!.accuracy as number : null;
    const delta = previousAccuracy === null ? null : latestAccuracy - previousAccuracy;
    const averageAccuracy = Math.round(sorted.reduce((sum, item) => sum + (item.accuracy as number), 0) / sorted.length);
    const completionValues = sorted.map(item => item.completion).filter(validScore);
    const completionRate = completionValues.length
      ? Math.round(completionValues.reduce((sum, value) => sum + value, 0) / completionValues.length)
      : 0;
    const direction: AdaptiveTopicTrend["direction"] = delta === null ? "new"
      : delta >= minDelta ? "improving"
      : delta <= -minDelta ? "declining"
      : "stable";
    const recommendation = direction === "declining" || latestAccuracy < 60
      ? "Priorize revisão teórica e refaça as questões erradas."
      : direction === "improving" && latestAccuracy >= 80
        ? "Aumente gradualmente a dificuldade e mantenha revisão espaçada."
        : latestAccuracy >= 80
          ? "Mantenha revisões espaçadas para consolidar o domínio."
          : "Faça mais uma sessão focada e acompanhe a evolução.";
    return {
      topic,
      discipline,
      sessions: sorted.length,
      latestAccuracy,
      previousAccuracy,
      delta: delta === null ? null : Math.round(delta),
      averageAccuracy,
      completionRate,
      direction,
      recommendation,
      lastCompletedAt: latest.completedAt || null
    };
  }).sort((a, b) =>
    (a.direction === "declining" ? -1 : 0) - (b.direction === "declining" ? -1 : 0)
    || a.latestAccuracy - b.latestAccuracy
    || a.topic.localeCompare(b.topic, "pt-BR")
  );
}
