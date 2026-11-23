import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = url && serviceKey ? createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
}) : null;
const ALLOWED_ORIGINS = new Set([
  "https://dagamavasco170-lang.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://dagamavasco170-lang.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const scrub = (input: unknown, max: number) => String(input ?? "")
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
  .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
  .replace(/(token|password|secret|apikey|api_key|authorization|private_key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
  .replace(/https?:\/\/[^\s?#]+[^\s]*/gi, (value) => value.split("?")[0].split("#")[0])
  .replace(/\b(?:[A-Fa-f0-9_-]{32,})\b/g, "[token]")
  .slice(0, max);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (!admin) return json({ error: "Diagnostic service unavailable" }, 503, origin);
  const apiKey = req.headers.get("apikey") ?? "";
  const configuredKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
  const allowedKeys = new Set<string>([Deno.env.get("SUPABASE_ANON_KEY") ?? ""]);
  try {
    const parsedKeys = JSON.parse(configuredKeys);
    if (parsedKeys && typeof parsedKeys === "object") {
      for (const key of Object.values(parsedKeys)) if (typeof key === "string") allowedKeys.add(key);
    }
  } catch {
    for (const key of configuredKeys.split(/[;,\\s]+/)) if (key) allowedKeys.add(key);
  }
  if (!apiKey || !allowedKeys.has(apiKey)) return json({ error: "Invalid API key" }, 401, origin);
  if (Number(req.headers.get("content-length") || 0) > 12_000) return json({ error: "Payload too large" }, 413, origin);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
  if (!payload || typeof payload.client_id !== "string" || !/^[a-zA-Z0-9_-]{16,64}$/.test(payload.client_id) ||
      !Array.isArray(payload.logs) || payload.logs.length < 1 || payload.logs.length > 5) {
    return json({ error: "Invalid diagnostic payload" }, 400, origin);
  }
  const clientId = payload.client_id;
  const { count, error: countError } = await admin.from("app_diagnostics")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString());
  if (countError) return json({ error: "Diagnostic storage unavailable" }, 503, origin);
  if ((count ?? 0) >= 40) return json({ error: "Rate limit reached" }, 429, origin);
  const { count: globalCount, error: globalCountError } = await admin.from("app_diagnostics")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if (globalCountError) return json({ error: "Diagnostic storage unavailable" }, 503, origin);
  if ((globalCount ?? 0) >= 500) return json({ error: "Service rate limit reached" }, 429, origin);

  const rows = payload.logs.map((item: any) => ({
    client_id: clientId,
    platform: item?.platform === "android" ? "android" : "web",
    level: ["error", "warn", "info"].includes(item?.level) ? item.level : "error",
    event: scrub(item?.event || "client_event", 80) || "client_event",
    message: scrub(item?.message || "No message", 1000) || "No message",
    stack: scrub(item?.stack, 1600),
    app_version: scrub(item?.app_version, 32),
    app_commit: scrub(item?.app_commit, 40),
    page: scrub(item?.page, 180),
    user_agent: scrub(req.headers.get("user-agent"), 240),
  }));
  const { error } = await admin.from("app_diagnostics").insert(rows);
  if (error) {
    console.error("[diagnostics-ingest] insert failed", error.message);
    return json({ error: "Could not save diagnostics" }, 503, origin);
  }
  return json({ accepted: rows.length }, 202, origin);
});
