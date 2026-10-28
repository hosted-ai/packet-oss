-- Phase 1 (bare-metal lifecycle): KYC / billing profile fields.
--
-- Legal/finance mandate — a customer must have full name + address + company
-- details (or "N/A") before ordering bare metal. Stored on customer_settings
-- keyed by stripe_customer_id (the OPERATING ACCOUNT), replacing the fragile
-- company-in-Stripe-metadata store that caused PA-231 (read/write account
-- mismatch + metadata size/merge limits). All nullable + additive →
-- zero-downtime. company_name supersedes the legacy customer.metadata.company.

ALTER TABLE `customer_settings` ADD COLUMN `personal_address` TEXT NULL;
ALTER TABLE `customer_settings` ADD COLUMN `country` VARCHAR(2) NULL;
ALTER TABLE `customer_settings` ADD COLUMN `zip_code` VARCHAR(20) NULL;
ALTER TABLE `customer_settings` ADD COLUMN `company_name` VARCHAR(255) NULL;
ALTER TABLE `customer_settings` ADD COLUMN `company_address` TEXT NULL;
ALTER TABLE `customer_settings` ADD COLUMN `company_reg_number` VARCHAR(100) NULL;
