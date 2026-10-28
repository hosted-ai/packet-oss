-- PA-354: durable record of monthly-billed subscription windows for investor revenue.
-- One row per pod window (quantity-N Stripe subscriptions have N pods → N rows).
CREATE TABLE `subscription_history` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `stripe_subscription_id` VARCHAR(191) NULL,
    `pod_subscription_id` VARCHAR(191) NULL,
    `pool_id` INTEGER NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `billing_type` VARCHAR(191) NOT NULL,
    `price_cents` INTEGER NOT NULL,

    INDEX `subscription_history_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `subscription_history_pool_id_started_at_idx`(`pool_id`, `started_at`),
    INDEX `subscription_history_stripe_subscription_id_idx`(`stripe_subscription_id`),
    INDEX `subscription_history_pod_subscription_id_idx`(`pod_subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
