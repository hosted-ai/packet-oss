-- PA-80: ephemeral (local root disk) storage-usage alert.
--
-- Warn customers before the ~150 GB local/ephemeral disk fills up and k8s
-- evicts the pod. The existing storage_alert_sent boolean tracks the SEPARATE
-- /workspace (persistent NFS) 80% alert and must stay untouched.
--
-- This new column tracks the highest ephemeral tier already emailed (0, 80, or
-- 90) so the 80% and 90% warnings each fire exactly once — mirroring the tiered
-- last_alert_percent dedup used by the budget-alert cron. Additive + defaulted →
-- zero-downtime.

ALTER TABLE `pod_metadata` ADD COLUMN `root_storage_alert_percent` INTEGER NOT NULL DEFAULT 0;
