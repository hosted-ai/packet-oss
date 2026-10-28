-- PA-361: 24h grace window before terminating monthly GPU pods on a failed
-- subscription payment. `payment_failed_at` is stamped on the first
-- invoice.payment_failed (never reset by Stripe retries), cleared on recovery,
-- and swept by the terminate-overdue-monthly cron once it is older than 24h.
-- Nullable + additive → zero-downtime. The index backs the sweep's
-- `payment_failed_at < now()-24h` scan.
ALTER TABLE `pod_metadata` ADD COLUMN `payment_failed_at` DATETIME(3) NULL;
CREATE INDEX `pod_metadata_payment_failed_at_idx` ON `pod_metadata`(`payment_failed_at`);
