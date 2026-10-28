-- Region maintenance mode. Additive + idempotent (IF NOT EXISTS, MariaDB) so a
-- half-applied window or a re-run is safe → zero-downtime. region_id is the PK,
-- so one-row-per-region is DB-enforced (no sentinel, no dup rows).
--
-- DEPLOY (staging/prod have no Node — apply this SQL by hand, then record it):
--   1. mysql <db> < migration.sql            # idempotent, safe to re-run
--   2. Record it so `prisma migrate status`/`deploy` sees it applied and does
--      NOT try to re-create the table later (avoids Prisma history drift):
--        INSERT INTO `_prisma_migrations`
--          (`id`,`checksum`,`finished_at`,`migration_name`,`started_at`,`applied_steps_count`)
--        VALUES (UUID(), SHA2(LOAD_FILE('<abs path>/migration.sql'),256), NOW(3),
--                '20260614000003_region_maintenance', NOW(3), 1);
--      (If LOAD_FILE is blocked, compute the sha256 of this file and paste it.)
--   3. Apply BEFORE deploying app code. Code-before-migration would make the
--      maintenance resolver query a missing table → it fails OPEN → every region
--      looks healthy during the window. Verify the table exists before flipping
--      the maintenance switch.

CREATE TABLE IF NOT EXISTS `region_maintenance` (
    `region_id` INTEGER NOT NULL,
    `region_name` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `enabled_by` VARCHAR(191) NOT NULL,
    `enabled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`region_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One-shot "order held by region maintenance" ops alarm (reset on successful
-- provision so a future hold re-alerts). Matches the existing *_alerted_at columns.
ALTER TABLE `bare_metal_order` ADD COLUMN IF NOT EXISTS `maintenance_held_alerted_at` DATETIME(3) NULL;
