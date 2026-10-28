-- Failed-deploy survivors: a refunded deploy whose instance HAI declined to
-- delete keeps running and must be re-terminated until HAI 404s, however old
-- the row is. `terminate_attempts` counts the re-issued deletes so a survivor
-- that keeps resisting raises an ops alert, and `terminate_confirmed_at` is
-- stamped on the first 404 so a released instance leaves the sweep for good.
-- Both nullable/defaulted and additive → zero-downtime. The sweep reads them
-- behind the existing `deploy_status` index.
ALTER TABLE `pod_metadata`
    ADD COLUMN `terminate_attempts` INT NOT NULL DEFAULT 0,
    ADD COLUMN `terminate_confirmed_at` DATETIME(3) NULL;
