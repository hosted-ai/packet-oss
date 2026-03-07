-- CreateTable
CREATE TABLE "TwoFactorAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "backupCodes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorAuth_email_key" ON "TwoFactorAuth"("email");

-- CreateIndex
CREATE INDEX "TwoFactorAuth_email_idx" ON "TwoFactorAuth"("email");
