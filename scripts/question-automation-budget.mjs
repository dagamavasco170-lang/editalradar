// Shared query builder for the autonomous daily topic budget.
// No status filter is applied: failed attempts also consume a protected slot.
export function buildDailyAutomationRunQuery(utcStart, limit) {
  const params = new URLSearchParams({
    select: "id",
    started_at: `gte.${utcStart}`,
    trigger_mode: "eq.scheduled",
    limit: String(limit)
  });
  return params;
}

// Interleave overdue topics so one discipline cannot monopolize a daily batch.
// Recent attempts count regardless of outcome; this spreads coverage, not just successes.
export function orderTopicsFairly(topics = [], recentRuns = [], now = new Date()) {
  const topicById = new Map(topics.map((topic) => [String(topic.id), topic]));
  const historyByDiscipline = new Map();

  for (const run of recentRuns) {
    const topic = topicById.get(String(run.topic_id));
    if (!topic) continue;
    const discipline = String(topic.discipline || "Outras matérias").trim();
    const timestamp = Date.parse(run.started_at || "");
    const history = historyByDiscipline.get(discipline) || {
      attempts: 0,
      lastAttemptAt: Number.NEGATIVE_INFINITY
    };
    history.attempts += 1;
    if (Number.isFinite(timestamp)) history.lastAttemptAt = Math.max(history.lastAttemptAt, timestamp);
    historyByDiscipline.set(discipline, history);
  }

  const buckets = new Map();
  for (const topic of topics) {
    const discipline = String(topic.discipline || "Outras matérias").trim();
    if (!buckets.has(discipline)) buckets.set(discipline, []);
    buckets.get(discipline).push(topic);
  }

  const names = [...buckets.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const dayNumber = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const offset = names.length ? ((dayNumber % names.length) + names.length) % names.length : 0;

  const groups = names.map((discipline, index) => {
    const bucket = buckets.get(discipline);
    const history = historyByDiscipline.get(discipline);
    const topicLastRun = bucket.reduce((latest, topic) => {
      const value = Date.parse(topic.last_run_at || "");
      return Number.isFinite(value) ? Math.max(latest, value) : latest;
    }, Number.NEGATIVE_INFINITY);
    return {
      discipline,
      topics: bucket,
      attempts: history?.attempts || 0,
      lastActivity: Number.isFinite(history?.lastAttemptAt)
        ? history.lastAttemptAt
        : topicLastRun,
      rotationRank: (index - offset + names.length) % Math.max(1, names.length)
    };
  }).sort((a, b) =>
    a.attempts - b.attempts
    || a.lastActivity - b.lastActivity
    || a.rotationRank - b.rotationRank
    || a.discipline.localeCompare(b.discipline, "pt-BR")
  );

  const ordered = [];
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      if (!group.topics.length) continue;
      ordered.push(group.topics.shift());
      added = true;
    }
  }
  return ordered;
}
