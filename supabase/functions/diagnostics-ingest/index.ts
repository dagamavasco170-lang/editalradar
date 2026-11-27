import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import ipaddr from "npm:ipaddr.js@2.2.0";
import { PayloadTooLargeError, readBoundedJsonBody } from "./payload-limit.js";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = url && serviceKey ? createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
}) : null;

async function hashClientIp(ip: string): Promise<string> {
  // HMAC prevents the database from storing raw IP addresses or easily reversible hashes.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serviceKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ipaddr.parse(ip).toString()),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  let payload: any;
  try {
    payload = await readBoundedJsonBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "Payload too large" }, 413, origin);
    return json({ error: "Invalid JSON" }, 400, origin);
  }
  if (!payload || typeof payload.client_id !== "string" || !/^[a-zA-Z0-9_-]{16,64}$/.test(payload.client_id) ||
      !Array.isArray(payload.logs) || payload.logs.length < 1 || payload.logs.length > 5 ||
      payload.logs.some((item: unknown) => !item || typeof item !== "object" || Array.isArray(item))) {
    return json({ error: "Invalid diagnostic payload" }, 400, origin);
  }
  const clientId = payload.client_id;
  // Only accept the Cloudflare ingress client-IP header. Never fall back to
  // X-Forwarded-For/X-Real-IP, which may contain caller-supplied values.
  const ingressIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!ingressIp || ingressIp.length > 64 || !ipaddr.isValid(ingressIp)) {
    console.error("[diagnostics-ingest] trusted ingress IP unavailable");
    return json({ error: "Diagnostic service unavailable" }, 503, origin);
  }
  const ipHash = await hashClientIp(ingressIp);
  const { data: withinIpRateLimit, error: ipRateLimitError } = await admin.rpc(
    "consume_diagnostics_ingest_ip_rate_limit",
    { p_ip_hash: ipHash, p_cost: payload.logs.length, p_limit: 40 },
  );
  if (ipRateLimitError) {
    console.error("[diagnostics-ingest] per-IP rate limiter unavailable", ipRateLimitError.message);
    return json({ error: "Diagnostic service unavailable" }, 503, origin);
  }
  if (withinIpRateLimit !== true) return json({ error: "Rate limit reached" }, 429, origin);

  // client_id is supplied by the caller and is only a diagnostic grouping key.
  // Enforce the service-wide budget atomically in Postgres instead of trusting it
  // as an identity or using a racy count-then-insert check.
  const { data: withinRateLimit, error: rateLimitError } = await admin.rpc(
    "consume_diagnostics_ingest_rate_limit",
    { p_cost: payload.logs.length, p_limit: 500 },
  );
  if (rateLimitError) {
    console.error("[diagnostics-ingest] rate limiter unavailable", rateLimitError.message);
    return json({ error: "Diagnostic service unavailable" }, 503, origin);
  }
  if (withinRateLimit !== true) return json({ error: "Service rate limit reached" }, 429, origin);

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
