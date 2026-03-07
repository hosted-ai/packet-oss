-- CreateTable
CREATE TABLE "VllmMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "promptTokens" BIGINT NOT NULL,
    "generationTokens" BIGINT NOT NULL,
    "totalTokens" BIGINT NOT NULL,
    "promptTokensDelta" BIGINT NOT NULL DEFAULT 0,
    "generationTokensDelta" BIGINT NOT NULL DEFAULT 0,
    "totalTokensDelta" BIGINT NOT NULL DEFAULT 0,
    "walletBalanceCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "VllmMetrics_subscriptionId_createdAt_idx" ON "VllmMetrics"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "VllmMetrics_stripeCustomerId_createdAt_idx" ON "VllmMetrics"("stripeCustomerId", "createdAt");
