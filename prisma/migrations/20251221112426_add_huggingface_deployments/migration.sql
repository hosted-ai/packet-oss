-- CreateTable
CREATE TABLE "HuggingFaceDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "hfItemId" TEXT NOT NULL,
    "hfItemType" TEXT NOT NULL,
    "hfItemName" TEXT NOT NULL,
    "deployScript" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deployOutput" TEXT,
    "servicePort" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "HuggingFaceDeployment_stripeCustomerId_idx" ON "HuggingFaceDeployment"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "HuggingFaceDeployment_subscriptionId_idx" ON "HuggingFaceDeployment"("subscriptionId");

-- CreateIndex
CREATE INDEX "HuggingFaceDeployment_status_idx" ON "HuggingFaceDeployment"("status");
