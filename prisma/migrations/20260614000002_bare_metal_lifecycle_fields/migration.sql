-- Phase 2 (bare-metal lifecycle): contract-end date + reminder/alert flags +
-- the cancellation/refund record (ops-entered amount, record-only — finance
-- moves money out-of-band). All nullable + additive → zero-downtime.

ALTER TABLE `bare_metal_order` ADD COLUMN `expires_at` DATETIME NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `last_termination_reminder_on` DATETIME NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `expiry_alerted_at` DATETIME NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `termination_reason` TEXT NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `cancelled_at` DATETIME NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `refund_amount_cents` INTEGER NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `refund_reason` TEXT NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `refund_reference` VARCHAR(191) NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `refunded_at` DATETIME NULL;
ALTER TABLE `bare_metal_order` ADD COLUMN `refund_aging_alerted_at` DATETIME NULL;

CREATE INDEX `bare_metal_order_expires_at_idx` ON `bare_metal_order`(`expires_at`);

-- Backfill expires_at for already-active orders. COALESCE fallback because an
-- order reaching active via the manual mark_provisioned path may have a NULL
-- provisioned_date; fall back to payment date, then last-touch. DATE_ADD clamps
-- to the last day of the target month (MySQL/MariaDB semantics).
UPDATE `bare_metal_order`
  SET `expires_at` = DATE_ADD(COALESCE(`provisioned_date`, `payment_received_date`, `updated_at`), INTERVAL `contract_months` MONTH)
  WHERE `status` = 'active' AND `expires_at` IS NULL;
