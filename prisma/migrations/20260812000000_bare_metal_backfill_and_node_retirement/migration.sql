-- PA-819 / PA-828: backfill already-handed-over bare metal orders, and retire
-- nodes without deleting them.
--
-- Both are source-record fixes for the investor dashboard: servers that are live
-- in customers' hands but were never fully recorded in Packet (so their revenue
-- is missing), and nodes whose only route to "retired" today is being deleted
-- from the HAI admin panel (the record the dashboard reads from).

-- AlterTable: payment recorded by admin override (PA-821).
--
-- Set when an admin marks an invoice paid WITHOUT Stripe verification passing —
-- the customer genuinely paid but reconciliation never completed (e.g. ~$35 of
-- bank fees deducted from the wire, so amount_paid never matched amount_due).
-- Nullable: only override-paid orders carry it, which is exactly what makes an
-- overridden payment distinguishable from a normally-reconciled one.
--
-- The actor, the Stripe invoice state at override time, and old/new values live
-- in admin_activity_event (type "baremetal_payment_override") — this column is
-- only the marker.
ALTER TABLE `bare_metal_order` ADD COLUMN `payment_override_at` DATETIME(3) NULL;

-- AlterTable: order activated through the admin backfill flow (PA-822).
--
-- Distinguishes an order recorded after the fact (hardware already with the
-- customer, real backdated handover dates, no handover email) from one that went
-- through normal provisioning. Drives the "Backfilled" badge in the admin panel
-- and makes the population auditable later.
ALTER TABLE `bare_metal_order` ADD COLUMN `backfilled_at` DATETIME(3) NULL;

-- CreateTable: explicitly retired HAI baremetal nodes (PA-828).
--
-- A marker row, not a copy of any state: the node stays in HAI inventory (so it
-- can be firmware-refreshed and resold) while the investor dashboard reports it
-- as retired. Revenue is derived from bare_metal_order rows, so retiring a node
-- cannot change its historical figures.
--
-- hai_node_id is the PRIMARY KEY: one retirement per node, DB-enforced.
-- Un-retiring is deleting the row.
CREATE TABLE `retired_bare_metal_node` (
    `hai_node_id` INTEGER NOT NULL,
    `node_name` VARCHAR(191) NULL,
    `retired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `retired_by` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,

    PRIMARY KEY (`hai_node_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
