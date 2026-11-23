import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { adminOverview, moderateShop } from "../lib/admin.ts";
import { db } from "../lib/db.ts";
import { lockItem, orderState, readItem, readStore, reviewOrder, submitReceipt } from "../lib/inventory.ts";
import { dashboardData, deleteGarment, listGarment, lockerLookup, markShipped, requestDispatch, updateSettings } from "../lib/seller.ts";
import { readShopDirectory } from "../lib/shop-directory.ts";
import { requireActiveSeller } from "../lib/shop-status.ts";

test("shop moderation blocks active checkouts and hides held and deleted shops", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockdulu-shop-moderation-"));
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(directory, "test.db")).href;
  process.env.TURSO_AUTH_TOKEN = "";

  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "prisma/migrate.ts"]);
    const settings = {
      qrCodeUrl: "/sample/duitnow.svg", qrAccountName: "Test seller", qrBankLabel: "Test bank",
      shippingFee: "8.00", holdBoxDays: 7,
    };
    const phone = "60123456789";
    const shop = await db().seller.create({ data: {
      ...settings, storeSlug: "shop", storeName: "Test shop", bio: "Test", whatsappNumber: phone, passwordHash: "test-hash",
    } });
    const otherShop = await db().seller.create({ data: {
      ...settings, storeSlug: "other-shop", storeName: "Other shop", bio: "Test", whatsappNumber: phone, passwordHash: "test-hash",
    } });
    const listing = {
      title: "Test shirt", brand: "Test", category: "Shirt", price: "30.00", pitInches: 20, lengthInches: 26,
      conditionGrade: "LIKE_NEW", conditionNotes: "", images: ["/sample/cotton-crew-front.svg"], flawPins: [],
    } as const;
    const garment = await listGarment(shop.id, { ...listing, images: [...listing.images], flawPins: [] }, null);
    const available = await listGarment(shop.id, { ...listing, images: [...listing.images], flawPins: [] }, null);
    const token = "a".repeat(64);
    const { quote } = await lockItem(garment.id, token);

    await assert.rejects(moderateShop(shop.id, "hold"), /active garment lock/);
    await assert.rejects(moderateShop(shop.id, "delete"), /active garment lock/);
    assert.equal((await orderState(quote.orderId, token)).quote?.orderId, quote.orderId);
    await moderateShop(otherShop.id, "hold");
    assert.equal(await readStore(otherShop.storeSlug), null);

    const delivery = { buyerName: "Test buyer", buyerPhone: phone, shippingAddress: "A test address", fulfillmentType: "HOLD_BOX" } as const;
    await submitReceipt(quote.orderId, token, delivery, "test-receipt.bin");
    assert.equal((await lockerLookup(phone, [token])).length, 1);
    await db().garment.update({ where: { id: available.id }, data: { status: "LOCKED", lockedUntil: new Date(Date.now() - 5_000) } });
    await moderateShop(shop.id, "hold");
    assert.deepEqual(await readShopDirectory(""), []);
    assert.equal(await readStore(shop.storeSlug), null);
    assert.equal(await readItem(garment.id), null);
    await assert.rejects(lockItem(available.id, "b".repeat(64)), { status: 404 });
    await assert.rejects(orderState(quote.orderId, token), { status: 404 });
    await assert.rejects(requestDispatch(phone, token), { status: 409 });
    assert.equal((await lockerLookup(phone, [token])).length, 0);
    const dashboard = await dashboardData(shop.id);
    assert.equal(dashboard?.seller.status, "HELD");
    assert.equal(dashboard?.orders.length, 1);
    await assert.rejects(requireActiveSeller(db(), shop.id), { status: 403 });
    await assert.rejects(listGarment(shop.id, { ...listing, images: [...listing.images], flawPins: [] }, null), { status: 403 });
    await assert.rejects(deleteGarment(shop.id, available.id), { status: 403 });
    await assert.rejects(updateSettings(shop.id, settings), { status: 403 });
    await assert.rejects(reviewOrder(shop.id, quote.orderId, true), { status: 403 });
    await assert.rejects(markShipped(shop.id, [quote.orderId]), { status: 403 });

    await moderateShop(shop.id, "resume");
    assert.equal((await readShopDirectory(""))[0].storeSlug, shop.storeSlug);
    assert.equal((await readStore(shop.storeSlug))?.items.length, 2);
    assert.equal((await readItem(available.id))?.item.status, "AVAILABLE");
    assert.equal((await lockerLookup(phone, [token])).length, 1);
    await updateSettings(shop.id, settings);

    // Whichever write wins, moderation and a live lock cannot coexist.
    const [buyer, moderator] = await Promise.allSettled([
      lockItem(available.id, "c".repeat(64)),
      moderateShop(shop.id, "hold"),
    ]);
    assert.notEqual(buyer.status, moderator.status);
    if (buyer.status === "fulfilled") {
      await assert.rejects(moderateShop(shop.id, "delete"), /active garment lock/);
      await db().garment.update({ where: { id: available.id }, data: { lockedUntil: new Date(Date.now() - 5_000) } });
    }

    await moderateShop(shop.id, "delete");
    assert.equal(await readStore(shop.storeSlug), null);
    assert.equal(await readItem(garment.id), null);
    assert.equal(await dashboardData(shop.id), null);
    await assert.rejects(moderateShop(shop.id, "resume"), { status: 409 });
    assert.equal((await adminOverview(1)).shops, 1);
    assert.equal((await db().seller.findUniqueOrThrow({ where: { id: shop.id } })).passwordHash, "");
    assert.equal(await db().order.count({ where: { sellerId: shop.id, id: quote.orderId } }), 1);
  } finally {
    await db().$disconnect();
    await rm(directory, { recursive: true, maxRetries: 5 });
  }
});
