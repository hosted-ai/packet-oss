-- CreateTable
CREATE TABLE "SupportNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "lastMessageId" INTEGER NOT NULL,
    "lastMessageAt" DATETIME NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SupportNotification_chatId_idx" ON "SupportNotification"("chatId");

-- CreateIndex
CREATE INDEX "SupportNotification_stripeCustomerId_idx" ON "SupportNotification"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportNotification_chatId_lastMessageId_key" ON "SupportNotification"("chatId", "lastMessageId");
