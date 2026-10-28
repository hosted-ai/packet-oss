-- Ownership fence for the strangler cutover: packet-api's instance engine
-- launches pods marked 'engine' and is their only biller; every sweep here
-- skips them. IF NOT EXISTS because packet-api's own migration adds the same
-- column on databases both stacks share (MariaDB everywhere).
ALTER TABLE `pod_metadata`
    ADD COLUMN IF NOT EXISTS `managed_by` VARCHAR(12) NOT NULL DEFAULT 'monolith',
    ADD KEY IF NOT EXISTS `idx_managed_by` (`managed_by`);
