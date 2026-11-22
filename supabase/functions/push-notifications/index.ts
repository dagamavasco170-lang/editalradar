import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  canRetryFcmFailure,
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
const MAX_BACKGROUND_RETRIES = 50;
const MAX_RETRY_WAIT_MS = 110_000;

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
            android: { priority: "HIGH", ttl: "3600s" },
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryOneDelivery(
  token: string,
  firstFailure: FcmFailure,
  message: { title: string; body: string; url: string },
  projectId: string,
  accessToken: string,
  adminDb: any,
) {
  let failure = firstFailure;
  let retriesMade = 0;
  while (canRetryFcmFailure(failure, retriesMade)) {
    const retryNumber = retriesMade + 1;
    const delayMs = getFcmRetryDelayMs(failure, retryNumber);
    // Do not keep an Edge Function worker alive beyond a safe runtime window.
    if (delayMs > MAX_RETRY_WAIT_MS) {
      return { outcome: "deferred", code: failure.code };
    }
    await wait(delayMs);
    retriesMade += 1;
    const result = await sendFcmMessage(token, message, projectId, accessToken);
    if (result.ok) return { outcome: "sent" };
    failure = result;
    if (failure.permanentTokenError) {
      const disabled = await disableInvalidTokens(adminDb, [token]);
      return { outcome: disabled ? "disabled" : "disable_failed", code: failure.code };
    }
  }
  return { outcome: "failed", code: failure.code };
}

async function retryTransientDeliveries(
  jobs: Array<{ token: string; failure: FcmFailure }>,
  message: { title: string; body: string; url: string },
  projectId: string,
  accessToken: string,
  adminDb: any,
) {
  const retryJobs = jobs.slice(0, MAX_BACKGROUND_RETRIES);
  const results = await Promise.all(retryJobs.map((job) =>
    retryOneDelivery(job.token, job.failure, message, projectId, accessToken, adminDb)
  ));
  const summary = results.reduce((counts: Record<string, number>, result) => {
    counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    return counts;
  }, {});
  console.info("[push-notifications] Retentativas FCM concluídas:", summary);
  if (jobs.length > retryJobs.length) {
    console.warn("[push-notifications] Limite de retentativas em segundo plano atingido:", {
      scheduled: retryJobs.length,
      skipped: jobs.length - retryJobs.length,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
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
      await wait(15_000);
    }

    const notification = { title, body: messageBody, url: destination };
    let sent = 0;
    let failed = 0;
    let disabledInvalid = 0;
    const invalidTokens: string[] = [];
    const retryJobs: Array<{ token: string; failure: FcmFailure }> = [];
    const failureCodes = new Map<string, number>();

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
    let retryScheduled = 0;
    let retrySkipped = 0;
    if (retryJobs.length) {
      const scheduledJobs = retryJobs.slice(0, MAX_BACKGROUND_RETRIES);
      retryScheduled = scheduledJobs.length;
      retrySkipped = retryJobs.length - scheduledJobs.length;
      // Retrying in the background keeps the API response quick and respects
      // FCM Retry-After / exponential backoff without blocking the user.
      EdgeRuntime.waitUntil(
        retryTransientDeliveries(scheduledJobs, notification, serviceAccount.project_id, accessToken, adminDb)
          .catch((error) => console.error("[push-notifications] Falha na rotina de retentativa:", error?.message || error)),
      );
    }

    const errorCodes = [...failureCodes.entries()]
      .slice(0, 4)
      .map(([code, count]) => ({ code, count }));
    if (isSelfTest && sent === 0) {
      return json({
        ok: false,
        error: retryScheduled
          ? "O Firebase apresentou uma falha temporária. Uma nova tentativa automática foi programada."
          : "O Firebase recusou o envio do teste. Verifique a credencial da conta de serviço e o projeto Firebase.",
        total: tokens.length,
        sent,
        failed,
        error_codes: errorCodes,
        disabled_invalid: disabledInvalid,
        retry_scheduled: retryScheduled,
        retry_skipped: retrySkipped,
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
      retry_skipped: retrySkipped,
    });
  } catch (error) {
    return json({ error: String(error?.message || error).slice(0, 300) }, 502);
  }
});
