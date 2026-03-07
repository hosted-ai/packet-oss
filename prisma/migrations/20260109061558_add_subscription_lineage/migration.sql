-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "customerId" TEXT
);

-- CreateTable
CREATE TABLE "SubscriptionLineage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "rootSubscriptionId" TEXT NOT NULL,
    "previousSubscriptionId" TEXT NOT NULL,
    "newSubscriptionId" TEXT NOT NULL,
    "poolId" TEXT,
    "poolName" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedStripeEvent_stripeEventId_key" ON "ProcessedStripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "ProcessedStripeEvent_stripeEventId_idx" ON "ProcessedStripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "ProcessedStripeEvent_sessionId_idx" ON "ProcessedStripeEvent"("sessionId");

-- CreateIndex
CREATE INDEX "ProcessedStripeEvent_processedAt_idx" ON "ProcessedStripeEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionLineage_newSubscriptionId_key" ON "SubscriptionLineage"("newSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionLineage_teamId_idx" ON "SubscriptionLineage"("teamId");

-- CreateIndex
CREATE INDEX "SubscriptionLineage_rootSubscriptionId_idx" ON "SubscriptionLineage"("rootSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionLineage_previousSubscriptionId_idx" ON "SubscriptionLineage"("previousSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionLineage_newSubscriptionId_idx" ON "SubscriptionLineage"("newSubscriptionId");
