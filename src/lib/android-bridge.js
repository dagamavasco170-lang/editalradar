const BRIDGE_NAME = "EditalRadarNative";

export function isAndroidApp() {
  if (typeof window === "undefined") return false;
  return typeof window[BRIDGE_NAME]?.postMessage === "function";
}

export function sendNativeMessage(action, payload = {}) {
  if (!isAndroidApp() || typeof action !== "string" || !action.trim()) return false;

  try {
    window[BRIDGE_NAME].postMessage(JSON.stringify({ ...payload, action }));
    return true;
  } catch {
    return false;
  }
}
