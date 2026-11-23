import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookie = "lockdulu_seller";
export const sessionSeconds = 8 * 60 * 60;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const tokenPattern = /^[a-f0-9]{64}$/;

export function appKey(purpose: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-with-")) throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
  return createHmac("sha256", secret).update(purpose).digest();
}

function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sign(value: string) {
  return createHmac("sha256", appKey("seller session")).update(value).digest("hex");
}

export function sellerSession(id: string) {
  const value = `${id}.${Date.now() + sessionSeconds * 1000}`;
  return `${value}.${sign(value)}`;
}

export async function currentSeller() {
  const value = (await cookies()).get(sessionCookie)?.value;
  if (!value) return null;
  const [id, expires, signature, ...rest] = value.split(".");
  if (!id || !signature || rest.length || !tokenPattern.test(signature) || !(Number(expires) > Date.now())) return null;
  return equal(sign(`${id}.${expires}`), signature) ? id : null;
}

export function normalizePhone(input: string) {
  const compact = input.replace(/[\s()+-]/g, "");
  return compact.startsWith("0") ? `60${compact.slice(1)}` : compact;
}
