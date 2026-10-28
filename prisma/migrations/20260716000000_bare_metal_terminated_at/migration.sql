-- PA-316: stamp the moment a bare-metal order transitions to "terminated" so
-- the customer Timeline and admin Provisioning views can show a real
-- termination date instead of only the creation date. Nullable + additive →
-- zero-downtime.

ALTER TABLE `bare_metal_order` ADD COLUMN `terminated_at` DATETIME NULL;
