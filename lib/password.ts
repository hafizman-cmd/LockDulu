import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function passwordHash(password: string, salt = randomBytes(32).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function checkPassword(password: string, hash: string) {
  const salt = hash.split(":")[0];
  const candidate = Buffer.from(passwordHash(password, salt));
  const expected = Buffer.from(hash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
