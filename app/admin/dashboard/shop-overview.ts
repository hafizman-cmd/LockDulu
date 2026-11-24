import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { existingShop, unresolvedOrder } from "@/lib/shop-status";

const shopsPerPage = 20;

export async function readShopOverview(requestedPage: number, handle: string, status?: "ACTIVE" | "HELD") {
  const database = db();
  const where = status ? { status } : existingShop;
  const handleMatch = Prisma.sql`instr(lower("storeSlug"), ${handle}) > 0
    AND ${status ? Prisma.sql`"status" = ${status}` : Prisma.sql`"status" != 'DELETED'`}`;
  const [totals, listings, filteredCount] = await Promise.all([
    database.seller.groupBy({ by: ["status"], where: existingShop, _count: true }),
    database.garment.count({ where: { seller: existingShop, deletedAt: null } }),
    handle ? database.$queryRaw<[{ matches: bigint }]>`SELECT count(*) AS matches FROM "Seller" WHERE ${handleMatch}`
      .then(([row]) => Number(row.matches)) : status ? database.seller.count({ where }) : undefined,
  ]);
  const activeShops = totals.find(row => row.status === "ACTIVE")?._count ?? 0;
  const heldShops = totals.find(row => row.status === "HELD")?._count ?? 0;
  const shops = activeShops + heldShops;
  const matches = filteredCount ?? shops;
  const pageCount = Math.max(1, Math.ceil(matches / shopsPerPage));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * shopsPerPage;
  const shopIds = handle && matches ? await database.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Seller" WHERE ${handleMatch}
    ORDER BY "createdAt" DESC, "id" DESC LIMIT ${shopsPerPage} OFFSET ${offset}
  ` : null;
  const shopRows = matches ? await database.seller.findMany({
    where: shopIds ? { ...where, id: { in: shopIds.map(shop => shop.id) } } : where,
    skip: shopIds ? 0 : offset,
    take: shopsPerPage,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, storeName: true, storeSlug: true, createdAt: true, status: true,
      _count: { select: { garments: { where: { deletedAt: null } }, orders: { where: unresolvedOrder } } },
    },
  }) : [];

  const sellerIds = shopRows.map(shop => shop.id);
  async function countsByShop(orderFilter: Prisma.OrderWhereInput) {
    if (!sellerIds.length) return new Map<string, number>();
    const counts = await database.order.groupBy({
      by: ["sellerId"], where: { sellerId: { in: sellerIds }, ...orderFilter }, _count: true,
    });
    return new Map(counts.map(row => [row.sellerId, row._count]));
  }
  const [pending, open] = await Promise.all([
    countsByShop({ paymentStatus: "PENDING_VERIFICATION" }),
    countsByShop({ paymentStatus: "VERIFIED_PAID", shippedAt: null, shipmentReconciledAt: null }),
  ]);

  return {
    shops, listings, activeShops, heldShops, matches, page, pageCount,
    shopRows: shopRows.map(shop => ({
      ...shop, pendingReceipts: pending.get(shop.id) ?? 0, openShipments: open.get(shop.id) ?? 0,
    })),
  };
}
