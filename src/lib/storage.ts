export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function safeGetItem(key: string, storage?: StorageLike | null): string | null {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.getItem !== "function") return null;
    return target.getItem(String(key));
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: unknown, storage?: StorageLike | null): boolean {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.setItem !== "function") return false;
    target.setItem(String(key), String(value));
    return true;
  } catch {
    // Local persistence is best-effort; blocked or full storage must not crash the app.
    return false;
  }
}
