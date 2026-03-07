-- SQLite does not support ALTER COLUMN TYPE, so we need to recreate the table
-- First create new table with REAL (Float) columns

CREATE TABLE "_InferenceServerUsage_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "inputTokens" BIGINT NOT NULL,
    "outputTokens" BIGINT NOT NULL,
    "totalTokens" BIGINT NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "customerRevenueCents" REAL NOT NULL,
    "providerEarningsCents" REAL NOT NULL,
    "packetMarginCents" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InferenceServerUsage_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "InferenceServer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy data from old table (INT will be automatically converted to REAL)
INSERT INTO "_InferenceServerUsage_new" SELECT * FROM "InferenceServerUsage";

-- Drop old table
DROP TABLE "InferenceServerUsage";

-- Rename new table
ALTER TABLE "_InferenceServerUsage_new" RENAME TO "InferenceServerUsage";

-- Recreate indexes
CREATE INDEX "InferenceServerUsage_serverId_periodStart_idx" ON "InferenceServerUsage"("serverId", "periodStart");
CREATE INDEX "InferenceServerUsage_providerId_periodStart_idx" ON "InferenceServerUsage"("providerId", "periodStart");
