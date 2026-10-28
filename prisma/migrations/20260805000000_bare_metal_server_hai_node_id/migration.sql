-- AlterTable: Add hai_node_id to bare_metal_server (PA-688)
--
-- The PHYSICAL HAI baremetal node backing a fulfillment
-- (baremetal_subscriptions.node_id in HAI, same id space as the admin
-- /baremetal/node inventory). Until now Packet only stored the HAI
-- subscription id, so an order could not be tied to hardware — which makes
-- "which customers used THIS server, over which periods" unanswerable.
--
-- Nullable by necessity: no node is assigned while an order is still
-- Requested, and for some already-terminated legacy orders the id may not be
-- recoverable at all (HAI soft-deletes subscriptions; the audit-log backfill
-- covers most but not guaranteed all).
--
-- Indexed because the investor bare-metal timeline groups server rows by node.
ALTER TABLE `bare_metal_server` ADD COLUMN `hai_node_id` INTEGER NULL;

CREATE INDEX `bare_metal_server_hai_node_id_idx` ON `bare_metal_server`(`hai_node_id`);
