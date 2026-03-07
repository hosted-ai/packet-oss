-- CreateTable
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "verifiedBy" TEXT,
    "estimatedGpuCount" INTEGER,
    "gpuTypes" TEXT,
    "regions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suspendedReason" TEXT,
    "terminatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProviderNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL DEFAULT 'root',
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
    CONSTRAINT "ProviderNode_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "ProviderPricingTier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderPricingTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "gpuModel" TEXT NOT NULL,
    "providerRateCents" INTEGER NOT NULL,
    "customerRateCents" INTEGER NOT NULL,
    "isRevenueShare" BOOLEAN NOT NULL DEFAULT false,
    "revenueSharePercent" REAL,
    "minProviderRateCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProviderNodeUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nodeId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "totalHours" REAL NOT NULL,
    "occupiedHours" REAL NOT NULL,
    "utilizationPercent" REAL,
    "customerRevenueCents" INTEGER NOT NULL,
    "providerEarningsCents" INTEGER NOT NULL,
    "packetMarginCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderNodeUsage_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ProviderNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "grossEarningsCents" INTEGER NOT NULL,
    "deductionsCents" INTEGER NOT NULL DEFAULT 0,
    "netPayoutCents" INTEGER NOT NULL,
    "breakdown" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedAt" DATETIME,
    "paidAt" DATETIME,
    "transactionRef" TEXT,
    "failureReason" TEXT,
    "invoiceNumber" TEXT,
    "invoiceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderPayout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "nodeId" TEXT,
    "payoutId" TEXT,
    "metadata" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderNotification_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderAdminActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "providerId" TEXT,
    "nodeId" TEXT,
    "payoutId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_email_key" ON "ServiceProvider"("email");

-- CreateIndex
CREATE INDEX "ServiceProvider_status_idx" ON "ServiceProvider"("status");

-- CreateIndex
CREATE INDEX "ServiceProvider_email_idx" ON "ServiceProvider"("email");

-- CreateIndex
CREATE INDEX "ProviderNode_providerId_idx" ON "ProviderNode"("providerId");

-- CreateIndex
CREATE INDEX "ProviderNode_status_idx" ON "ProviderNode"("status");

-- CreateIndex
CREATE INDEX "ProviderNode_pricingTierId_idx" ON "ProviderNode"("pricingTierId");

-- CreateIndex
CREATE INDEX "ProviderPricingTier_gpuModel_idx" ON "ProviderPricingTier"("gpuModel");

-- CreateIndex
CREATE INDEX "ProviderPricingTier_active_idx" ON "ProviderPricingTier"("active");

-- CreateIndex
CREATE INDEX "ProviderNodeUsage_nodeId_periodStart_idx" ON "ProviderNodeUsage"("nodeId", "periodStart");

-- CreateIndex
CREATE INDEX "ProviderNodeUsage_periodStart_idx" ON "ProviderNodeUsage"("periodStart");

-- CreateIndex
CREATE INDEX "ProviderPayout_providerId_idx" ON "ProviderPayout"("providerId");

-- CreateIndex
CREATE INDEX "ProviderPayout_status_idx" ON "ProviderPayout"("status");

-- CreateIndex
CREATE INDEX "ProviderPayout_periodStart_idx" ON "ProviderPayout"("periodStart");

-- CreateIndex
CREATE INDEX "ProviderNotification_providerId_idx" ON "ProviderNotification"("providerId");

-- CreateIndex
CREATE INDEX "ProviderNotification_type_idx" ON "ProviderNotification"("type");

-- CreateIndex
CREATE INDEX "ProviderNotification_sentAt_idx" ON "ProviderNotification"("sentAt");

-- CreateIndex
CREATE INDEX "ProviderAdminActivity_adminEmail_idx" ON "ProviderAdminActivity"("adminEmail");

-- CreateIndex
CREATE INDEX "ProviderAdminActivity_providerId_idx" ON "ProviderAdminActivity"("providerId");

-- CreateIndex
CREATE INDEX "ProviderAdminActivity_action_idx" ON "ProviderAdminActivity"("action");

-- CreateIndex
CREATE INDEX "ProviderAdminActivity_createdAt_idx" ON "ProviderAdminActivity"("createdAt");
