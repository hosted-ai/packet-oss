-- CreateTable
CREATE TABLE "PodMetricsHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tflopsUsage" REAL NOT NULL DEFAULT 0,
    "vramUsageKb" REAL NOT NULL DEFAULT 0,
    "hoursUsed" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "status" TEXT,
    "gpuCount" INTEGER NOT NULL DEFAULT 1,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MetricsCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "cacheData" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PodMetricsHistory_teamId_timestamp_idx" ON "PodMetricsHistory"("teamId", "timestamp");

-- CreateIndex
CREATE INDEX "PodMetricsHistory_subscriptionId_timestamp_idx" ON "PodMetricsHistory"("subscriptionId", "timestamp");

-- CreateIndex
CREATE INDEX "PodMetricsHistory_timestamp_idx" ON "PodMetricsHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MetricsCache_teamId_key" ON "MetricsCache"("teamId");

-- CreateIndex
CREATE INDEX "MetricsCache_teamId_idx" ON "MetricsCache"("teamId");

-- CreateIndex
CREATE INDEX "MetricsCache_fetchedAt_idx" ON "MetricsCache"("fetchedAt");
