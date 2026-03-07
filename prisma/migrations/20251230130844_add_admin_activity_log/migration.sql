-- CreateTable
CREATE TABLE "AdminActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminEmail" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdminActivityEvent_adminEmail_idx" ON "AdminActivityEvent"("adminEmail");

-- CreateIndex
CREATE INDEX "AdminActivityEvent_createdAt_idx" ON "AdminActivityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AdminActivityEvent_type_idx" ON "AdminActivityEvent"("type");
