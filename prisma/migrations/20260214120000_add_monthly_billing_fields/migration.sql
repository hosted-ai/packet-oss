-- AlterTable
ALTER TABLE "PodMetadata" ADD COLUMN "billingType" TEXT;
ALTER TABLE "PodMetadata" ADD COLUMN "stripeSubscriptionId" TEXT;

-- CreateIndex
CREATE INDEX "PodMetadata_stripeSubscriptionId_idx" ON "PodMetadata"("stripeSubscriptionId");
