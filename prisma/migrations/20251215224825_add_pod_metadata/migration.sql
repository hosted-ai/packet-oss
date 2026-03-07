-- CreateTable
CREATE TABLE "PodMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "displayName" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PodMetadata_subscriptionId_key" ON "PodMetadata"("subscriptionId");

-- CreateIndex
CREATE INDEX "PodMetadata_stripeCustomerId_idx" ON "PodMetadata"("stripeCustomerId");
