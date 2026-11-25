import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { db } from "../lib/db.ts";
import { limitBody } from "../lib/http.ts";
import { lockItem, preparePayment } from "../lib/inventory.ts";
import { limitReceiptUpload } from "../lib/request-budget.ts";
import { maxMultipartUpload } from "../lib/upload-limits.ts";

const details = {
  buyerName: "Test Buyer", buyerPhone: "60123456789",
  shippingAddress: "12 Jalan Merdeka", fulfillmentType: "SHIP_NOW",
} as const;

test("checkout validates uploads before reading bytes and applies shared quotas only to new work", async () => {
  const cwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "lockdulu-checkout-upload-"));
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(directory, "test.db")).href;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.LOCKDULU_TEST_PAYMENTS = "1";
  process.env.SESSION_SECRET = "test-only-receipt-encryption-key-123456789";
  process.env.VERCEL = "";
  process.env.BLOB_READ_WRITE_TOKEN = "";
  process.env.BLOB_STORE_ID = "";

  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "prisma/migrate.ts"]);
    process.chdir(directory);
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const path = specifier.startsWith("@/lib/") ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier;
        return nextResolve(path, context);
      },
    });
    const { POST } = await import("../app/api/upload/route.ts").finally(() => hooks.deregister());
    const { storage } = await import("../lib/storage.ts");
    const shop = await db().seller.create({ data: {
      storeName: "Test shop", storeSlug: "test-shop", bio: "", whatsappNumber: "60123456789", passwordHash: "test",
      qrCodeUrl: "/sample/duitnow.svg", qrAccountName: "Test payee", qrBankLabel: "Test bank",
    } });
    const garment = await db().garment.create({ data: {
      sellerId: shop.id, code: "B-001", title: "Test garment", brand: "Test", category: "Tee", price: "30.00",
      pitInches: 22, lengthInches: 28, conditionGrade: "LIKE_NEW", conditionNotes: "", images: [], flawPins: [],
    } });
    const token = "a".repeat(64);
    const { quote } = await lockItem(garment.id, token);
    const pixels = { create: { width: 16, height: 16, channels: 3, background: "white" } } as const;
    const png = Uint8Array.from(await sharp(pixels).png().toBuffer());

    function request(accessToken: string | null, options: { length?: number; file?: File } = {}) {
      const body = new FormData();
      body.set("file", options.file ?? new File([png], "receipt.png"));
      body.set("delivery", JSON.stringify(details));
      const headers = new Headers({ "x-lockdulu-order": quote.orderId });
      if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
      if (options.length) headers.set("content-length", String(options.length));
      return new Request("http://localhost/api/upload?kind=receipt", { method: "POST", body, headers });
    }

    for (const [accessToken, status] of [[null, 401], ["b".repeat(64), 404], [token, 409]] as const) {
      const denied = request(accessToken);
      assert.equal((await POST(denied)).status, status);
      assert.equal(denied.bodyUsed, false);
    }
    await preparePayment(quote.orderId, token, details);
    const tooLarge = request(token, { length: maxMultipartUpload + 1 });
    assert.equal((await POST(tooLarge)).status, 413);
    assert.equal(tooLarge.bodyUsed, false);
    assert.equal((await POST(request(token, { file: new File(["plain text"], "receipt.png", { type: "image/png" }) }))).status, 400);
    await assert.rejects(readdir("public/uploads"), { code: "ENOENT" });

    for (let attempt = 0; attempt < 3; attempt++) await limitReceiptUpload(quote.orderId, shop.id, null);
    const limited = request(token);
    assert.equal((await POST(limited)).status, 429);
    assert.equal(limited.bodyUsed, false);
    await db().requestBudget.update({ where: { key: `receipt:order:${quote.orderId}` }, data: { expiresAt: 0n } });
    const saved = await POST(request(token));
    assert.equal(saved.status, 200);
    const result = await saved.json();
    assert.equal(result.status, "PENDING_VERIFICATION");
    const retry = request(token);
    assert.deepEqual(await (await POST(retry)).json(), result);
    assert.equal(retry.bodyUsed, false);
    const files = await readdir("public/uploads");
    assert.equal(files.length, 1);
    assert.equal((await sharp(await storage.read(files[0], true)).metadata()).format, "webp");

    for (const format of ["jpeg", "webp", "avif"] as const) {
      const image = Uint8Array.from(await sharp(pixels).toFormat(format).toBuffer());
      const savedImage = await storage.save(new File([image], `garment.${format}`), "garment");
      assert.equal((await sharp(await storage.read(savedImage.name)).metadata()).format, "webp");
    }

    const second = await db().garment.create({ data: {
      sellerId: shop.id, code: "B-002", title: "Another garment", brand: "Test", category: "Tee", price: "30.00",
      pitInches: 22, lengthInches: 28, conditionGrade: "LIKE_NEW", conditionNotes: "", images: [], flawPins: [],
    } });
    const secondToken = "c".repeat(64);
    const reservation = await lockItem(second.id, secondToken);
    const key = `lock:item:${second.id}`;
    await db().requestBudget.update({ where: { key }, data: { count: 6 } });
    assert.deepEqual((await lockItem(second.id, secondToken)).quote, reservation.quote);
    await db().garment.update({ where: { id: second.id }, data: { lockedUntil: new Date(0) } });
    await assert.rejects(lockItem(second.id, "d".repeat(64)), { status: 429 });
    assert.equal(await db().order.count({ where: { sellerId: shop.id } }), 2);
    assert.equal((await db().order.findUniqueOrThrow({ where: { id: reservation.quote.orderId } })).paymentStatus, "AWAITING_RECEIPT");
    await db().requestBudget.update({ where: { key }, data: { expiresAt: 0n } });
    assert.notEqual((await lockItem(second.id, "d".repeat(64))).quote.orderId, reservation.quote.orderId);
  } finally {
    await db().$disconnect();
    process.chdir(cwd);
    await rm(directory, { recursive: true, maxRetries: 5 });
  }
});

test("stalled request bodies time out", async () => {
  const request = new Request("http://localhost/api/upload", {
    method: "POST", body: new ReadableStream(), duplex: "half",
  } as RequestInit);
  await assert.rejects(limitBody(request, maxMultipartUpload, 10), { status: 408 });
});
