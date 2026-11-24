import { db } from "@/lib/db";
import { activeShop } from "@/lib/shop-status";

const pageSize = 24;
const orderBy = [{ storeName: "asc" }, { storeSlug: "asc" }] as const;
const publicFields = { storeName: true, storeSlug: true, bio: true } as const;

function searchKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

export async function readDirectoryPage(query: string, requestedPage: number) {
  const database = db();
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
    select: publicFields,
    skip: handles ? 0 : offset,
    take: pageSize,
  }) : [];
  return { shops, total, page, pageCount };
}
