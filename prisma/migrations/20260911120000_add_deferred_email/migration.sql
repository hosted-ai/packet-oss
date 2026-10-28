-- A provider quota/rate refusal only clears at the provider's reset, so the
-- message is parked here instead of being burned through in-process retries
-- and dropped. The resend-deferred-email cron drains rows whose
-- `next_attempt_at` has passed. Idempotent CREATE, matching the other tables.
CREATE TABLE IF NOT EXISTS `deferred_email` (
    `id`              VARCHAR(191) NOT NULL,
    `to`              VARCHAR(191) NOT NULL,
    `subject`         VARCHAR(191) NOT NULL,
    `html`            TEXT NOT NULL,
    `text`            TEXT NOT NULL,
    `reply_to`        VARCHAR(191) NULL,
    `attachments`     TEXT NULL,
    `status`          VARCHAR(191) NOT NULL DEFAULT 'deferred',
    `attempts`        INTEGER NOT NULL DEFAULT 1,
    `last_error`      TEXT NULL,
    `next_attempt_at` DATETIME(3) NOT NULL,
    `sent_at`         DATETIME(3) NULL,
    `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deferred_email_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
