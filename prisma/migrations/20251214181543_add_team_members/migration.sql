-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "stripeCustomerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "invitedBy" TEXT
);

-- CreateIndex
CREATE INDEX "TeamMember_email_idx" ON "TeamMember"("email");

-- CreateIndex
CREATE INDEX "TeamMember_stripeCustomerId_idx" ON "TeamMember"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_email_stripeCustomerId_key" ON "TeamMember"("email", "stripeCustomerId");
