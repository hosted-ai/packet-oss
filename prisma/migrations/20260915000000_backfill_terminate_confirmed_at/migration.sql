-- Backfill for the failed-deploy survivor sweep. The sweep selects on
-- `terminate_confirmed_at IS NULL`, so the column arriving NULL on every
-- pre-existing row makes the whole `failed_refunded` history retroactively
-- eligible on the first tick after the promote — roughly 1,000 rows at 25 a
-- run. Stamping everything older than a day leaves the sweep with what it was
-- written for: genuinely recent failures, and everything from here on.
--
-- COALESCE because `deploy_time` is nullable; a row without one is certainly
-- not from the last 24 hours.
UPDATE `pod_metadata`
SET `terminate_confirmed_at` = NOW(3)
WHERE `deploy_status` = 'failed_refunded'
  AND `terminate_confirmed_at` IS NULL
  AND COALESCE(`deploy_time`, `created_at`) < NOW(3) - INTERVAL 24 HOUR;
