-- CreateTable: Tenant
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "brandName" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "faviconUrl" TEXT,
    "ogImageUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1a4fff',
    "accentColor" TEXT NOT NULL DEFAULT '#18b6a8',
    "bgColor" TEXT NOT NULL DEFAULT '#f7f8fb',
    "textColor" TEXT NOT NULL DEFAULT '#0b0f1c',
    "customCss" TEXT,
    "stripeSecretKey" TEXT NOT NULL DEFAULT '',
    "stripePublishableKey" TEXT NOT NULL DEFAULT '',
    "stripeWebhookSecret" TEXT NOT NULL DEFAULT '',
    "wholesaleCustomerId" TEXT,
    "signupCreditCents" INTEGER NOT NULL DEFAULT 0,
    "billingModels" TEXT NOT NULL DEFAULT 'hourly,monthly',
    "supportEmail" TEXT NOT NULL DEFAULT '',
    "supportUrl" TEXT,
    "statusPageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "alertWebhookUrl" TEXT,
    "leadWebhookUrl" TEXT,
    "analyticsId" TEXT,
    "dripEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "adminDomains" TEXT NOT NULL DEFAULT 'hosted.ai,packet.ai',
    "allowedGpuTypes" TEXT NOT NULL DEFAULT 'rtx-pro-6000,b200,h200',
    "maxConcurrentGpus" INTEGER,
    "cliName" TEXT,
    "cliDownloadUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateTable: TenantDomain
CREATE TABLE "TenantDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantDomain_domain_key" ON "TenantDomain"("domain");
CREATE INDEX "TenantDomain_domain_idx" ON "TenantDomain"("domain");

-- CreateTable: TenantGpuPricing
CREATE TABLE "TenantGpuPricing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "gpuType" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "monthlyRateCents" INTEGER,
    "wholesaleCostCents" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TenantGpuPricing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantGpuPricing_tenantId_gpuType_key" ON "TenantGpuPricing"("tenantId", "gpuType");

-- CreateTable: TenantCustomer
CREATE TABLE "TenantCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    CONSTRAINT "TenantCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantCustomer_tenantId_stripeCustomerId_key" ON "TenantCustomer"("tenantId", "stripeCustomerId");
CREATE INDEX "TenantCustomer_tenantId_idx" ON "TenantCustomer"("tenantId");

-- AddColumn: tenantId to existing models
ALTER TABLE "ActivityEvent" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "TeamMember" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "PodMetadata" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "VoucherRedemption" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CustomerSettings" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CustomerLifecycle" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "DripEnrollment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- CreateIndex: tenantId indexes on existing models
CREATE INDEX "ActivityEvent_tenantId_idx" ON "ActivityEvent"("tenantId");
CREATE INDEX "TeamMember_tenantId_idx" ON "TeamMember"("tenantId");
CREATE INDEX "PodMetadata_tenantId_idx" ON "PodMetadata"("tenantId");
CREATE INDEX "VoucherRedemption_tenantId_idx" ON "VoucherRedemption"("tenantId");
CREATE INDEX "CustomerSettings_tenantId_idx" ON "CustomerSettings"("tenantId");
CREATE INDEX "CustomerLifecycle_tenantId_idx" ON "CustomerLifecycle"("tenantId");
CREATE INDEX "DripEnrollment_tenantId_idx" ON "DripEnrollment"("tenantId");
