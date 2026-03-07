-- CreateTable
CREATE TABLE "AdminStatsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "totalCustomers" INTEGER NOT NULL,
    "activeGPUs" INTEGER NOT NULL,
    "mrrCents" INTEGER NOT NULL,
    "newThisWeek" INTEGER NOT NULL,
    "revenueWeekCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminStatsSnapshot_date_key" ON "AdminStatsSnapshot"("date");
