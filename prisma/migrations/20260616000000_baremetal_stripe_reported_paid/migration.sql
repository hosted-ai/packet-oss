-- Bare-metal payment gate: record that Stripe reported the invoice paid
-- (amount-verified webhook) WITHOUT advancing the order. An admin must then
-- explicitly confirm payment before provisioning (or cancel & refund). Additive
-- + idempotent (IF NOT EXISTS, MariaDB) so a re-run / half-applied deploy is safe.
--
-- DEPLOY: the .deb postinst runs `prisma migrate deploy` (bundled prisma-cli),
-- which applies + records this automatically.

ALTER TABLE `bare_metal_order` ADD COLUMN IF NOT EXISTS `stripe_reported_paid_at` DATETIME(3) NULL;
