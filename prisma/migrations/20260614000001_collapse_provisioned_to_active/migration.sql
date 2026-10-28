-- Phase 1 (bare-metal lifecycle): collapse the `provisioned` order status into
-- `active`. `provisioned` was a no-value admin sub-step (SSH captured but "not
-- yet blessed"); activation now happens in one step via activateOrder(). Migrate
-- existing rows forward so no order is left in the retired status.

UPDATE `bare_metal_order` SET `status` = 'active' WHERE `status` = 'provisioned';
