-- Multi-server bare-metal orders: a product/order can provision N HAI instances
-- (HAI `quantity`), each an independent fulfillment with its own SSH. Adds a
-- child table (one row per HAI instance) + server_count on product & order, and
-- backfills one server row per already-provisioned order from its scalar columns.
-- Additive + idempotent (IF NOT EXISTS, MariaDB; backfill skips orders that
-- already have a server row) so a re-run / re-synced DB is safe.
--
-- The order's scalar ssh/hai* columns are intentionally KEPT this release as the
-- denormalised "primary instance" (server[0]) fallback during rollout.
--
-- DEPLOY: the .deb postinst runs `prisma migrate deploy` (bundled prisma-cli).

ALTER TABLE `bare_metal_product` ADD COLUMN IF NOT EXISTS `server_count` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `bare_metal_order`   ADD COLUMN IF NOT EXISTS `server_count` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS `bare_metal_server` (
  `id`                  VARCHAR(191) NOT NULL,
  `order_id`            VARCHAR(191) NOT NULL,
  `hai_subscription_id` VARCHAR(191) NULL,
  `hai_instance_id`     VARCHAR(191) NULL,
  `label`               VARCHAR(191) NULL,
  `sequence`            INTEGER NOT NULL DEFAULT 1,
  `status`              VARCHAR(191) NOT NULL DEFAULT 'Requested',
  `ip_address`          VARCHAR(191) NULL,
  `ssh_user`            VARCHAR(191) NULL,
  `ssh_port`            INTEGER NULL,
  `ssh_command`         VARCHAR(191) NULL,
  `hostname`            VARCHAR(191) NULL,
  `provisioned_date`    DATETIME(3) NULL,
  `provision_error`     TEXT NULL,
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `bare_metal_server_order_id_idx` (`order_id`),
  CONSTRAINT `bare_metal_server_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `bare_metal_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill one server row per already-provisioned order (idempotent: skips any
-- order that already has a server row). Pre-provision orders get their rows
-- created by the provisioning engine when they provision.
INSERT INTO `bare_metal_server`
  (`id`, `order_id`, `hai_subscription_id`, `hai_instance_id`, `label`, `sequence`,
   `status`, `ip_address`, `ssh_user`, `ssh_port`, `ssh_command`, `hostname`,
   `provisioned_date`, `created_at`, `updated_at`)
SELECT
  UUID(), o.`id`, o.`hai_subscription_id`, o.`hai_instance_id`,
  CONCAT(o.`invoice_number`, '-1'), 1,
  CASE WHEN o.`status` = 'active' THEN 'Active' ELSE 'Requested' END,
  o.`ip_address`, o.`ssh_user`, o.`ssh_port`, o.`ssh_command`, o.`hostname`,
  o.`provisioned_date`, NOW(3), NOW(3)
FROM `bare_metal_order` o
WHERE (o.`hai_subscription_id` IS NOT NULL OR o.`ip_address` IS NOT NULL
       OR o.`status` IN ('active', 'expired', 'terminated', 'provisioning'))
  AND NOT EXISTS (SELECT 1 FROM `bare_metal_server` s WHERE s.`order_id` = o.`id`);
