import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PayloadTooLargeError, readBoundedJsonBody } from "./request-limit.js";
import {
  canScheduleFcmRetryBeforeExpiry,
  classifyFcmFailure,
  getFcmRetryDelayMs,
} from "./policy.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const serviceAccountValue = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";
const encoder = new TextEncoder();
const PUSH_TTL_SECONDS = 3600;

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
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
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

async function authenticate(req: Request) {
  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw new Error("Configuração do Supabase incompleta na Edge Function.");
  }
  const authorization = req.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) throw new Error("Sessão não informada.");
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sessão inválida ou expirada.");
  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return { user: data.user, adminDb };
}

type FcmFailure = ReturnType<typeof classifyFcmFailure> & { retryAfter?: string | null };
type FcmSendResult = { ok: true } | ({ ok: false } & FcmFailure);

async function sendFcmMessage(
  token: string,
  message: { title: string; body: string; url: string },
  projectId: string,
  accessToken: string,
): Promise<FcmSendResult> {
  try {
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/messages:send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            data: message,
            android: { priority: "HIGH", ttl: `${PUSH_TTL_SECONDS}s` },
          },
        }),
      },
    );
    if (response.ok) return { ok: true };
    const payload = await response.json().catch(() => ({}));
    return {
      ok: false,
      ...classifyFcmFailure(response.status, payload),
      retryAfter: response.headers.get("Retry-After"),
    };
  } catch {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      permanentTokenError: false,
      retryable: true,
      quotaLimited: false,
      retryAfter: null,
    };
  }
}

async function disableInvalidTokens(adminDb: any, tokens: string[]): Promise<number> {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) return 0;
  const { error } = await adminDb.from("push_devices")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .in("token", uniqueTokens);
  if (error) {
    console.error("[push-notifications] Não foi possível desativar tokens inválidos:", error.message);
    return 0;
  }
  console.info("[push-notifications] Tokens FCM inválidos desativados:", uniqueTokens.length);
  return uniqueTokens.length;
}

