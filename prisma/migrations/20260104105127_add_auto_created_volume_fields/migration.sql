-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PodSnapshot" (
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
    "autoCreatedVolume" BOOLEAN NOT NULL DEFAULT false,
    "storageBlockId" TEXT,
    "hfItemId" TEXT,
    "hfItemType" TEXT,
    "hfItemName" TEXT,
    "deployScript" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PodSnapshot" ("createdAt", "deployScript", "displayName", "hfItemId", "hfItemName", "hfItemType", "id", "imageUuid", "instanceTypeId", "notes", "originalSubscriptionId", "persistentVolumeId", "persistentVolumeName", "persistentVolumeSize", "poolId", "poolName", "regionId", "snapshotType", "stripeCustomerId", "updatedAt", "vgpus") SELECT "createdAt", "deployScript", "displayName", "hfItemId", "hfItemName", "hfItemType", "id", "imageUuid", "instanceTypeId", "notes", "originalSubscriptionId", "persistentVolumeId", "persistentVolumeName", "persistentVolumeSize", "poolId", "poolName", "regionId", "snapshotType", "stripeCustomerId", "updatedAt", "vgpus" FROM "PodSnapshot";
DROP TABLE "PodSnapshot";
ALTER TABLE "new_PodSnapshot" RENAME TO "PodSnapshot";
CREATE INDEX "PodSnapshot_stripeCustomerId_idx" ON "PodSnapshot"("stripeCustomerId");
CREATE INDEX "PodSnapshot_snapshotType_idx" ON "PodSnapshot"("snapshotType");
CREATE INDEX "PodSnapshot_createdAt_idx" ON "PodSnapshot"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
