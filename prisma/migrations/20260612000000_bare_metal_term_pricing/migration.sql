-- Bare-metal product form rework (user feedback 2026-06-12):
--  * Per-term pricing: `term_pricing` JSON [{months, priceCents}] replaces
--    monthly_price_cents + allowed_term_months. priceCents is the TOTAL
--    server price for the term (finance quotes term totals; integer monthly
--    cents can't express e.g. "$70k for 3 months").
--  * Instance type + image columns dropped — locked in the HAI service, the
--    provision payload never sends them.
--  * Orders snapshot the chosen term's total as term_price_cents.
-- Existing rows are dev/test data only (feature unreleased): products are
-- converted to a single 1-month term at the old monthly price; orders get
-- term_price_cents = monthly * months.

-- BareMetalProduct
ALTER TABLE `bare_metal_product` ADD COLUMN `term_pricing` TEXT NULL;
UPDATE `bare_metal_product`
SET `term_pricing` = CONCAT('[{"months":1,"priceCents":', `monthly_price_cents`, '}]');
ALTER TABLE `bare_metal_product` MODIFY COLUMN `term_pricing` TEXT NOT NULL;
ALTER TABLE `bare_metal_product` DROP COLUMN `monthly_price_cents`;
ALTER TABLE `bare_metal_product` DROP COLUMN `allowed_term_months`;
ALTER TABLE `bare_metal_product` DROP COLUMN `hai_instance_type_id`;
ALTER TABLE `bare_metal_product` DROP COLUMN `hai_image_hash`;

-- BareMetalOrder
ALTER TABLE `bare_metal_order` ADD COLUMN `term_price_cents` INTEGER NULL;
UPDATE `bare_metal_order`
SET `term_price_cents` = `monthly_price_cents` * `contract_months`;
ALTER TABLE `bare_metal_order` MODIFY COLUMN `term_price_cents` INTEGER NOT NULL;
ALTER TABLE `bare_metal_order` DROP COLUMN `monthly_price_cents`;
ALTER TABLE `bare_metal_order` DROP COLUMN `hai_instance_type_id`;
ALTER TABLE `bare_metal_order` DROP COLUMN `hai_image_hash`;
