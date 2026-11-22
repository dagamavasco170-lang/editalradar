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
