-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReferralClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referralCodeId" TEXT NOT NULL,
    "refereeCustomerId" TEXT NOT NULL,
    "refereeEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qualifiedAt" DATETIME,
    "creditedAt" DATETIME,
    "referrerCredited" BOOLEAN NOT NULL DEFAULT false,
    "refereeCredited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralClaim_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_stripeCustomerId_key" ON "ReferralCode"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "ReferralCode_stripeCustomerId_idx" ON "ReferralCode"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "ReferralCode_code_idx" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralClaim_referralCodeId_idx" ON "ReferralClaim"("referralCodeId");

-- CreateIndex
CREATE INDEX "ReferralClaim_status_idx" ON "ReferralClaim"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralClaim_refereeCustomerId_key" ON "ReferralClaim"("refereeCustomerId");
