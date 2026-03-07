-- AlterTable
ALTER TABLE "ProviderNode" ADD COLUMN "selectedPayoutModel" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AllowedGpuType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT 'NVIDIA',
    "matchPatterns" TEXT NOT NULL,
    "defaultProviderRateCents" INTEGER NOT NULL,
    "defaultCustomerRateCents" INTEGER NOT NULL,
    "defaultTermsType" TEXT NOT NULL DEFAULT 'fixed',
    "defaultRevenueSharePercent" REAL,
    "payoutModelChoice" TEXT NOT NULL DEFAULT 'fixed_only',
    "minVramGb" INTEGER,
    "minCudaCores" INTEGER,
    "acceptingSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AllowedGpuType" ("acceptingSubmissions", "createdAt", "defaultCustomerRateCents", "defaultProviderRateCents", "defaultRevenueSharePercent", "defaultTermsType", "displayOrder", "id", "manufacturer", "matchPatterns", "minCudaCores", "minVramGb", "name", "shortName", "updatedAt") SELECT "acceptingSubmissions", "createdAt", "defaultCustomerRateCents", "defaultProviderRateCents", "defaultRevenueSharePercent", "defaultTermsType", "displayOrder", "id", "manufacturer", "matchPatterns", "minCudaCores", "minVramGb", "name", "shortName", "updatedAt" FROM "AllowedGpuType";
DROP TABLE "AllowedGpuType";
ALTER TABLE "new_AllowedGpuType" RENAME TO "AllowedGpuType";
CREATE UNIQUE INDEX "AllowedGpuType_name_key" ON "AllowedGpuType"("name");
CREATE INDEX "AllowedGpuType_acceptingSubmissions_idx" ON "AllowedGpuType"("acceptingSubmissions");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
