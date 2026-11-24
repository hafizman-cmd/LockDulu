import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { moderateShop } from "../lib/admin.ts";
import { db } from "../lib/db.ts";
import { lockItem, orderState, preparePayment, readItem, readStore, reviewOrder, submitReceipt } from "../lib/inventory.ts";
import { dashboardData, deleteGarment, lockerLookup, markShipped, queueShipment, requestDispatch, sellerHistory, setGarmentHidden, updateShopProfile } from "../lib/seller.ts";
import { whatsapp } from "../lib/catalog.ts";

const buyerPhone = "60123456789";
const address = "12 Jalan Merdeka, Kuala Lumpur";
const delivery = { buyerName: "Test Buyer", buyerPhone, shippingAddress: address, fulfillmentType: "SHIP_NOW" } as const;

test("paid orders stay actionable and Hold Box parcels contain only the selected pieces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockdulu-fulfillment-"));
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(directory, "test.db")).href;
  process.env.TURSO_AUTH_TOKEN = "";
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "prisma/migrate.ts"]);
    const settings = { bio: "", whatsappNumber: "60192222222", qrCodeUrl: "/sample/duitnow.svg",
      qrAccountName: "Test shop", qrBankLabel: "Test bank", passwordHash: "test" };
    const shop = await db().seller.create({ data: { ...settings, storeName: "First shop", storeSlug: "first" } });
    const other = await db().seller.create({ data: { ...settings, storeName: "Other shop", storeSlug: "other" } });

    async function reserve(code: string, token: string, sellerId = shop.id) {
      const garment = await db().garment.create({ data: {
        sellerId, code, title: `Test garment ${code}`, brand: "Test", category: "Tee", price: "30.00", pitInches: 22,
        lengthInches: 28, conditionGrade: "LIKE_NEW", conditionNotes: "", images: [], flawPins: [],
      } });
      const { quote } = await lockItem(garment.id, token);
      return { id: quote.orderId, garment, token };
    }

    const ship = await reserve("B-001", "1".repeat(64));
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.status, "AWAITING_RECEIPT");
    await assert.rejects(setGarmentHidden(shop.id, ship.garment.id, true), { status: 409 });
    await assert.rejects(preparePayment(ship.id, "0".repeat(64), delivery), { status: 409 });
    await preparePayment(ship.id, ship.token, delivery);
    assert.deepEqual((await orderState(ship.id, ship.token)).delivery, delivery);
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.status, "AWAITING_RECEIPT");
    await submitReceipt(ship.id, ship.token, delivery, "test.bin");
    await assert.rejects(deleteGarment(shop.id, ship.garment.id), { status: 409 });
    await assert.rejects(setGarmentHidden(other.id, ship.garment.id, true), { status: 404 });
    await setGarmentHidden(shop.id, ship.garment.id, true);
    assert.equal(await readItem(ship.garment.id), null);
    assert.equal((await readStore(shop.storeSlug))?.items.length, 0);
    assert.equal((await dashboardData(shop.id))?.items[0]?.hidden, true);
    await assert.rejects(lockItem(ship.garment.id, "0".repeat(64)), { status: 404 });
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.status, "PENDING_VERIFICATION");
    await setGarmentHidden(shop.id, ship.garment.id, false);
    assert.equal((await readItem(ship.garment.id))?.item.hidden, false);
    assert.equal((await readStore(shop.storeSlug))?.items.length, 1);

    await updateShopProfile(shop.id, { storeName: shop.storeName, bio: shop.bio, whatsappNumber: "60178888888" });
    const [tracked] = await lockerLookup(ship.id, [ship.token]);
    assert.equal(tracked.sellerPhone, "60178888888");
    assert.equal(whatsapp(tracked.sellerPhone), "https://wa.me/60178888888");
    assert.equal((await readStore(shop.storeSlug))?.store.whatsappNumber, tracked.sellerPhone);
    assert.equal((await dashboardData(shop.id))?.seller.whatsappNumber, tracked.sellerPhone);
    assert.equal((await db().order.findUniqueOrThrow({ where: { id: ship.id } })).buyerPhone, buyerPhone);
    await assert.rejects(preparePayment(ship.id, ship.token, delivery), { status: 409 });
    await reviewOrder(shop.id, ship.id, true);
    await assert.rejects(deleteGarment(other.id, ship.garment.id), { status: 404 });
    await deleteGarment(shop.id, ship.garment.id);
    assert.equal((await dashboardData(shop.id))?.items.length, 0);
    assert.equal(await readItem(ship.garment.id), null);
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.title, "Test garment B-001");
    const [history] = (await sellerHistory(shop.id, 1)).orders;
    assert.equal(history.id, ship.id);
    assert.equal(history.total, "38.00");
    assert.equal(history.shippingCharged, "8.00");
    assert.equal(history.itemAmount, "30.00");
    assert.ok(history.receiptSubmittedAt);
    assert.ok(history.reviewedAt);
    assert.equal(history.hasReceipt, true);
    assert.equal((await sellerHistory(other.id, 1)).count, 0);
    assert.ok((await dashboardData(shop.id))?.orders.some(order => order.id === ship.id));
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.status, "VERIFIED_PAID");
    await assert.rejects(lockerLookup("another-order", [ship.token]), { status: 404 });
    await assert.rejects(lockerLookup(ship.id, ["0".repeat(64)]), { status: 404 });
    await assert.rejects(markShipped(other.id, [ship.id]), { status: 409 });
    await assert.rejects(moderateShop(shop.id, "delete"), { status: 409 });
    await db().order.update({ where: { id: ship.id }, data: { shipmentUnconfirmed: true } });
    await queueShipment(shop.id, ship.id);
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.shipmentUnconfirmed, false);
    await markShipped(shop.id, [ship.id]);
    const shippedAt = (await lockerLookup(ship.id, [ship.token]))[0]?.shippedAt;
    assert.ok(shippedAt);
    await markShipped(shop.id, [ship.id]);
    assert.equal((await lockerLookup(ship.id, [ship.token]))[0]?.shippedAt, shippedAt);
    assert.equal((await dashboardData(shop.id))?.orders.length, 0);

    const expired = await reserve("B-002", "2".repeat(64));
    await preparePayment(expired.id, expired.token, delivery);
    await db().garment.update({ where: { id: expired.garment.id }, data: { lockedUntil: new Date(0) } });
    assert.equal((await lockerLookup(expired.id, [expired.token]))[0]?.status, "EXPIRED");
    assert.equal((await orderState(expired.id, expired.token)).status, "EXPIRED");
    await assert.rejects(preparePayment(expired.id, expired.token, delivery), { status: 409 });
    const secondLock = await lockItem(expired.garment.id, "3".repeat(64));
    await assert.rejects(submitReceipt(expired.id, expired.token, delivery, "test.bin"), { status: 409 });
    assert.ok((await orderState(secondLock.quote.orderId, "3".repeat(64))).quote);
    await db().garment.update({ where: { id: expired.garment.id }, data: { lockedUntil: new Date(0) } });

    async function paidHoldBox(code: string, token: string, shippingAddress = address, sellerId = shop.id, phone = buyerPhone) {
      const order = await reserve(code, token, sellerId);
      const details = { ...delivery, shippingAddress, buyerPhone: phone, fulfillmentType: "HOLD_BOX" } as const;
      await submitReceipt(order.id, token, details, "test.bin");
      await reviewOrder(sellerId, order.id, true);
      return order;
    }

    const first = await paidHoldBox("B-004", "4".repeat(64));
    await assert.rejects(deleteGarment(shop.id, first.garment.id), { status: 409 });
    const second = await paidHoldBox("B-005", "5".repeat(64));
    const differentAddress = await paidHoldBox("B-006", "6".repeat(64), "22 Jalan Ampang, Kuala Lumpur");
    const differentShop = await paidHoldBox("B-001", "7".repeat(64), address, other.id);
    const differentBuyer = await paidHoldBox("B-007", "8".repeat(64), address, shop.id, "60199999999");
    await db().order.update({ where: { id: first.id }, data: { verifiedAt: new Date(0) } });
    await assert.rejects(requestDispatch([first.token, differentAddress.token]), { status: 409 });
    await assert.rejects(requestDispatch([first.token, differentShop.token]), { status: 409 });
    await assert.rejects(requestDispatch([first.token, differentBuyer.token]), { status: 409 });
    await assert.rejects(markShipped(shop.id, [first.id]), { status: 409 });
    await moderateShop(shop.id, "hold");
    await requestDispatch([first.token, second.token]);
    await requestDispatch([second.token, first.token]);
    const firstParcel = (await dashboardData(shop.id))?.orders.filter(order => order.dispatchGroupId);
    assert.deepEqual(new Set(firstParcel?.map(order => order.id)), new Set([first.id, second.id]));
    assert.equal(new Set(firstParcel?.map(order => order.dispatchGroupId)).size, 1);
    const sameBrowser = await lockerLookup(first.id, [first.token, second.token, differentBuyer.token]);
    assert.equal(sameBrowser.length, 2);
    assert.equal(new Set(sameBrowser.map(order => order.dispatchGroupId)).size, 1);
    assert.equal((await lockerLookup(differentAddress.id, [differentAddress.token]))[0]?.dispatchRequestedAt, null);
    await assert.rejects(requestDispatch([second.token]), { status: 409 });
    await assert.rejects(markShipped(shop.id, [second.id]), { status: 409 });
    await markShipped(shop.id, [first.id, second.id]);
    await moderateShop(shop.id, "resume");
    await deleteGarment(shop.id, first.garment.id);
    const holdHistory = (await sellerHistory(shop.id, 1)).orders.find(order => order.id === first.id);
    assert.equal(holdHistory?.shippingCharged, "0.00");
    assert.equal(holdHistory?.itemAmount, "30.00");
    assert.ok(holdHistory?.shippedAt);
    assert.ok((await lockerLookup(first.id, [first.token]))[0]?.shippedAt);
    assert.equal((await lockerLookup(differentAddress.id, [differentAddress.token]))[0]?.shippedAt, null);
  } finally {
    await db().$disconnect();
    await rm(directory, { recursive: true, maxRetries: 5 });
  }
});

