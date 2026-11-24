ALTER TABLE "Order" ADD COLUMN "garmentTitle" TEXT;
ALTER TABLE "Order" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "dispatchGroupId" TEXT;
ALTER TABLE "Order" ADD COLUMN "shipmentUnconfirmed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Order"
SET "garmentTitle" = (
    SELECT "title" FROM "Garment"
    WHERE "Garment"."sellerId" = "Order"."sellerId" AND "Garment"."code" = "Order"."garmentCode"
);

UPDATE "Order" SET "shipmentUnconfirmed" = true
WHERE "paymentStatus" = 'VERIFIED_PAID' AND "fulfillmentType" = 'SHIP_NOW' AND "shippedAt" IS NULL;

UPDATE "Order" SET "dispatchGroupId" = "id"
WHERE "fulfillmentType" = 'HOLD_BOX' AND "dispatchRequestedAt" IS NOT NULL AND "shippedAt" IS NULL;

CREATE INDEX "Order_sellerId_dispatchGroupId_idx" ON "Order"("sellerId", "dispatchGroupId");
