import { supabase } from "./supabaseClient.js";
import { isAndroidApp } from "./android-bridge.js";

const DIAGNOSTICS_FUNCTION = "diagnostics-ingest";
const CLIENT_ID_KEY = "editalradar-diagnostics-client";
const MAX_QUEUE = 30;
const BATCH_SIZE = 5;
const FLUSH_INTERVAL_MS = 25_000;

let initialized = false;
let sending = false;
let flushTimer;
const queue = [];

function getClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{16,64}$/.test(existing)) return existing;
    const id = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function safeText(value, limit = 1000) {
  let text;
  if (value instanceof Error) text = value.message || value.name;
  else {
    try {
      text = typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(token|password|secret|apikey|api_key|authorization|private_key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const url = new URL(value);
        return url.origin;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[jwt]")
    .replace(/\b(?:[A-Fa-f0-9_-]{32,})\b/g, "[token]")
    .slice(0, limit);
}
export function sanitizePagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "";
  return value.split("/").map((segment) => {
    if (!segment) return "";
    if (/^[0-9]+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[A-Za-z0-9_-]{24,}$/.test(segment)) return ":id";
    return segment.slice(0, 80);
  }).join("/").slice(0, 180);
}

export function createDiagnosticEntry({ level = "error", event = "client_error", message = "", stack = "" } = {}) {
  const isNative = isAndroidApp();
  return {
    level: ["error", "warn", "info"].includes(level) ? level : "error",
    event: safeText(event, 80).slice(0, 80),
    message: safeText(message, 1000).slice(0, 1000),
    stack: safeText(stack, 1600).slice(0, 1600),
    platform: isNative ? "android" : "web",
    app_version: isNative ? "android-webview" : "web",
    app_commit: typeof __EDITALRADAR_COMMIT__ !== "undefined" ? __EDITALRADAR_COMMIT__ : "",
    page: typeof location !== "undefined" ? sanitizePagePath(location.pathname) : "",
  };
}

export function sanitizeResourceTarget(value, baseUrl = typeof location !== "undefined" ? location.href : undefined) {
  if (typeof value !== "string" || !value.trim()) return "resource";
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    // Keep only the origin: resource paths, query strings and fragments can contain
    // identifiers or secrets. The tag name is logged separately for diagnosis.
    return url.origin;
  } catch {
    return "resource";
  }
}


function enqueue(entry) {
  if (!supabase || !entry.message) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(entry);
  if (queue.length >= BATCH_SIZE) void flush();
}

export async function flushDiagnostics() {
  if (sending || queue.length === 0 || !supabase) return false;
  sending = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    const { error } = await supabase.functions.invoke(DIAGNOSTICS_FUNCTION, {
      body: { client_id: getClientId(), logs: batch },
    });
    if (error) {
      // Retain a bounded batch for retry without recursively reporting telemetry failures.
      queue.unshift(...batch);
      if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
      return false;
    }
    return true;
  } catch {
    queue.unshift(...batch);
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    return false;
  } finally {
    sending = false;
  }
}

export function initializeDiagnostics() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event) => {
    const isResourceError = event.target && event.target !== window;
    const target = isResourceError
      ? sanitizeResourceTarget(event.target?.src || event.target?.href)
      : "";
    enqueue(createDiagnosticEntry({
      event: isResourceError ? "resource_load_error" : "uncaught_error",
      message: isResourceError ? `Resource failed to load: ${target} (${event.target?.tagName || "resource"})` : event.message || "Uncaught browser error",
      stack: event.error?.stack || "",
    }));
  }, true);

  window.addEventListener("editalradar-native-diagnostic", (event) => {
    const detail = event.detail || {};
    enqueue(createDiagnosticEntry({
      level: detail.level || "error",
      event: detail.event || "native_webview_diagnostic",
      message: detail.message || "Native diagnostic event",
    }));
  });

  window.addEventListener("unhandledrejection", (event) => {
    enqueue(createDiagnosticEntry({
      event: "unhandled_promise_rejection",
      message: safeText(event.reason, 1000),
      stack: event.reason instanceof Error ? event.reason.stack || "" : "",
    }));
  });

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    originalError(...args);
    enqueue(createDiagnosticEntry({
      event: "console_error",
      message: args.map(arg => safeText(arg, 500)).join(" ").slice(0, 1000),
      stack: args.find(arg => arg instanceof Error)?.stack || "",
    }));
  };

  flushTimer = window.setInterval(() => void flushDiagnostics(), FLUSH_INTERVAL_MS);
  window.addEventListener("online", () => void flushDiagnostics());
  window.addEventListener("pagehide", () => {
    // Best-effort flush; no beacon or raw payload is persisted locally.
    void flushDiagnostics();
  });
  void flushDiagnostics();
}

export function diagnosticsQueueSize() {
  return queue.length;
}
