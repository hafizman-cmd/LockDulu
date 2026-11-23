import { db, writeTransaction } from "./db.ts";
import { HttpError } from "./http.ts";
import { existingShop } from "./shop-status.ts";

const shopsPerPage = 20;
const confirmedOrder = { paymentStatus: "VERIFIED_PAID" } as const;

export async function adminOverview(requestedPage: number) {
  const database = db();
  const [shops, listings, orders, pendingReviews] = await Promise.all([
    database.seller.count({ where: existingShop }),
    database.garment.count({ where: { seller: existingShop } }),
    database.order.count({ where: { seller: existingShop, ...confirmedOrder } }),
    database.order.count({ where: { seller: existingShop, paymentStatus: "PENDING_VERIFICATION" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(shops / shopsPerPage));
  const page = Math.min(requestedPage, pageCount);
  const shopRows = await database.seller.findMany({
    where: existingShop,
    skip: (page - 1) * shopsPerPage,
    take: shopsPerPage,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, storeName: true, storeSlug: true, createdAt: true, status: true,
      _count: { select: { garments: true, orders: { where: confirmedOrder } } } },
  });
  return { shops, listings, orders, pendingReviews, shopRows, page, pageCount };
}

export type ShopModeration = "hold" | "resume" | "delete";

export async function moderateShop(sellerId: string, command: ShopModeration) {
  await writeTransaction(async tx => {
    if (command === "resume") {
      const { count } = await tx.seller.updateMany({ where: { id: sellerId, status: "HELD" }, data: { status: "ACTIVE" } });
      if (!count) throw new HttpError("This shop is no longer on hold. Reload the dashboard.", 409);
      return;
    }

    // Check for locks in the same SQL statement as the status change so a checkout cannot slip in between them.
    const { count } = await tx.seller.updateMany({
      where: {
        id: sellerId,
        ...(command === "hold" ? { status: "ACTIVE" } : existingShop),
        garments: { none: { status: "LOCKED", lockedUntil: { gt: new Date() } } },
      },
      data: command === "hold" ? { status: "HELD" } : { status: "DELETED", passwordHash: "" },
    });
    if (count) return;

    const shop = await tx.seller.findUnique({ where: { id: sellerId, ...existingShop }, select: { status: true } });
    if (!shop) throw new HttpError("This shop is no longer available. Reload the dashboard.", 404);
    if (command === "hold" && shop.status === "HELD") throw new HttpError("This shop is already on hold.", 409);
    throw new HttpError("A buyer has an active garment lock. Try again after the lock ends.", 409);
  });
}