test("order migration flags legacy Ship Now orders and keeps old dispatch requests separate", async () => {
  const client = createClient({ url: ":memory:" });
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  try {
    for (const folder of ["20261123000000_init", "20261123083000_shop_moderation", "20261123100000_shop_banner"]) {
      await client.executeMultiple(await readFile(new URL(`${folder}/migration.sql`, migrations), "utf8"));
    }
    await client.execute(`INSERT INTO "Seller" ("id", "storeName", "storeSlug", "bio", "whatsappNumber",
      "qrCodeUrl", "qrAccountName", "qrBankLabel", "passwordHash") VALUES ('seller', 'Shop', 'shop', '', '', '', '', '', '')`);
    await client.execute(`INSERT INTO "Garment" ("id", "sellerId", "code", "title", "brand", "category", "price",
      "pitInches", "lengthInches", "conditionGrade", "conditionNotes", "images", "flawPins")
      VALUES ('garment', 'seller', 'B-001', 'Vintage tee', 'Test', 'Tee', 30, 22, 28, 'LIKE_NEW', '', '[]', '[]')`);
    for (const [id, type, requested, shipped] of [
      ["old-ship", "SHIP_NOW", null, null], ["old-sent", "SHIP_NOW", null, "2026-11-22"],
      ["old-hold-one", "HOLD_BOX", "2026-11-22", null], ["old-hold-two", "HOLD_BOX", "2026-11-22", null],
    ]) {
      await client.execute({
        sql: `INSERT INTO "Order" ("id", "sellerId", "itemAmount", "shippingFee", "totalAmount", "holdBoxDays",
          "qrCodeUrl", "qrAccountName", "qrBankLabel", "garmentCode", "buyerAccessHash", "paymentStatus", "fulfillmentType",
          "dispatchRequestedAt", "shippedAt") VALUES (?, 'seller', 30, 8, 38, 7, '', '', '', 'B-001', ?, 'VERIFIED_PAID', ?, ?, ?)`,
        args: [id, id, type, requested, shipped],
      });
    }
    await client.executeMultiple(await readFile(new URL("20261124100000_order_fulfillment/migration.sql", migrations), "utf8"));
    await client.executeMultiple(await readFile(new URL("20261125100000_listing_visibility/migration.sql", migrations), "utf8"));
    await client.executeMultiple(await readFile(new URL("20261125110000_seller_history/migration.sql", migrations), "utf8"));
    assert.equal((await client.execute('SELECT "hidden" FROM "Garment"')).rows[0]?.hidden, 0);
    assert.equal((await client.execute('SELECT "deletedAt" FROM "Garment"')).rows[0]?.deletedAt, null);
    const { rows } = await client.execute('SELECT "id", "shipmentUnconfirmed", "dispatchGroupId", "garmentTitle" FROM "Order" ORDER BY rowid');
    assert.deepEqual(rows.map(row => [row.id, row.shipmentUnconfirmed, row.dispatchGroupId, row.garmentTitle]), [
      ["old-ship", 1, null, "Vintage tee"], ["old-sent", 0, null, "Vintage tee"],
      ["old-hold-one", 0, "old-hold-one", "Vintage tee"], ["old-hold-two", 0, "old-hold-two", "Vintage tee"],
    ]);
  } finally {
    client.close();
  }
});
