const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function inventoryWith(database) {
  const source = ts.transpileModule(readFileSync("lib/inventory.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const dependencies = {
    "./db": { db: () => database, writeTransaction: run => run(database) },
    "./http": { HttpError: class HttpError extends Error {} },
    "./security": { hashToken: value => value },
  };
  vm.runInNewContext(source, { exports, require: name => dependencies[name], Date, Promise, Array });
  return exports;
}

test("store and item reads refresh expired locks and due drops", async () => {
  const past = new Date(Date.now() - 60_000);
  const seller = { id: "seller", storeName: "Shop", storeSlug: "shop", bio: "", whatsappNumber: "" };
  const drop = { id: "drop", sellerId: seller.id, title: "Drop", status: "UPCOMING", scheduledAt: past };
  const item = {
    id: "item", sellerId: seller.id, dropId: drop.id, drop, seller,
    status: "LOCKED", lockedUntil: past, price: { toFixed: () => "10.00" },
    images: [], flawPins: [],
  };
  let expiredOrders = 0;
  const database = {
    seller: { findUnique: async () => seller },
    garment: {
      findMany: async () => [item],
      findUnique: async () => item,
      findFirst: async () => item.status === "LOCKED" ? item : null,
      updateManyAndReturn: async () => { item.status = "AVAILABLE"; item.lockedUntil = null; return [{ id: item.id }]; },
    },
    drop: {
      findMany: async () => [drop],
      findFirst: async () => drop.status === "UPCOMING" ? drop : null,
      updateMany: async () => { drop.status = "LIVE"; },
    },
    order: { updateMany: async () => { expiredOrders++; } },
    orderItem: { deleteMany: async () => {} },
  };
  const { readStore, readItem } = inventoryWith(database);

  const store = await readStore("SHOP");
  assert.equal(store.items[0].status, "AVAILABLE");
  assert.equal(store.items[0].locksOpen, true);
  assert.equal(store.drops[0].status, "LIVE");
  assert.equal(expiredOrders, 1);

  item.status = "LOCKED";
  item.lockedUntil = past;
  drop.status = "UPCOMING";
  const detail = await readItem(item.id);
  assert.equal(detail.item.status, "AVAILABLE");
  assert.equal(detail.item.locksOpen, true);
  assert.equal(expiredOrders, 2);
});
