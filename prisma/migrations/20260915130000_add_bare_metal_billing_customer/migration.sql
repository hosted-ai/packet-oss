-- Bare metal split the customer column in two: `stripe_customer_id` keeps
-- ownership (every dashboard and inventory filter reads it) and
-- `billing_customer_id` carries the wallet the hourly cron charges.
-- The backfill copies ownership into billing, so every live node and volume
-- keeps billing exactly where it does today. Nullable and additive → zero
-- downtime, and the readers fall back to `stripe_customer_id` regardless.
ALTER TABLE `spheron_deployment`
    ADD COLUMN `billing_customer_id` VARCHAR(191) NULL;

ALTER TABLE `spheron_volume`
    ADD COLUMN `billing_customer_id` VARCHAR(191) NULL;

UPDATE `spheron_deployment` SET `billing_customer_id` = `stripe_customer_id`;

UPDATE `spheron_volume` SET `billing_customer_id` = `stripe_customer_id`;
