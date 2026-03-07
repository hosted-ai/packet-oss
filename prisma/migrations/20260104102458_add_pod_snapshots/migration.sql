-- CreateTable
CREATE TABLE "PodSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stripeCustomerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "notes" TEXT,
    "snapshotType" TEXT NOT NULL DEFAULT 'template',
    "originalSubscriptionId" TEXT,
    "poolId" TEXT NOT NULL,
    "poolName" TEXT,
    "regionId" TEXT,
    "vgpus" INTEGER NOT NULL,
    "instanceTypeId" TEXT,
    "imageUuid" TEXT,
    "persistentVolumeId" INTEGER,
    "persistentVolumeName" TEXT,
    "persistentVolumeSize" INTEGER,
    "hfItemId" TEXT,
    "hfItemType" TEXT,
    "hfItemName" TEXT,
    "deployScript" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PodSnapshot_stripeCustomerId_idx" ON "PodSnapshot"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "PodSnapshot_snapshotType_idx" ON "PodSnapshot"("snapshotType");

-- CreateIndex
CREATE INDEX "PodSnapshot_createdAt_idx" ON "PodSnapshot"("createdAt");
