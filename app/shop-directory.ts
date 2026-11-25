import { db } from "@/lib/db";
import { garmentImages } from "@/lib/inventory";
import { paymentConfigured } from "@/lib/payment";
import { activeShop } from "@/lib/shop-status";

const pageSize = 24;
const orderBy = [{ storeName: "asc" }, { storeSlug: "asc" }] as const;
const visibleGarment = { hidden: false, deletedAt: null } as const;
type ShopStatus = "available" | "browse" | "upcoming" | "empty" | "unavailable" | "sold-out";

function searchKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

export async function readDirectoryPage(query: string, requestedPage: number) {
  const database = db();
  const now = new Date();
  const search = searchKey(query.trim().replace(/^@/, ""));
  // SQLite's lower() only folds ASCII. Check other names and whitespace in JS
  // so searches keep the same behaviour for all shop names.
  const candidates = search ? await database.$queryRaw<{ storeName: string; storeSlug: string }[]>`
    SELECT "storeName", "storeSlug"
    FROM "Seller"
    WHERE "status" = ${activeShop.status} AND (
      "storeName" GLOB '*[^ -~]*' OR "storeSlug" GLOB '*[^ -~]*'
      OR instr(lower(replace("storeName", ' ', '')), ${search}) > 0
      OR instr(lower(replace("storeSlug", ' ', '')), ${search}) > 0
    )
    ORDER BY "storeName" ASC, "storeSlug" ASC
  ` : null;
  const matches = candidates?.filter(shop =>
    searchKey(shop.storeName).includes(search) || searchKey(shop.storeSlug).includes(search),
  );

  const total = matches?.length ?? await database.seller.count({ where: activeShop });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;
  const handles = matches?.slice(offset, offset + pageSize).map(shop => shop.storeSlug);
  const shops = total ? await database.seller.findMany({
    where: { ...activeShop, ...(handles ? { storeSlug: { in: handles } } : {}) },
    orderBy: [...orderBy],
    select: {
      id: true, storeName: true, storeSlug: true, bio: true, bannerImageUrl: true,
      qrCodeUrl: true, qrAccountName: true, qrBankLabel: true,
      garments: { where: visibleGarment, orderBy: { code: "desc" }, take: 1, select: { images: true } },
      drops: { where: { status: "UPCOMING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" },
        take: 1, select: { title: true, scheduledAt: true } },
      _count: { select: { garments: { where: { ...visibleGarment, status: { notIn: ["SOLD", "HOLD_BOX"] } } } } },
    },
    skip: handles ? 0 : offset,
    take: pageSize,
  }) : [];
  const available = shops.length ? await database.garment.groupBy({
    by: ["sellerId"],
    where: {
      ...visibleGarment, sellerId: { in: shops.map(shop => shop.id) },
      AND: [
        { OR: [{ status: "AVAILABLE" }, { status: "LOCKED", lockedUntil: { lte: now } }] },
        { OR: [{ dropId: null }, { drop: { status: "LIVE" } }, { drop: { status: "UPCOMING", scheduledAt: { lte: now } } }] },
      ],
    },
  }) : [];
  const shopsWithAvailability = new Set(available.map(group => group.sellerId));

  return {
    total, page, pageCount,
    shops: shops.map(shop => {
      const preview = shop.garments[0];
      const nextDrop = shop.drops[0];
      const status: ShopStatus = shopsWithAvailability.has(shop.id) ? (paymentConfigured(shop) ? "available" : "browse")
        : nextDrop ? "upcoming" : !preview ? "empty" : shop._count.garments ? "unavailable" : "sold-out";
      return {
        storeSlug: shop.storeSlug, storeName: shop.storeName, bio: shop.bio,
        previewImage: (preview && garmentImages(preview.images)[0]) || shop.bannerImageUrl,
        status,
        nextDrop: nextDrop ? { title: nextDrop.title, scheduledAt: nextDrop.scheduledAt.toISOString() } : null,
      };
    }),
  };
}
