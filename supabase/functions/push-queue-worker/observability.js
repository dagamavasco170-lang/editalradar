const OUTCOMES = [
  "sent",
  "rescheduled",
  "expired",
  "expired_before_retry",
  "disabled_invalid",
  "invalid_message",
  "dead_letter",
  "pending_redelivery",
];

function safeCount(value, max = 20) {
  const count = Math.trunc(Number(value) || 0);
  return Math.max(0, Math.min(max, count));
}

export function summarizePushWorkerOutcomes(results) {
  const summary = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
  for (const result of Array.isArray(results) ? results : []) {
    const outcome = String(result?.outcome || "");
    if (Object.prototype.hasOwnProperty.call(summary, outcome)) {
      summary[outcome] += 1;
    }
  }
  return summary;
}

/**
 * Persist only numeric, aggregate worker metrics.
 * Observability must never interrupt message delivery or queue acknowledgements.
 */
export async function persistPushWorkerRun(adminDb, counts, durationMs, onError = () => {}) {
  if (!adminDb || typeof adminDb.rpc !== "function") {
    onError("Push worker metrics client is unavailable.");
    return false;
  }

  const payload = {
    processed: safeCount(counts?.processed),
    sent: safeCount(counts?.sent),
    rescheduled: safeCount(counts?.rescheduled),
    expired: safeCount(counts?.expired),
    expired_before_retry: safeCount(counts?.expired_before_retry),
    disabled_invalid: safeCount(counts?.disabled_invalid),
    invalid_message: safeCount(counts?.invalid_message),
    dead_letter: safeCount(counts?.dead_letter),
    pending_redelivery: safeCount(counts?.pending_redelivery),
    duration_ms: safeCount(durationMs, 55_000),
  };

  try {
    const { error } = await adminDb.rpc("record_push_worker_run", { p_counts: payload });
    if (error) {
      onError("Push worker metrics could not be persisted.");
      return false;
    }
    return true;
  } catch {
    onError("Push worker metrics could not be persisted.");
    return false;
  }
}
