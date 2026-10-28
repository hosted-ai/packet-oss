-- AlterTable: Add supports_shared_storage to gpu_product (PA-327)
-- Not every mesh node/GPU type behind a product can attach shared storage
-- (e.g. DeepGreen A100, Limestone 4090 currently cannot; DeepGreen L40s can).
-- Defaults to true to preserve current behavior; admin must explicitly
-- uncheck it per product in the Products tab for the unsupported ones.
ALTER TABLE `gpu_product` ADD COLUMN `supports_shared_storage` BOOLEAN NOT NULL DEFAULT true;