async function queueRetries(
  adminDb: any,
  jobs: Array<{ token: string; failure: FcmFailure }>,
  notification: { title: string; body: string; url: string },
  expiresAt: string,
) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!jobs.length) return { queued: 0, failed: 0, expired: 0 };
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { queued: 0, failed: 0, expired: jobs.length };
  }

  const batches = new Map<number, Array<Record<string, unknown>>>();
  let expired = 0;
  for (const job of jobs) {
    const delayMs = getFcmRetryDelayMs(job.failure, 1);
    if (!canScheduleFcmRetryBeforeExpiry(expiresAt, delayMs)) {
      expired += 1;
      continue;
    }
    const delaySeconds = Math.ceil(delayMs / 1000);
    const batch = batches.get(delaySeconds) || [];
    batch.push({
      token: job.token,
      ...notification,
      attempt: 1,
      last_error_code: job.failure.code,
      retry_after: job.failure.retryAfter || null,
      expires_at: expiresAt,
    });
    batches.set(delaySeconds, batch);
  }

  let queued = 0;
  for (const [delaySeconds, messages] of batches) {
    for (let offset = 0; offset < messages.length; offset += 500) {
      const chunk = messages.slice(offset, offset + 500);
      const { data, error } = await adminDb.rpc("enqueue_push_deliveries", {
        p_messages: chunk,
        p_delay_seconds: delaySeconds,
      });
      if (error || Number(data) !== chunk.length) {
        console.error("[push-notifications] Não foi possível persistir um lote de retentativas:", error?.message || "contagem divergente");
        continue;
      }
      queued += chunk.length;
    }
  }
  return { queued, failed: jobs.length - queued - expired, expired };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "Payload muito grande." }, 413);
    return json({ error: "JSON inválido." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  let context: Awaited<ReturnType<typeof authenticate>>;
  try {
    context = await authenticate(req);
  } catch (error) {
    return json({ error: String(error?.message || error) }, 401);
  }

  const { user, adminDb } = context;
  const action = String(body.action || "");

  if (action === "register_device") {
    const token = String(body.token || "").trim();
    if (token.length < 32 || token.length > 4096) {
      return json({ error: "Token FCM inválido." }, 400);
    }
    const { error } = await adminDb.from("push_devices").upsert({
      token,
      user_id: user.id,
      platform: "android",
      enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "token" });
    if (error) return json({ error: "Não foi possível registrar o dispositivo." }, 500);
    return json({ ok: true, registered: true, enabled: true });
  }

  if (action === "unregister_device") {
    const token = String(body.token || "").trim();
    if (token.length < 32 || token.length > 4096) return json({ ok: true, removed: false });
    const { error } = await adminDb.from("push_devices")
      .delete().eq("token", token).eq("user_id", user.id);
    if (error) return json({ error: "Não foi possível desvincular o dispositivo." }, 500);
    return json({ ok: true, removed: true });
  }

  const isBackgroundTest = action === "test_self_background";
  const isSelfTest = action === "test_self" || isBackgroundTest;
  if (action !== "broadcast" && !isSelfTest) {
    return json({ error: "Ação não reconhecida." }, 400);
  }
  if (action === "broadcast" && user.app_metadata?.role !== "admin") {
    return json({ error: "Apenas administradores podem enviar avisos gerais." }, 403);
  }
  if (!serviceAccountValue) {
    return json({ error: "FCM ainda não foi configurado. Cadastre o secret FCM_SERVICE_ACCOUNT_JSON no Supabase." }, 503);
  }

  const title = isSelfTest
    ? "Teste de notificações do EditalRadar"
    : String(body.title || "").trim().slice(0, 90);
  const messageBody = isBackgroundTest
    ? "Este aviso foi entregue com o EditalRadar em segundo plano."
    : isSelfTest
      ? "Seu aparelho está recebendo avisos push."
      : String(body.body || "").trim().slice(0, 350);
  const destination = isSelfTest ? "/" : String(body.url || "/").trim().slice(0, 512);
  if (!title || !messageBody) return json({ error: "Título e mensagem são obrigatórios." }, 400);
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return json({ error: "O destino do aviso deve ser um caminho interno do aplicativo." }, 400);
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(serviceAccountValue);
  } catch {
    return json({ error: "O secret FCM_SERVICE_ACCOUNT_JSON não contém JSON válido." }, 503);
  }

  try {
    const accessToken = await createGoogleAccessToken(serviceAccount);
    let devicesQuery = adminDb
      .from("push_devices")
      .select("token")
      .eq("enabled", true);
    if (isSelfTest) devicesQuery = devicesQuery.eq("user_id", user.id);
    const { data: devices, error: devicesError } = await devicesQuery.limit(1000);
    if (devicesError) throw new Error("Não foi possível carregar os dispositivos registrados.");
    const tokens = (devices || []).map((row: { token: string }) => row.token).filter(Boolean);
    if (!tokens.length) {
      return isSelfTest
        ? json({ ok: false, error: "Nenhum aparelho está registrado nesta conta. Ative as notificações no Android e tente novamente." })
        : json({ ok: true, total: 0, sent: 0, failed: 0 });
    }

    // Gives the user time to leave the app and lock the screen before delivery.
    if (isBackgroundTest) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }

    const notification = { title, body: messageBody, url: destination };
    let sent = 0;
    let failed = 0;
    let disabledInvalid = 0;
    let retryScheduled = 0;
    let retryEnqueueFailed = 0;
    const invalidTokens: string[] = [];
    const retryJobs: Array<{ token: string; failure: FcmFailure }> = [];
    const failureCodes = new Map<string, number>();
    const deliveryExpiresAt = new Date(Date.now() + PUSH_TTL_SECONDS * 1000).toISOString();

    for (let offset = 0; offset < tokens.length; offset += 20) {
      const batch = tokens.slice(offset, offset + 20);
      const results = await Promise.all(batch.map(async (token) => ({
        token,
        result: await sendFcmMessage(token, notification, serviceAccount.project_id, accessToken),
      })));
      for (const item of results) {
        if (item.result.ok) {
          sent += 1;
          continue;
        }
        failed += 1;
        const failure = item.result;
        failureCodes.set(failure.code, (failureCodes.get(failure.code) || 0) + 1);
        if (failure.permanentTokenError) invalidTokens.push(item.token);
        else if (failure.retryable) retryJobs.push({ token: item.token, failure });
      }
    }

    disabledInvalid = await disableInvalidTokens(adminDb, invalidTokens);
    const queuedRetries = await queueRetries(adminDb, retryJobs, notification, deliveryExpiresAt);
    retryScheduled = queuedRetries.queued;
    retryEnqueueFailed = queuedRetries.failed;
    const retryExpired = queuedRetries.expired;

    const errorCodes = [...failureCodes.entries()]
      .slice(0, 4)
      .map(([code, count]) => ({ code, count }));
    if (isSelfTest && sent === 0) {
      return json({
        ok: false,
        error: retryScheduled
          ? "O Firebase apresentou uma falha temporária. A retentativa foi salva na fila e será processada automaticamente."
          : "O Firebase recusou o envio do teste. Verifique a credencial da conta de serviço e o projeto Firebase.",
        total: tokens.length,
        sent,
        failed,
        error_codes: errorCodes,
        disabled_invalid: disabledInvalid,
        retry_scheduled: retryScheduled,
        retry_enqueue_failed: retryEnqueueFailed,
        retry_expired: retryExpired,
      });
    }
    return json({
      ok: true,
      total: tokens.length,
      sent,
      failed,
      ...(isSelfTest ? { error_codes: errorCodes } : {}),
      disabled_invalid: disabledInvalid,
      retry_scheduled: retryScheduled,
      retry_enqueue_failed: retryEnqueueFailed,
      retry_expired: retryExpired,
    });
  } catch (error) {
    return json({ error: String(error?.message || error).slice(0, 300) }, 502);
  }
});
