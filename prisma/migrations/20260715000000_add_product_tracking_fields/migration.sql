-- Add product name snapshot and provisioning timestamp to pod_metadata
ALTER TABLE `pod_metadata` ADD COLUMN `product_name` VARCHAR(191) NULL;
ALTER TABLE `pod_metadata` ADD COLUMN `provisioning_completed_at` DATETIME(3) NULL;

-- Add product tracking fields to customer_lifecycle
ALTER TABLE `customer_lifecycle` ADD COLUMN `first_product_name` VARCHAR(191) NULL;
ALTER TABLE `customer_lifecycle` ADD COLUMN `latest_product_name` VARCHAR(191) NULL;
ALTER TABLE `customer_lifecycle` ADD COLUMN `first_product_provisioned_at` DATETIME(3) NULL;
ALTER TABLE `customer_lifecycle` ADD COLUMN `latest_product_provisioned_at` DATETIME(3) NULL;
