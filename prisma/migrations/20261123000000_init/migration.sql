-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeName" TEXT NOT NULL,
    "storeSlug" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "qrCodeUrl" TEXT NOT NULL,
    "qrAccountName" TEXT NOT NULL,
    "qrBankLabel" TEXT NOT NULL,
    "holdBoxDays" INTEGER NOT NULL DEFAULT 7,
    "shippingFee" DECIMAL NOT NULL DEFAULT 8.00,
    "passwordHash" TEXT NOT NULL,
    "nextItemNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Drop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "Drop_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Garment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "dropId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "pitInches" REAL NOT NULL,
    "lengthInches" REAL NOT NULL,
    "conditionGrade" TEXT NOT NULL,
    "conditionNotes" TEXT NOT NULL,
    "images" JSONB NOT NULL,
    "flawPins" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "lockedUntil" DATETIME,
    "lockSessionToken" TEXT,
    CONSTRAINT "Garment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Garment_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL DEFAULT '',
    "buyerPhone" TEXT NOT NULL DEFAULT '',
    "shippingAddress" TEXT NOT NULL DEFAULT '',
    "fulfillmentType" TEXT NOT NULL DEFAULT 'SHIP_NOW',
    "totalAmount" DECIMAL NOT NULL,
    "itemAmount" DECIMAL NOT NULL,
    "shippingFee" DECIMAL NOT NULL,
    "holdBoxDays" INTEGER NOT NULL,
    "qrCodeUrl" TEXT NOT NULL,
    "qrAccountName" TEXT NOT NULL,
    "qrBankLabel" TEXT NOT NULL,
    "garmentCode" TEXT NOT NULL,
    "buyerAccessHash" TEXT NOT NULL,
    "receiptImageUrl" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'AWAITING_RECEIPT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "dispatchRequestedAt" DATETIME,
    "shippedAt" DATETIME,
    CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "Garment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_storeSlug_key" ON "Seller"("storeSlug");

-- CreateIndex
CREATE INDEX "Drop_sellerId_status_scheduledAt_idx" ON "Drop"("sellerId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Garment_sellerId_status_lockedUntil_idx" ON "Garment"("sellerId", "status", "lockedUntil");

-- CreateIndex
CREATE INDEX "Garment_dropId_idx" ON "Garment"("dropId");

-- CreateIndex
CREATE UNIQUE INDEX "Garment_sellerId_code_key" ON "Garment"("sellerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_buyerAccessHash_key" ON "Order"("buyerAccessHash");

-- CreateIndex
CREATE INDEX "Order_sellerId_paymentStatus_idx" ON "Order"("sellerId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Order_buyerPhone_paymentStatus_idx" ON "Order"("buyerPhone", "paymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_garmentId_key" ON "OrderItem"("garmentId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

