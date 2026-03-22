-- AlterTable: add hfToken to HuggingFaceDeployment
ALTER TABLE `hugging_face_deployment` ADD COLUMN `hf_token` VARCHAR(191) NULL;

-- AlterTable: add bareMetalEnabled to CustomerSettings
ALTER TABLE `customer_settings` ADD COLUMN `bare_metal_enabled` BOOLEAN NOT NULL DEFAULT false;
