import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appKey, sessionSeconds, tokenPattern } from "./security";

const adminCookie = "lockdulu_admin";
export const adminPath = "/admin/dashboard";
export const adminPasswordMaxLength = 256;
const cookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: adminPath } as const;

function adminCredentials() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password?.trim() || password.length < 12 || password.length > adminPasswordMaxLength) return null;
  try {
    return { password, key: appKey("admin session") };
  } catch {
    return null;
  }
}

export function adminSignInEnabled() {
  return adminCredentials() !== null;
}

function passwordDigest(key: Buffer, password: string) {
  return createHmac("sha256", key).update(password).digest();
}

function sessionSignature(key: Buffer, password: string, expires: string) {
  return createHmac("sha256", passwordDigest(key, password)).update(expires).digest();
}

export async function signInAdmin(candidate: string) {
  const credentials = adminCredentials();
  if (!credentials) return false;
  const { key, password } = credentials;
  if (!timingSafeEqual(passwordDigest(key, candidate), passwordDigest(key, password))) return false;

  const expires = String(Date.now() + sessionSeconds * 1000);
  const signature = sessionSignature(key, password, expires).toString("hex");
  (await cookies()).set(adminCookie, `${expires}.${signature}`, { ...cookieOptions, maxAge: sessionSeconds });
  return true;
}

export async function currentAdmin() {
  const credentials = adminCredentials();
  const value = (await cookies()).get(adminCookie)?.value;
  if (!credentials || !value) return false;
  const [expires, signature, ...rest] = value.split(".");
  if (!/^\d{13}$/.test(expires) || Number(expires) <= Date.now() || !signature || !tokenPattern.test(signature) || rest.length) return false;
  const expected = sessionSignature(credentials.key, credentials.password, expires);
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export async function signOutAdmin() {
  (await cookies()).set(adminCookie, "", { ...cookieOptions, maxAge: 0 });
}
