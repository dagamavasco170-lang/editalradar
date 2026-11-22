import {
  canScheduleBeforePushExpiry,
  currentPushDeliveryAttempt,
  getWorkerRetryDelaySeconds,
  hasPushRetryBudget,
  remainingPushTtlSeconds,
  resolvePushExpiryMs,
} from "./policy.js";

function parseJob(message, enqueuedAt) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const value = message;
  const token = String(value.token || "").trim();
  const title = String(value.title || "").trim().slice(0, 90);
  const body = String(value.body || "").trim().slice(0, 350);
  const url = String(value.url || "/").trim().slice(0, 512);
  const hasExplicitExpiry = Object.prototype.hasOwnProperty.call(value, "expires_at");
  const expiresAtMs = resolvePushExpiryMs(hasExplicitExpiry ? value.expires_at : undefined, enqueuedAt);
  if (
    token.length < 32 || token.length > 4096 || !title || !body
    || !url.startsWith("/") || url.startsWith("//") || expiresAtMs === null
  ) return null;
  return {
    token,
    notification: { title, body, url },
    attempt: Math.max(1, Number(value.attempt) || 1),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

async function archiveMessage(adminDb, msgId) {
  const { data, error } = await adminDb.rpc("ack_push_delivery_retry", { p_msg_id: msgId });
  if (error || data !== true) throw new Error("Não foi possível confirmar a mensagem da fila.");
}

/**
 * Process one PGMQ delivery using an injected FCM sender.
 * This keeps retry decisions integration-testable without network calls or
 * production Firebase credentials.
 */
export async function processPushDeliveryJob({
  adminDb,
  job,
  accessToken,
  projectId,
  sendMessage,
  now = Date.now,
  random = Math.random,
  maxTotalAttempts = 7,
}) {
  if (!adminDb || typeof adminDb.rpc !== "function") {
    throw new Error("A conexão administrativa do worker é inválida.");
  }
  if (typeof sendMessage !== "function") {
    throw new Error("O envio FCM do worker não foi configurado.");
  }

  const parsed = parseJob(job?.message, job?.enqueued_at);
  if (!parsed) {
    await archiveMessage(adminDb, job?.msg_id);
    return { outcome: "invalid_message" };
  }

  const ttlSeconds = remainingPushTtlSeconds(parsed.expiresAt, now());
  if (ttlSeconds <= 0) {
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "expired" };
  }

  const currentAttempt = currentPushDeliveryAttempt(parsed.attempt, Number(job.read_ct));
  const result = await sendMessage(
    parsed.token,
    parsed.notification,
    projectId,
    accessToken,
    ttlSeconds,
  );

  if (result.ok) {
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "sent" };
  }

  if (result.permanentTokenError) {
    const { error } = await adminDb.from("push_devices")
      .update({ enabled: false, updated_at: new Date(now()).toISOString() })
      .eq("token", parsed.token);
    if (error) throw new Error("O token inválido foi identificado, mas não foi possível desativá-lo.");
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "disabled_invalid" };
  }

  if (remainingPushTtlSeconds(parsed.expiresAt, now()) <= 0) {
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "expired" };
  }

  if (result.retryable && hasPushRetryBudget(currentAttempt, maxTotalAttempts)) {
    const delaySeconds = getWorkerRetryDelaySeconds(result, currentAttempt, now(), random);
    if (!canScheduleBeforePushExpiry(parsed.expiresAt, delaySeconds, now())) {
      await archiveMessage(adminDb, job.msg_id);
      return { outcome: "expired_before_retry" };
    }
    const { error } = await adminDb.rpc("reschedule_push_delivery_retry", {
      p_old_msg_id: job.msg_id,
      p_message: {
        token: parsed.token,
        ...parsed.notification,
        attempt: currentAttempt,
        last_error_code: result.code,
        retry_after: result.retryAfter || null,
        expires_at: parsed.expiresAt,
      },
      p_delay_seconds: delaySeconds,
    });
    if (error) throw new Error("Não foi possível reagendar a retentativa persistente.");
    return { outcome: "rescheduled", error_code: result.code, attempts: currentAttempt };
  }

  const { error } = await adminDb.rpc("fail_push_delivery_retry", {
    p_msg_id: job.msg_id,
    p_token: parsed.token,
    p_error_code: result.code,
    p_attempt_count: currentAttempt,
  });
  if (error) throw new Error("Não foi possível registrar a falha definitiva da notificação.");
  return { outcome: "dead_letter", error_code: result.code, attempts: currentAttempt };
}
