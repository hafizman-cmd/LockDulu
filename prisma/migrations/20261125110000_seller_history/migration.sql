ALTER TABLE "Garment" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "receiptSubmittedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "reviewedAt" DATETIME;
UPDATE "Order" SET "reviewedAt" = "verifiedAt" WHERE "paymentStatus" = 'VERIFIED_PAID';
CREATE INDEX "Order_sellerId_createdAt_id_idx" ON "Order"("sellerId", "createdAt", "id");
