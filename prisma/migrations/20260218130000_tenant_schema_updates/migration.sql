-- Fields added to Tenant after initial migration
ALTER TABLE "Tenant" ADD COLUMN "apiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "webhookUrl" TEXT;
CREATE UNIQUE INDEX "Tenant_apiKey_key" ON "Tenant"("apiKey");

-- Fields added to TenantCustomer
ALTER TABLE "TenantCustomer" ADD COLUMN "name" TEXT;
ALTER TABLE "TenantCustomer" ADD COLUMN "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "TenantCustomer_tenantId_email_key" ON "TenantCustomer"("tenantId", "email");

-- Domain verification
ALTER TABLE "TenantDomain" ADD COLUMN "verifiedAt" DATETIME;

-- WebhookEvent tracking
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusCode" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME
);
CREATE INDEX "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");
CREATE INDEX "WebhookEvent_event_idx" ON "WebhookEvent"("event");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- TenantDripTemplate for customizable drip emails
CREATE TABLE "TenantDripTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantDripTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TenantDripTemplate_tenantId_emailType_key" ON "TenantDripTemplate"("tenantId", "emailType");
CREATE INDEX "TenantDripTemplate_tenantId_idx" ON "TenantDripTemplate"("tenantId");
