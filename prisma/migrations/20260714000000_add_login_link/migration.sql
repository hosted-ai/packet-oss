-- PA-380: single-use, short-lived sign-in / invitation links.
--
-- Backs the emailed magic link (/dashboard?token=<jwt>). The JWT carries a random
-- `jti` whose sha256 is stored in `token_hash`; this row is the server-side
-- authority the stateless JWT lacked:
--   * `expires_at`   — short validity window (JWT `exp` mirrors it)
--   * `superseded_at`— set on prior live rows for the same email+account when a
--                      newer link is issued (issuing a new link invalidates old ones)
--   * `consumed_at`  — set once the link establishes a session (single-use)
--
-- INERT until the login-link mint/verify code ships in the same release — no
-- existing code reads this table, so the table itself is safe to land.
--
-- Rollback: DROP TABLE `login_link`;

CREATE TABLE `login_link` (
    `id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `superseded_at` DATETIME(3) NULL,

    UNIQUE INDEX `login_link_token_hash_key`(`token_hash`),
    INDEX `login_link_email_stripe_customer_id_idx`(`email`, `stripe_customer_id`),
    INDEX `login_link_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
