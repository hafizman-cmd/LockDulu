import { PrismaLibSql } from "@prisma/adapter-libsql";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { setTimeout } from "node:timers/promises";
import { databaseConfig } from "./database-config.ts";

const scope = globalThis as typeof globalThis & { lockDuluDb?: PrismaClient };

export function db() {
  // Fast Refresh can reload the generated client while preserving the previous instance.
  if (process.env.NODE_ENV === "development" && !(scope.lockDuluDb instanceof PrismaClient)) {
    scope.lockDuluDb = undefined;
  }
  return scope.lockDuluDb ??= new PrismaClient({
    adapter: new PrismaLibSql(databaseConfig()),
  });
}

export async function writeTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db().$transaction(run);
    } catch (error) {
      // A deferred SQLite transaction can encounter a competing writer when it starts writing.
      const busy = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1008" ||
        error instanceof Error && /\bSQLITE_BUSY(?:_\w+)?\b|\bdatabase is locked\b/i.test(error.message);
      if (!busy || attempt >= 4) throw error;
      await setTimeout(20 * 2 ** attempt + Math.random() * 20);
    }
  }
}
