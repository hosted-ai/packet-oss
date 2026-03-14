-- AlterTable: Add instance_id to pod_metadata (HostedAI 2.2 unified instance UUID)
ALTER TABLE `pod_metadata` ADD COLUMN `instance_id` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `pod_metadata_instance_id_key` ON `pod_metadata`(`instance_id`);

-- AlterTable: Add service_id to gpu_product (HostedAI 2.2 service-based provisioning)
ALTER TABLE `gpu_product` ADD COLUMN `service_id` VARCHAR(191) NULL;
