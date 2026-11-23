import { db } from "./db.ts";
import { activeShop } from "./shop-status.ts";

function searchKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

export async function readShopDirectory(query: string) {
  const shops = await db().seller.findMany({
    where: activeShop,
    select: { storeName: true, storeSlug: true, bio: true },
    orderBy: [{ storeName: "asc" }, { storeSlug: "asc" }],
  });
  const search = searchKey(query.trim().replace(/^@/, ""));
  return search ? shops.filter(shop =>
    searchKey(shop.storeName).includes(search) || searchKey(shop.storeSlug).includes(search),
  ) : shops;
}
