import { db, writeTransaction } from "./db.ts";
import { HttpError } from "./http.ts";
import { existingShop, unresolvedOrder } from "./shop-status.ts";

const shopsPerPage = 20;

export async function adminOverview(requestedPage: number) {
  const database = db();
  const [shops, listings, activeShops, heldShops] = await Promise.all([
    database.seller.count({ where: existingShop }),
    database.garment.count({ where: { seller: existingShop, deletedAt: null } }),
    database.seller.count({ where: { status: "ACTIVE" } }),
    database.seller.count({ where: { status: "HELD" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(shops / shopsPerPage));
  const page = Math.min(requestedPage, pageCount);
  const shopRows = await database.seller.findMany({
    where: existingShop,
    skip: (page - 1) * shopsPerPage,
    take: shopsPerPage,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, storeName: true, storeSlug: true, createdAt: true, status: true,
      _count: { select: { garments: { where: { deletedAt: null } } } } },
  });
  const open = await database.order.groupBy({
    by: ["sellerId"], where: { sellerId: { in: shopRows.map(shop => shop.id) }, ...unresolvedOrder }, _count: true,
  });
  const openCounts = new Map(open.map(row => [row.sellerId, row._count]));
  return { shops, listings, activeShops, heldShops, page, pageCount,
    shopRows: shopRows.map(shop => ({ ...shop, unresolvedOrders: openCounts.get(shop.id) ?? 0 })) };
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
    const activeLocks = { status: "LOCKED", lockedUntil: { gt: new Date() } } as const;
    const { count } = await tx.seller.updateMany({
      where: {
        id: sellerId,
        ...(command === "hold" ? { status: "ACTIVE" } : existingShop),
        garments: { none: activeLocks },
        ...(command === "delete" ? { orders: { none: unresolvedOrder } } : {}),
      },
      data: command === "hold" ? { status: "HELD" } : { status: "DELETED", passwordHash: "" },
    });
    if (count) return;

    const shop = await tx.seller.findUnique({ where: { id: sellerId, ...existingShop }, select: {
      status: true,
      _count: { select: { garments: { where: activeLocks }, orders: { where: unresolvedOrder } } },
    } });
    if (!shop) throw new HttpError("This shop is no longer available. Reload the dashboard.", 404);
    if (command === "hold" && shop.status === "HELD") throw new HttpError("This shop is already on hold.", 409);
    if (shop._count.garments) throw new HttpError("A buyer has an active garment lock. Try again after the lock ends.", 409);
    if (command === "delete" && shop._count.orders) {
      throw new HttpError("Resolve the shop’s pending receipts and unshipped orders before deleting it.", 409);
    }
    throw new HttpError("The shop status changed. Reload the dashboard.", 409);
  });
}
