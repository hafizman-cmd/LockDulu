CREATE TABLE "RequestBudget" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "expiresAt" BIGINT NOT NULL
);

CREATE INDEX "RequestBudget_expiresAt_idx" ON "RequestBudget"("expiresAt");
