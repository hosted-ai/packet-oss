-- CreateTable
CREATE TABLE "Investor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "assignedNodeIds" TEXT NOT NULL DEFAULT '[]',
    "revenueSharePercent" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Investor_email_key" ON "Investor"("email");

-- CreateIndex
CREATE INDEX "Investor_email_idx" ON "Investor"("email");
