-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProviderNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL DEFAULT 'root',
    "requestedGpuTypeId" TEXT,
    "gpuModel" TEXT,
    "gpuCount" INTEGER,
    "cpuModel" TEXT,
    "cpuCores" INTEGER,
    "ramGb" INTEGER,
    "storageGb" INTEGER,
    "networkSpeedMbps" INTEGER,
    "datacenter" TEXT,
    "region" TEXT,
    "country" TEXT,
    "pricingTierId" TEXT,
    "customProviderRateCents" INTEGER,
    "revenueSharePercent" REAL,
    "selectedPayoutModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_validation',
    "statusMessage" TEXT,
    "validatedAt" DATETIME,
    "validationError" TEXT,
    "osVersion" TEXT,
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "rejectedAt" DATETIME,
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "hostedaiPoolId" TEXT,
    "hostedaiNodeId" TEXT,
    "removalRequestedAt" DATETIME,
    "removalScheduledFor" DATETIME,
    "removalReason" TEXT,
    "removedAt" DATETIME,
    "lastHealthCheck" DATETIME,
    "healthStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderNode_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderNode_requestedGpuTypeId_fkey" FOREIGN KEY ("requestedGpuTypeId") REFERENCES "AllowedGpuType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProviderNode_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "ProviderPricingTier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProviderNode" ("approvedAt", "approvedBy", "country", "cpuCores", "cpuModel", "createdAt", "customProviderRateCents", "datacenter", "gpuCount", "gpuModel", "healthStatus", "hostedaiNodeId", "hostedaiPoolId", "hostname", "id", "ipAddress", "lastHealthCheck", "networkSpeedMbps", "osVersion", "pricingTierId", "providerId", "ramGb", "region", "rejectedAt", "rejectedBy", "rejectionReason", "removalReason", "removalRequestedAt", "removalScheduledFor", "removedAt", "revenueSharePercent", "selectedPayoutModel", "sshPort", "sshUsername", "status", "statusMessage", "storageGb", "updatedAt", "validatedAt", "validationError") SELECT "approvedAt", "approvedBy", "country", "cpuCores", "cpuModel", "createdAt", "customProviderRateCents", "datacenter", "gpuCount", "gpuModel", "healthStatus", "hostedaiNodeId", "hostedaiPoolId", "hostname", "id", "ipAddress", "lastHealthCheck", "networkSpeedMbps", "osVersion", "pricingTierId", "providerId", "ramGb", "region", "rejectedAt", "rejectedBy", "rejectionReason", "removalReason", "removalRequestedAt", "removalScheduledFor", "removedAt", "revenueSharePercent", "selectedPayoutModel", "sshPort", "sshUsername", "status", "statusMessage", "storageGb", "updatedAt", "validatedAt", "validationError" FROM "ProviderNode";
DROP TABLE "ProviderNode";
ALTER TABLE "new_ProviderNode" RENAME TO "ProviderNode";
CREATE INDEX "ProviderNode_providerId_idx" ON "ProviderNode"("providerId");
CREATE INDEX "ProviderNode_status_idx" ON "ProviderNode"("status");
CREATE INDEX "ProviderNode_pricingTierId_idx" ON "ProviderNode"("pricingTierId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
