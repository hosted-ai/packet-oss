-- CreateTable
CREATE TABLE "CustomerCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "stripeCreatedAt" DATETIME NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "billingType" TEXT,
    "teamId" TEXT,
    "productId" TEXT,
    "metadataJson" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CustomerCache_email_idx" ON "CustomerCache"("email");
CREATE INDEX "CustomerCache_billingType_idx" ON "CustomerCache"("billingType");
CREATE INDEX "CustomerCache_teamId_idx" ON "CustomerCache"("teamId");
CREATE INDEX "CustomerCache_stripeCreatedAt_idx" ON "CustomerCache"("stripeCreatedAt");
