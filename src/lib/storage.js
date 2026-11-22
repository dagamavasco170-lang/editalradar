export function safeGetItem(key, storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return null;
    return storage.getItem(String(key));
  } catch {
    return null;
  }
}

export function safeSetItem(key, value, storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.setItem !== "function") return false;
    storage.setItem(String(key), String(value));
    return true;
  } catch {
    // Local persistence is best-effort. The app must remain usable when
    // storage is disabled, full, or blocked by browser privacy settings.
    return false;
  }
}
