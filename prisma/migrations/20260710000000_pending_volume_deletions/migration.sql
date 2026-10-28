-- PA-206: defer shared-storage deletion after out-of-balance termination.
-- Instead of deleting a team's shared volumes in the same sync pass that
-- terminates their pods for non-payment, sync records them here with a grace
-- window; the cleanup-expired-volumes cron removes each volume once the window
-- passes (unless the customer has recovered by then). Idempotent CREATE, matching
-- the other tables in this migration set.
CREATE TABLE IF NOT EXISTS `pending_volume_deletions` (
    `id`                 VARCHAR(191) NOT NULL,
    `volume_id`          INTEGER NOT NULL,
    `volume_name`        VARCHAR(191) NULL,
    `team_id`            VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `reason`             VARCHAR(191) NOT NULL DEFAULT 'negative_balance',
    `scheduled_for`      DATETIME(3) NOT NULL,
    `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pending_volume_deletions_volume_id_key`(`volume_id`),
    INDEX `pending_volume_deletions_scheduled_for_idx`(`scheduled_for`),
    INDEX `pending_volume_deletions_stripe_customer_id_idx`(`stripe_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
