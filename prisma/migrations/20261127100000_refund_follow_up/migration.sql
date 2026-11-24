ALTER TABLE "Order" ADD COLUMN "transferVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "transferEscalatedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "refundAmount" DECIMAL;
ALTER TABLE "Order" ADD COLUMN "refundSentOn" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundDisputedAt" DATETIME;

CREATE INDEX "Order_transferEscalatedAt_transferResolvedAt_idx" ON "Order"("transferEscalatedAt", "transferResolvedAt");

CREATE TABLE "TransferEvent" (
  "orderId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detail" TEXT,
  PRIMARY KEY ("orderId", "version"),
  CONSTRAINT "TransferEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "TransferEvent" ("orderId", "version", "kind", "createdAt")
SELECT "id", 0, "transferResolution", "transferResolvedAt"
FROM "Order"
WHERE "transferResolution" IN ('REFUNDED', 'TRANSFER_NOT_FOUND')
  AND "transferReportedAt" IS NOT NULL AND "transferResolvedAt" IS NOT NULL;

UPDATE "Order"
SET "transferResolvedAt" = NULL
WHERE "transferResolution" IN ('REFUNDED', 'TRANSFER_NOT_FOUND') AND "transferReportedAt" IS NOT NULL;
