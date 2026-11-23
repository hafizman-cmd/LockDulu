import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { databaseConfig } from "../lib/database-config.ts";

const migrations = new URL("./migrations/", import.meta.url);
const client = createClient(databaseConfig());

try {
  const entries = await readdir(migrations, { withFileTypes: true });
  for (const migration of entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const sql = (await readFile(new URL(`${migration}/migration.sql`, migrations), "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const tx = await client.transaction("write");
    try {
      await tx.execute('CREATE TABLE IF NOT EXISTS "_lockdulu_migrations" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL)');
      const { rows } = await tx.execute({
        sql: 'SELECT "checksum" FROM "_lockdulu_migrations" WHERE "name" = ?',
        args: [migration],
      });
      if (rows[0] && rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${migration}`);
      if (!rows.length) {
        await tx.executeMultiple(sql);
        await tx.execute({
          sql: 'INSERT INTO "_lockdulu_migrations" ("name", "checksum") VALUES (?, ?)',
          args: [migration, checksum],
        });
      }
      await tx.commit();
      console.log(`${migration}: ${rows.length ? "already applied" : "applied"}`);
    } finally {
      tx.close();
    }
  }
} finally {
  client.close();
}
