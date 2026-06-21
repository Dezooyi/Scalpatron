import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLocalStorage — typed wrapper around localStorage with cross-instance
 * and cross-tab synchronization via the browser `storage` event.
 *
 * Behavior:
 * - Lazy initializer reads the current value (or `initialValue` on miss).
 * - `setValue` writes synchronously and dispatches a `storage` event so other
 *   hook instances in the same tab pick up the change (the native event only
 *   fires across tabs).
 * - Returns the current value and a stable setter.
 *
 * SSR-safe: guards all `window`/`localStorage` access.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const readValue = useCallback((): T => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return initialValue;
      return JSON.parse(stored) as T;
    } catch (e) {
      console.warn(`[useLocalStorage] Failed to read key "${key}":`, e);
      return initialValue;
    }
  }, [key, initialValue]);

  const [value, setValueState] = useState<T>(readValue);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (typeof window === "undefined") return;
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(valueRef.current)
          : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch (e) {
        console.warn(`[useLocalStorage] Failed to write key "${key}":`, e);
      }
      setValueState(resolved);
      // Notify other hook instances in this tab. The native `storage` event
      // only fires across tabs, so we dispatch a manual one here.
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: JSON.stringify(resolved) }),
      );
    },
    [key],
  );

  // Sync with other tabs and other instances of this hook.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (e.newValue === null) {
        setValueState(initialValue);
        valueRef.current = initialValue;
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue) as T;
        setValueState(parsed);
        valueRef.current = parsed;
      } catch {
        /* ignore malformed */
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key, initialValue]);

  return [value, setValue];
}