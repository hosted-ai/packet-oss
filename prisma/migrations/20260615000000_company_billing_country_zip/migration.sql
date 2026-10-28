-- Company billing address: country + postal/ZIP, alongside the existing
-- company_address string (bare-metal KYC / invoicing). Additive + idempotent
-- (IF NOT EXISTS, MariaDB) so a re-run or half-applied deploy is safe →
-- zero-downtime. Both columns are NULLABLE and OPTIONAL (deliberately NOT added
-- to the bare-metal required-profile gate), so customers whose profiles were
-- already complete stay complete and are not re-blocked from ordering.
--
-- DEPLOY: the .deb postinst runs `prisma migrate deploy` (bundled prisma-cli),
-- which applies + records this automatically. If hand-applying on a Node-less
-- box, run the SQL then insert the matching `_prisma_migrations` row.

ALTER TABLE `customer_settings` ADD COLUMN IF NOT EXISTS `company_country` VARCHAR(2) NULL;
ALTER TABLE `customer_settings` ADD COLUMN IF NOT EXISTS `company_zip_code` VARCHAR(20) NULL;
