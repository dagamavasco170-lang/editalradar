import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyWorkerFcmFailure,
  getWorkerRetryDelaySeconds,
  currentPushDeliveryAttempt,
  hasPushRetryBudget,
} from "./policy.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const serviceAccountValue = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";
const encoder = new TextEncoder();
const MAX_MESSAGES_PER_RUN = 20;
const VISIBILITY_SECONDS = 180;
const MAX_TOTAL_ATTEMPTS = 7;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createGoogleAccessToken(account: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claims;
  const pem = String(account.private_key || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!pem || !account.client_email || !account.project_id) {
    throw new Error("A credencial FCM não contém project_id, client_email ou private_key.");
  }
  const der = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)),
  );
  const assertion = unsigned + "." + base64Url(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error("O Google não autorizou o envio FCM (HTTP " + response.status + ").");
  }
  return String(payload.access_token);
}

async function sendFcmMessage(token: string, message: { title: string; body: string; url: string }, projectId: string, accessToken: string) {
  try {
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/messages:send",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: { token, data: message, android: { priority: "HIGH", ttl: "3600s" } },
        }),
      },
    );
    if (response.ok) return { ok: true as const };
    const payload = await response.json().catch(() => ({}));
    return { ok: false as const, ...classifyWorkerFcmFailure(response.status, payload, response.headers.get("Retry-After")) };
  } catch {
    return {
      ok: false as const,
      code: "NETWORK_ERROR",
      permanentTokenError: false,
      quotaLimited: false,
      retryable: true,
      retryAfter: null,
    };
  }
}

function parseJob(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const value = message as Record<string, unknown>;
  const token = String(value.token || "").trim();
  const title = String(value.title || "").trim().slice(0, 90);
  const body = String(value.body || "").trim().slice(0, 350);
  const url = String(value.url || "/").trim().slice(0, 512);
  if (token.length < 32 || token.length > 4096 || !title || !body || !url.startsWith("/") || url.startsWith("//")) return null;
  return {
    token,
    notification: { title, body, url },
    attempt: Math.max(1, Number(value.attempt) || 1),
  };
}

async function archiveMessage(adminDb: any, msgId: number) {
  const { data, error } = await adminDb.rpc("ack_push_delivery_retry", { p_msg_id: msgId });
  if (error || data !== true) throw new Error("Não foi possível confirmar a mensagem da fila.");
}

async function processJob(adminDb: any, job: any, accessToken: string, projectId: string) {
  const parsed = parseJob(job.message);
  if (!parsed) {
    const { error } = await adminDb.rpc("ack_push_delivery_retry", { p_msg_id: job.msg_id });
    if (error) throw new Error("Não foi possível descartar uma mensagem inválida da fila.");
    return { outcome: "invalid_message" };
  }

  const currentAttempt = currentPushDeliveryAttempt(parsed.attempt, Number(job.read_ct));
  const result = await sendFcmMessage(parsed.token, parsed.notification, projectId, accessToken);
  if (result.ok) {
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "sent" };
  }

  if (result.permanentTokenError) {
    const { error } = await adminDb.from("push_devices")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("token", parsed.token);
    if (error) throw new Error("O token inválido foi identificado, mas não foi possível desativá-lo.");
    await archiveMessage(adminDb, job.msg_id);
    return { outcome: "disabled_invalid" };
  }

  if (result.retryable && hasPushRetryBudget(currentAttempt, MAX_TOTAL_ATTEMPTS)) {
    const delaySeconds = getWorkerRetryDelaySeconds(result, currentAttempt);
    const { error } = await adminDb.rpc("reschedule_push_delivery_retry", {
      p_old_msg_id: job.msg_id,
      p_message: {
        token: parsed.token,
        ...parsed.notification,
        attempt: currentAttempt,
        last_error_code: result.code,
        retry_after: result.retryAfter || null,
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!supabaseUrl || !serviceKey || !serviceAccountValue) {
    return json({ error: "Configuração interna do trabalhador incompleta." }, 503);
  }

  const workerToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (workerToken.length < 32) return json({ error: "Não autorizado." }, 401);

  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authorized, error: authError } = await adminDb.rpc("verify_push_queue_worker_token", {
    p_token: workerToken,
  });
  if (authError || authorized !== true) return json({ error: "Não autorizado." }, 401);

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(serviceAccountValue);
  } catch {
    return json({ error: "A credencial FCM não contém JSON válido." }, 503);
  }

  try {
    const { data: jobs, error: readError } = await adminDb.rpc("read_push_delivery_retries", {
      p_qty: MAX_MESSAGES_PER_RUN,
      p_visibility_seconds: VISIBILITY_SECONDS,
    });
    if (readError) throw new Error("Não foi possível ler a fila persistente.");
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return json({ ok: true, processed: 0, sent: 0, rescheduled: 0, dead_letter: 0 });
    }

    const accessToken = await createGoogleAccessToken(serviceAccount);
    const results = await Promise.all(jobs.map(async (job: any) => {
      try {
        return await processJob(adminDb, job, accessToken, serviceAccount.project_id);
      } catch (error) {
        console.error("[push-queue-worker] Falha ao processar mensagem:", error?.message || error);
        // Leave this message unacknowledged. PGMQ makes it visible again when
        // the visibility timeout expires, so a crash cannot silently drop it.
        return { outcome: "pending_redelivery" };
      }
    }));

    const counts = results.reduce((summary: Record<string, number>, item: any) => {
      summary[item.outcome] = (summary[item.outcome] || 0) + 1;
      return summary;
    }, {});
    console.info("[push-queue-worker] Lote concluído:", counts);
    return json({ ok: true, processed: jobs.length, ...counts });
  } catch (error) {
    console.error("[push-queue-worker] Falha geral:", error?.message || error);
    return json({ error: String(error?.message || error).slice(0, 250) }, 500);
  }
});
