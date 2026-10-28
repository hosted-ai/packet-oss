-- Company website on the KYC/billing profile (CustomerSettings). Separate from
-- the personal website (Stripe customer metadata). Idempotent: MariaDB supports
-- ADD COLUMN IF NOT EXISTS, matching the other customer_settings migrations.
ALTER TABLE `customer_settings`
  ADD COLUMN IF NOT EXISTS `company_website` VARCHAR(255) NULL;
