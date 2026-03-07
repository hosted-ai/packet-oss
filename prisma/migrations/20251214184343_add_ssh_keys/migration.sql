-- CreateTable
CREATE TABLE "SSHKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stripeCustomerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SSHKey_stripeCustomerId_idx" ON "SSHKey"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "SSHKey_stripeCustomerId_fingerprint_key" ON "SSHKey"("stripeCustomerId", "fingerprint");
