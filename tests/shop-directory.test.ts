import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { db } from "../lib/db.ts";
import { readShopDirectory } from "../lib/shop-directory.ts";

test("the shop directory lists and searches public shop details", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockdulu-shops-"));
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(directory, "test.db")).href;
  process.env.TURSO_AUTH_TOKEN = "";

  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "prisma/migrate.ts"]);
    assert.deepEqual(await readShopDirectory(""), []);

    const settings = {
      whatsappNumber: "60123456789", qrCodeUrl: "", qrAccountName: "", qrBankLabel: "", passwordHash: "test",
    };
    const kakiSelam = { storeName: "kakiselam", storeSlug: "kakiselam.guni", bio: "" };
    const kedaiBundle = { storeName: "Kedai Bundle KL", storeSlug: "kedaibundle.kl", bio: "Vintage drops" };
    await db().seller.createMany({ data: [
      { ...kakiSelam, ...settings },
      { ...kedaiBundle, ...settings },
    ] });

    assert.deepEqual(await readShopDirectory(""), [kedaiBundle, kakiSelam]);
    assert.deepEqual(await readShopDirectory("  Kaki Selam  "), [kakiSelam]);
    assert.deepEqual(await readShopDirectory("@KAKISELAM.GUNI"), [kakiSelam]);
    assert.deepEqual(await readShopDirectory("bundle kl"), [kedaiBundle]);
    assert.deepEqual(await readShopDirectory("missing shop"), []);
  } finally {
    await db().$disconnect();
    await rm(directory, { recursive: true, maxRetries: 5 });
  }
});
