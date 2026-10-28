-- PA-359: admin-only internal notes on the account (KYC-step progress etc.).
-- Distinct from the customer-visible instance notes (pod_metadata.notes) and
-- never returned to customer-facing endpoints. Idempotent: MariaDB supports
-- ADD COLUMN IF NOT EXISTS, matching the other customer_settings migrations.
ALTER TABLE `customer_settings`
  ADD COLUMN IF NOT EXISTS `internal_notes` TEXT NULL;
