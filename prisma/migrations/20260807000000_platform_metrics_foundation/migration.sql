-- PA-693: activation milestone (metric #2) — stamped by the GPU-metrics
-- ingest/sweep on the first GpuHardwareMetrics sample with real utilization.
ALTER TABLE `customer_lifecycle` ADD COLUMN `first_workload_at` DATETIME(3) NULL;

-- PA-693: daily fleet-capacity series (metric #11 denominator). One row per
-- (date, kind, pool); kind="baremetal" rows have pool_id NULL. Written once per
-- UTC day by the refresh-pool-overview cron.
CREATE TABLE `fleet_capacity_snapshot` (
    `id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `pool_id` INTEGER NULL,
    `gpu_model` VARCHAR(191) NULL,
    `physical_gpus` INTEGER NOT NULL,
    `online_gpus` INTEGER NOT NULL,
    `overcommit_ratio` DOUBLE NOT NULL DEFAULT 1,
    `vgpu_slots` INTEGER NOT NULL,
    `online_nodes` INTEGER NOT NULL,
    `total_nodes` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `fleet_capacity_snapshot_date_kind_pool_id_key`(`date`, `kind`, `pool_id`),
    INDEX `fleet_capacity_snapshot_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
