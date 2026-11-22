import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyWorkerFcmFailure } from "./policy.js";
import { processPushDeliveryJob } from "./delivery.js";
import { persistPushWorkerRun, summarizePushWorkerOutcomes } from "./observability.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const serviceAccountValue = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";
const encoder = new TextEncoder();
const MAX_MESSAGES_PER_RUN = 20;
const VISIBILITY_SECONDS = 180;

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

async function sendFcmMessage(
  token: string,
  message: { title: string; body: string; url: string },
  projectId: string,
  accessToken: string,
  ttlSeconds = 3600,
) {
  try {
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/messages:send",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            data: message,
            android: {
              priority: "HIGH",
              ttl: `${Math.max(1, Math.min(3600, Math.trunc(ttlSeconds) || 1))}s`,
            },
          },
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

  const runStartedAt = Date.now();
  try {
    const { data: jobs, error: readError } = await adminDb.rpc("read_push_delivery_retries", {
      p_qty: MAX_MESSAGES_PER_RUN,
      p_visibility_seconds: VISIBILITY_SECONDS,
    });
    if (readError) throw new Error("Não foi possível ler a fila persistente.");
    if (!Array.isArray(jobs) || jobs.length === 0) {
      const summary = { processed: 0, ...summarizePushWorkerOutcomes([]) };
      await persistPushWorkerRun(adminDb, summary, Date.now() - runStartedAt, (message) => console.error(message));
      return json({ ok: true, ...summary });
    }

    const accessToken = await createGoogleAccessToken(serviceAccount);
    const results = await Promise.all(jobs.map(async (job: any) => {
      try {
        return await processPushDeliveryJob({
          adminDb,
          job,
          accessToken,
          projectId: serviceAccount.project_id,
          sendMessage: sendFcmMessage,
        });
      } catch (error) {
        console.error("[push-queue-worker] Falha ao processar mensagem:", error?.message || error);
        // Leave this message unacknowledged. PGMQ makes it visible again when
        // the visibility timeout expires, so a crash cannot silently drop it.
        return { outcome: "pending_redelivery" };
      }
    }));

    const summary = {
      processed: jobs.length,
      ...summarizePushWorkerOutcomes(results),
    };
    await persistPushWorkerRun(adminDb, summary, Date.now() - runStartedAt, (message) => console.error(message));
    console.info("[push-queue-worker] Lote concluído:", summary);
    return json({ ok: true, ...summary });
  } catch (error) {
    console.error("[push-queue-worker] Falha geral:", error?.message || error);
    return json({ error: String(error?.message || error).slice(0, 250) }, 500);
  }
});
