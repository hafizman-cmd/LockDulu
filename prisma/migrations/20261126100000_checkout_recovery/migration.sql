ALTER TABLE "Garment" ADD COLUMN "publishRequestId" TEXT;
CREATE UNIQUE INDEX "Garment_sellerId_publishRequestId_key" ON "Garment"("sellerId", "publishRequestId");

ALTER TABLE "Order" ADD COLUMN "shipmentReconciledAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "transferReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "transferReportedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "transferResolvedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "transferResolution" TEXT;

UPDATE "Order"
SET "shipmentReconciledAt" = "shippedAt", "shippedAt" = NULL, "shipmentUnconfirmed" = false
WHERE "fulfillmentType" = 'SHIP_NOW' AND "shipmentUnconfirmed" = true AND "shippedAt" IS NOT NULL;
