import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "./http.ts";

export const activeShop = { status: "ACTIVE" } as const;
export const existingShop = { status: { not: "DELETED" } } as const;

export const unresolvedOrder: Prisma.OrderWhereInput = {
  OR: [{ paymentStatus: "PENDING_VERIFICATION" }, { paymentStatus: "VERIFIED_PAID", shippedAt: null }],
};

export async function requireOrderSeller(db: Pick<Prisma.TransactionClient, "seller">, sellerId: string) {
  const shop = await db.seller.findUnique({ where: { id: sellerId, ...existingShop }, select: { status: true } });
  if (!shop) throw new HttpError("Shop not found.", 404);
  return shop;
}

export async function requireActiveSeller(db: Pick<Prisma.TransactionClient, "seller">, sellerId: string) {
  const shop = await requireOrderSeller(db, sellerId);
  if (shop.status === "HELD") throw new HttpError("Your shop is on hold. Shop changes are disabled.", 403);
}
