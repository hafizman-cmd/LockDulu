import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "../generated/prisma/client.ts";
import { db, writeTransaction } from "./db.ts";
import { HttpError } from "./http.ts";
import { appKey } from "./security.ts";

const minute = 60_000;
type Budget = { key: string; max: number; windowMs: number };

export function checkoutClientKey(request: Request) {
  // Vercel supplies this header at ingress. Ignore client-supplied forwarding headers elsewhere.
  if (process.env.VERCEL !== "1") return null;
  const address = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (!address || !isIP(address)) return null;
  return createHmac("sha256", appKey("request budget")).update(address).digest("hex");
}

async function consume(tx: Prisma.TransactionClient, budgets: Budget[], message: string) {
  const now = BigInt(Date.now());
  const values = budgets.map(({ key, max, windowMs }) => Prisma.sql`(${key}, ${max}, ${now + BigInt(windowMs)})`);
  const consumed = await tx.$executeRaw`
    WITH limits("key", "max", "expiresAt") AS (VALUES ${Prisma.join(values)})
    INSERT INTO "RequestBudget" ("key", "count", "expiresAt")
    SELECT "key", 1, "expiresAt" FROM limits
    WHERE NOT EXISTS (
      SELECT 1 FROM limits
      JOIN "RequestBudget" AS existing ON existing."key" = limits."key"
      WHERE existing."expiresAt" > ${now} AND existing."count" >= limits."max"
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RequestBudget"."expiresAt" <= ${now} THEN 1 ELSE "RequestBudget"."count" + 1 END,
      "expiresAt" = CASE WHEN "RequestBudget"."expiresAt" <= ${now} THEN excluded."expiresAt" ELSE "RequestBudget"."expiresAt" END
  `;
  if (consumed !== budgets.length) throw new HttpError(message, 429);
  await tx.$executeRaw`
    DELETE FROM "RequestBudget" WHERE "key" IN (
      SELECT "key" FROM "RequestBudget" WHERE "expiresAt" <= ${now} ORDER BY "expiresAt" LIMIT 32
    )
  `;
}

export async function limitNewReservation(tx: Prisma.TransactionClient, itemId: string, shopId: string, client: string | null) {
  const budgets = [
    { key: `lock:item:${itemId}`, max: 6, windowMs: 60 * minute },
    { key: `lock:shop:${shopId}`, max: 120, windowMs: 10 * minute },
  ];
  if (client) {
    budgets.push(
      { key: `lock:client:${client}`, max: 18, windowMs: 10 * minute },
      { key: `lock:shop-client:${shopId}:${client}`, max: 10, windowMs: 10 * minute },
    );
  }
  await consume(tx, budgets, "Too many new reservations. Please try again later.");
}

export async function limitReceiptUpload(orderId: string, shopId: string, client: string | null) {
  const budgets = [
    { key: `receipt:order:${orderId}`, max: 5, windowMs: minute },
    { key: `receipt:shop:${shopId}`, max: 120, windowMs: minute },
  ];
  if (client) budgets.push({ key: `receipt:client:${client}`, max: 18, windowMs: minute });
  await writeTransaction(tx => consume(tx, budgets, "Too many receipt uploads. Wait a minute and try again."));
}

export async function limitSellerUpload(sellerId: string) {
  await writeTransaction(tx => consume(tx, [
    { key: `upload:seller:${sellerId}`, max: 60, windowMs: minute },
  ], "Too many image uploads. Wait a minute and try again."));
}

export async function limitLockRequest(client: string) {
  await consume(db(), [
    { key: `lock-request:client:${client}`, max: 60, windowMs: minute },
  ], "Too many checkout requests. Wait a minute and try again.");
}
