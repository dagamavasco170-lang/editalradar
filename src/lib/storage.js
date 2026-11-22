export function safeGetItem(key, storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.getItem !== "function") return null;
    return target.getItem(String(key));
  } catch {
    return null;
  }
}

export function safeSetItem(key, value, storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.setItem !== "function") return false;
    target.setItem(String(key), String(value));
    return true;
  } catch {
    // Local persistence is best-effort. The app must remain usable when
    // storage is disabled, full, or blocked by browser privacy settings.
    return false;
  }
}
