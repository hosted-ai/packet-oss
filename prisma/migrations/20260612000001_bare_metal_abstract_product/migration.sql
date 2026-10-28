-- Products are abstract, not region-specific (user decision 2026-06-12):
--  * Drop product region + hai_region_id — the region is purely an order-time
--    choice from HAI's live compatible regions (the order keeps its own
--    region snapshot).
--  * Add optional hai_instance_type_id / hai_image_id provisioning overrides:
--    HAI bugs currently prevent locking instance type + image on
--    baremetal_gpu services (unlike GPU products), so when set these are
--    sent to POST /baremetal/instances (instance_type_id / image_id).

ALTER TABLE `bare_metal_product` DROP COLUMN `region`;
ALTER TABLE `bare_metal_product` DROP COLUMN `hai_region_id`;
ALTER TABLE `bare_metal_product` ADD COLUMN `hai_instance_type_id` INTEGER NULL;
ALTER TABLE `bare_metal_product` ADD COLUMN `hai_image_id` INTEGER NULL;
