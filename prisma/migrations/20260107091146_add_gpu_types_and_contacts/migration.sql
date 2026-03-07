-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN "commercialEmail" TEXT;
ALTER TABLE "ServiceProvider" ADD COLUMN "commercialPhone" TEXT;
ALTER TABLE "ServiceProvider" ADD COLUMN "generalEmail" TEXT;
ALTER TABLE "ServiceProvider" ADD COLUMN "supportEmail" TEXT;
ALTER TABLE "ServiceProvider" ADD COLUMN "supportPhone" TEXT;

-- CreateTable
CREATE TABLE "AllowedGpuType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT 'NVIDIA',
    "matchPatterns" TEXT NOT NULL,
    "defaultProviderRateCents" INTEGER NOT NULL,
    "defaultCustomerRateCents" INTEGER NOT NULL,
    "defaultTermsType" TEXT NOT NULL DEFAULT 'fixed',
    "defaultRevenueSharePercent" REAL,
    "minVramGb" INTEGER,
    "minCudaCores" INTEGER,
    "acceptingSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProviderCommercialTerms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "gpuTypeName" TEXT,
    "providerRateCents" INTEGER,
    "customerRateCents" INTEGER,
    "termsType" TEXT,
    "revenueSharePercent" REAL,
    "minGuaranteedRateCents" INTEGER,
    "notes" TEXT,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderCommercialTerms_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AllowedGpuType_name_key" ON "AllowedGpuType"("name");

-- CreateIndex
CREATE INDEX "AllowedGpuType_acceptingSubmissions_idx" ON "AllowedGpuType"("acceptingSubmissions");

-- CreateIndex
CREATE INDEX "ProviderCommercialTerms_providerId_idx" ON "ProviderCommercialTerms"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCommercialTerms_providerId_gpuTypeName_key" ON "ProviderCommercialTerms"("providerId", "gpuTypeName");
