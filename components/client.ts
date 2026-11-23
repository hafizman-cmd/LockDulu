"use client";
import { useEffect, useState } from "react";

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

export function upload<T>(kind: "garment" | "qr" | "receipt", form: FormData) {
  const file = form.get("file");
  if (file instanceof File && file.size > 4 * 1024 * 1024) {
    return Promise.reject(new Error("Choose an image smaller than 4 MB."));
  }
  return json<T>(`/api/upload?kind=${kind}`, { method: "POST", body: form });
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}

export function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* In-app browsers may block storage. */ }
}

export type SavedLock = { itemId: string; token: string; orderId?: string; lockedUntil?: string; storeSlug: string; submitted?: boolean };
export const lockKey = "lockdulu.checkouts";
let knownLocks: SavedLock[] = [];
export function savedLocks() { return readLocal<SavedLock[]>(lockKey, knownLocks); }
export function saveLock(lock: SavedLock) {
  knownLocks = [lock, ...savedLocks().filter(candidate => candidate.token !== lock.token)].slice(0, 100);
  writeLocal(lockKey, knownLocks);
  window.dispatchEvent(new Event("lockdulu-lock"));
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
  useEffect(() => { setData(initial); }, [initial]);
  useEffect(() => {
    const aborter = new AbortController();
    let busy = false;
    const run = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const next = await get(aborter.signal);
        if (!aborter.signal.aborted) setData(current => next.serverTime >= current.serverTime ? next : current);
      } catch { /* A transient polling failure should leave the last view usable. */ }
      finally { busy = false; }
    };
    const intervalId = window.setInterval(run, interval);
    document.addEventListener("visibilitychange", run);
    return () => {
      aborter.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", run);
    };
  }, [get, interval]);
  return [data, setData] as const;
}
