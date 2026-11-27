"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { prepareUploadImage } from "@/lib/prepare-upload-image";

export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new RequestError(data?.error ?? "Connection interrupted. Please try again.", response.status);
  return data as T;
}

export function action<T>(name: string, data: object = {}, signal?: AbortSignal) {
  return json<T>("/api/actions", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, ...data }),
  });
}

export async function upload<T>(...args: [kind: "garment" | "qr", form: FormData] |
  [kind: "receipt", form: FormData, access: { orderId: string; token: string }]) {
  const [kind, form, access] = args;
  const file = form.get("file");
  if (file instanceof File) {
    const prepared = await prepareUploadImage(file, kind);
    if (prepared !== file) form.set("file", prepared);
  }
  const headers = access ? { Authorization: `Bearer ${access.token}`, "X-LockDulu-Order": access.orderId } : undefined;
  return json<T>(`/api/upload?kind=${kind}`, { method: "POST", body: form, headers });
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function readLocal<T>(key: string, fallback: T, storage: "localStorage" | "sessionStorage" = "localStorage"): T {
  try { return JSON.parse(window[storage].getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}

export function writeLocal(key: string, value: unknown, storage: "localStorage" | "sessionStorage" = "localStorage") {
  try { window[storage].setItem(key, JSON.stringify(value)); } catch { /* In-app browsers may block storage. */ }
}

export function removeLocal(key: string, storage: "localStorage" | "sessionStorage" = "localStorage") {
  try { window[storage].removeItem(key); } catch { /* The browser may block storage. */ }
}

export type SavedLock = { itemId: string; token: string; orderId?: string; lockedUntil?: string; storeSlug: string; submitted?: boolean };
export const lockKey = "lockdulu.checkouts";
let knownLocks: SavedLock[] = [];
export function savedLocks() { return readLocal<SavedLock[]>(lockKey, knownLocks); }
export function saveLock(lock: SavedLock) {
  knownLocks = [lock, ...savedLocks().filter(candidate => candidate.token !== lock.token)].slice(0, 100);
  writeLocal(lockKey, knownLocks);
  window.dispatchEvent(new Event("lockdulu-lock"));
  return readLocal<SavedLock[]>(lockKey, []).some(candidate => candidate.token === lock.token && candidate.orderId === lock.orderId);
}
export function forgetLock(token: string) {
  knownLocks = savedLocks().filter(candidate => candidate.token !== token);
  writeLocal(lockKey, knownLocks);
  window.dispatchEvent(new Event("lockdulu-lock"));
}

export function useClock(serverTime: number) {
  const [now, setNow] = useState(serverTime);
  useEffect(() => {
    const offset = serverTime - Date.now();
    const tick = () => setNow(Date.now() + offset);
    tick();
    const interval = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [serverTime]);
  return now;
}

export function usePolling<T extends { serverTime: number }>(initial: T, get: (signal?: AbortSignal) => Promise<T>, interval = 4000) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<"current" | "stale" | "unavailable">("current");
  const refreshRequest = useRef<() => void>(null);
  const refresh = useCallback(() => refreshRequest.current?.(), []);
  useEffect(() => { setData(initial); }, [initial]);
  useEffect(() => {
    const aborter = new AbortController();
    let busy = false;
    const markStale = () => setStatus(current => current === "unavailable" ? current : "stale");
    const run = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const next = await get(aborter.signal);
        if (!aborter.signal.aborted) {
          setData(current => next.serverTime >= current.serverTime ? next : current);
          setStatus("current");
        }
      } catch (error) {
        if (!aborter.signal.aborted) {
          if (error instanceof RequestError && error.status === 404) setStatus("unavailable");
          else markStale();
        }
      }
      finally { busy = false; }
    };
    refreshRequest.current = run;
    const intervalId = window.setInterval(run, interval);
    if (!navigator.onLine) markStale();
    document.addEventListener("visibilitychange", run);
    window.addEventListener("online", run);
    window.addEventListener("offline", markStale);
    return () => {
      refreshRequest.current = null;
      aborter.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", markStale);
    };
  }, [get, interval]);
  return [data, setData, status, refresh] as const;
}
