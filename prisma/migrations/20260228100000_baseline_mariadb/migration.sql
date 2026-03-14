-- CreateTable
CREATE TABLE `activity_event` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `metadata` TEXT NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_event_customer_id_idx`(`customer_id`),
    INDEX `activity_event_created_at_idx`(`created_at`),
    INDEX `activity_event_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_member` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `invited_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accepted_at` DATETIME(3) NULL,
    `invited_by` VARCHAR(191) NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',

    INDEX `team_member_email_idx`(`email`),
    INDEX `team_member_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `team_member_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `team_member_email_stripe_customer_id_key`(`email`, `stripe_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investor` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `added_by` VARCHAR(191) NOT NULL,
    `is_owner` BOOLEAN NOT NULL DEFAULT false,
    `accepted_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `assigned_node_ids` TEXT NOT NULL DEFAULT '[]',
    `revenue_share_percent` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `investor_email_key`(`email`),
    INDEX `investor_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ssh_key` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `public_key` TEXT NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ssh_key_stripe_customer_id_idx`(`stripe_customer_id`),
    UNIQUE INDEX `ssh_key_stripe_customer_id_fingerprint_key`(`stripe_customer_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pod_metadata` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deploy_time` DATETIME(3) NULL,
    `hourly_rate_cents` INTEGER NULL,
    `pool_id` VARCHAR(191) NULL,
    `prepaid_amount_cents` INTEGER NULL,
    `prepaid_until` DATETIME(3) NULL,
    `product_id` VARCHAR(191) NULL,
    `metrics_token` VARCHAR(191) NULL,
    `startup_script` TEXT NULL,
    `startup_script_status` VARCHAR(191) NULL,
    `startup_script_output` TEXT NULL,
    `storage_alert_sent` BOOLEAN NOT NULL DEFAULT false,
    `skypilot_tags` TEXT NULL,
    `billing_type` VARCHAR(191) NULL,
    `stripe_subscription_id` VARCHAR(191) NULL,
    `shared_volume_id` INTEGER NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `tenant_last_billed_at` DATETIME(3) NULL,

    UNIQUE INDEX `pod_metadata_subscription_id_key`(`subscription_id`),
    INDEX `pod_metadata_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `pod_metadata_prepaid_until_idx`(`prepaid_until`),
    INDEX `pod_metadata_metrics_token_idx`(`metrics_token`),
    INDEX `pod_metadata_stripe_subscription_id_idx`(`stripe_subscription_id`),
    INDEX `pod_metadata_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pod_failure_alert` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `pod_name` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `customer_email` VARCHAR(191) NULL,
    `pool_name` VARCHAR(191) NULL,
    `pod_status` VARCHAR(191) NOT NULL,
    `zammad_ticket_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pod_failure_alert_team_id_idx`(`team_id`),
    INDEX `pod_failure_alert_created_at_idx`(`created_at`),
    UNIQUE INDEX `pod_failure_alert_subscription_id_pod_name_key`(`subscription_id`, `pod_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hugging_face_deployment` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `hf_item_id` VARCHAR(191) NOT NULL,
    `hf_item_type` VARCHAR(191) NOT NULL,
    `hf_item_name` VARCHAR(191) NOT NULL,
    `deploy_script` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `deploy_output` TEXT NULL,
    `service_port` INTEGER NULL,
    `web_ui_port` INTEGER NULL,
    `open_web_ui` BOOLEAN NOT NULL DEFAULT false,
    `netdata_port` INTEGER NULL,
    `netdata` BOOLEAN NOT NULL DEFAULT false,
    `error_message` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hugging_face_deployment_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `hugging_face_deployment_subscription_id_idx`(`subscription_id`),
    INDEX `hugging_face_deployment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `two_factor_auth` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `backup_codes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `two_factor_auth_email_key`(`email`),
    INDEX `two_factor_auth_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_pin` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `pin_hash` VARCHAR(191) NOT NULL,
    `salt` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `previous_hashes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_pin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_activity_event` (
    `id` VARCHAR(191) NOT NULL,
    `admin_email` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_activity_event_admin_email_idx`(`admin_email`),
    INDEX `admin_activity_event_created_at_idx`(`created_at`),
    INDEX `admin_activity_event_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vllm_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `prompt_tokens` BIGINT NOT NULL,
    `generation_tokens` BIGINT NOT NULL,
    `total_tokens` BIGINT NOT NULL,
    `prompt_tokens_delta` BIGINT NOT NULL DEFAULT 0,
    `generation_tokens_delta` BIGINT NOT NULL DEFAULT 0,
    `total_tokens_delta` BIGINT NOT NULL DEFAULT 0,
    `wallet_balance_cents` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vllm_metrics_subscription_id_created_at_idx`(`subscription_id`, `created_at`),
    INDEX `vllm_metrics_stripe_customer_id_created_at_idx`(`stripe_customer_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `referral_code` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `referral_code_code_key`(`code`),
    UNIQUE INDEX `referral_code_stripe_customer_id_key`(`stripe_customer_id`),
    INDEX `referral_code_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `referral_code_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `referral_claim` (
    `id` VARCHAR(191) NOT NULL,
    `referral_code_id` VARCHAR(191) NOT NULL,
    `referee_customer_id` VARCHAR(191) NOT NULL,
    `referee_email` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `qualified_at` DATETIME(3) NULL,
    `credited_at` DATETIME(3) NULL,
    `referrer_credited` BOOLEAN NOT NULL DEFAULT false,
    `referee_credited` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `referral_claim_referee_customer_id_key`(`referee_customer_id`),
    INDEX `referral_claim_referral_code_id_idx`(`referral_code_id`),
    INDEX `referral_claim_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voucher` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `credit_cents` INTEGER NOT NULL,
    `min_topup_cents` INTEGER NULL,
    `max_redemptions` INTEGER NULL,
    `redemption_count` INTEGER NOT NULL DEFAULT 0,
    `max_per_customer` INTEGER NOT NULL DEFAULT 1,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` VARCHAR(191) NULL,

    UNIQUE INDEX `voucher_code_key`(`code`),
    INDEX `voucher_code_idx`(`code`),
    INDEX `voucher_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voucher_redemption` (
    `id` VARCHAR(191) NOT NULL,
    `voucher_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `customer_email` VARCHAR(191) NOT NULL,
    `topup_cents` INTEGER NOT NULL,
    `credit_cents` INTEGER NOT NULL,
    `stripe_session_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',

    INDEX `voucher_redemption_voucher_id_idx`(`voucher_id`),
    INDEX `voucher_redemption_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `voucher_redemption_created_at_idx`(`created_at`),
    INDEX `voucher_redemption_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pod_snapshot` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `snapshot_type` VARCHAR(191) NOT NULL DEFAULT 'template',
    `original_subscription_id` VARCHAR(191) NULL,
    `pool_id` VARCHAR(191) NOT NULL,
    `pool_name` VARCHAR(191) NULL,
    `region_id` VARCHAR(191) NULL,
    `vgpus` INTEGER NOT NULL,
    `instance_type_id` VARCHAR(191) NULL,
    `image_uuid` VARCHAR(191) NULL,
    `persistent_volume_id` INTEGER NULL,
    `persistent_volume_name` VARCHAR(191) NULL,
    `persistent_volume_size` INTEGER NULL,
    `auto_created_volume` BOOLEAN NOT NULL DEFAULT false,
    `storage_block_id` VARCHAR(191) NULL,
    `hf_item_id` VARCHAR(191) NULL,
    `hf_item_type` VARCHAR(191) NULL,
    `hf_item_name` VARCHAR(191) NULL,
    `deploy_script` TEXT NULL,
    `auto_preserved` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pod_snapshot_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `pod_snapshot_snapshot_type_idx`(`snapshot_type`),
    INDEX `pod_snapshot_created_at_idx`(`created_at`),
    INDEX `pod_snapshot_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_notification` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `customer_email` VARCHAR(191) NOT NULL,
    `last_article_id` INTEGER NOT NULL,
    `last_article_at` DATETIME(3) NOT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_notification_ticket_id_idx`(`ticket_id`),
    INDEX `support_notification_stripe_customer_id_idx`(`stripe_customer_id`),
    UNIQUE INDEX `support_notification_ticket_id_last_article_id_key`(`ticket_id`, `last_article_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_key` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `key_prefix` VARCHAR(191) NOT NULL,
    `key_hash` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `scopes` VARCHAR(191) NOT NULL DEFAULT '*',
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `rate_limit_rpm` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `api_key_key_hash_key`(`key_hash`),
    INDEX `api_key_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `api_key_key_hash_idx`(`key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_provider` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `company_name` VARCHAR(191) NOT NULL,
    `contact_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `verified_at` DATETIME(3) NULL,
    `verified_by` VARCHAR(191) NULL,
    `estimated_gpu_count` INTEGER NULL,
    `gpu_types` VARCHAR(191) NULL,
    `regions` VARCHAR(191) NULL,
    `application_type` VARCHAR(191) NOT NULL DEFAULT 'gpu_provider',
    `desired_domain` VARCHAR(191) NULL,
    `expected_customers` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `suspended_reason` VARCHAR(191) NULL,
    `terminated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `commercial_email` VARCHAR(191) NULL,
    `commercial_phone` VARCHAR(191) NULL,
    `general_email` VARCHAR(191) NULL,
    `support_email` VARCHAR(191) NULL,
    `support_phone` VARCHAR(191) NULL,

    UNIQUE INDEX `service_provider_email_key`(`email`),
    INDEX `service_provider_status_idx`(`status`),
    INDEX `service_provider_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_node` (
    `id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(191) NOT NULL,
    `ssh_port` INTEGER NOT NULL DEFAULT 22,
    `ssh_username` VARCHAR(191) NOT NULL DEFAULT 'root',
    `requested_gpu_type_id` VARCHAR(191) NULL,
    `gpu_model` VARCHAR(191) NULL,
    `gpu_count` INTEGER NULL,
    `cpu_model` VARCHAR(191) NULL,
    `cpu_cores` INTEGER NULL,
    `ram_gb` INTEGER NULL,
    `storage_gb` INTEGER NULL,
    `network_speed_mbps` INTEGER NULL,
    `datacenter` VARCHAR(191) NULL,
    `region` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `pricing_tier_id` VARCHAR(191) NULL,
    `custom_provider_rate_cents` INTEGER NULL,
    `revenue_share_percent` DOUBLE NULL,
    `selected_payout_model` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending_validation',
    `status_message` VARCHAR(191) NULL,
    `validated_at` DATETIME(3) NULL,
    `validation_error` VARCHAR(191) NULL,
    `os_version` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `approved_by` VARCHAR(191) NULL,
    `rejected_at` DATETIME(3) NULL,
    `rejected_by` VARCHAR(191) NULL,
    `rejection_reason` VARCHAR(191) NULL,
    `hostedai_pool_id` VARCHAR(191) NULL,
    `hostedai_node_id` VARCHAR(191) NULL,
    `gpuaas_node_id` INTEGER NULL,
    `gpuaas_region_id` INTEGER NULL,
    `gpuaas_cluster_id` INTEGER NULL,
    `gpuaas_pool_id` INTEGER NULL,
    `gpuaas_init_status` VARCHAR(191) NULL,
    `gpuaas_ssh_keys_installed` BOOLEAN NOT NULL DEFAULT false,
    `external_service_ip` VARCHAR(191) NULL,
    `removal_requested_at` DATETIME(3) NULL,
    `removal_scheduled_for` DATETIME(3) NULL,
    `removal_reason` VARCHAR(191) NULL,
    `removed_at` DATETIME(3) NULL,
    `last_health_check` DATETIME(3) NULL,
    `health_status` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deletion_confirmed_at` DATETIME(3) NULL,
    `gpuaas_ssh_keys` TEXT NULL,
    `ssh_password` VARCHAR(191) NULL,

    INDEX `provider_node_provider_id_idx`(`provider_id`),
    INDEX `provider_node_status_idx`(`status`),
    INDEX `provider_node_pricing_tier_id_idx`(`pricing_tier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_pricing_tier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `gpu_model` VARCHAR(191) NOT NULL,
    `provider_rate_cents` INTEGER NOT NULL,
    `customer_rate_cents` INTEGER NOT NULL,
    `is_revenue_share` BOOLEAN NOT NULL DEFAULT false,
    `revenue_share_percent` DOUBLE NULL,
    `min_provider_rate_cents` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `provider_pricing_tier_gpu_model_idx`(`gpu_model`),
    INDEX `provider_pricing_tier_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_node_usage` (
    `id` VARCHAR(191) NOT NULL,
    `node_id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `total_hours` DOUBLE NOT NULL,
    `occupied_hours` DOUBLE NOT NULL,
    `utilization_percent` DOUBLE NULL,
    `customer_revenue_cents` INTEGER NOT NULL,
    `provider_earnings_cents` INTEGER NOT NULL,
    `packet_margin_cents` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `provider_node_usage_node_id_period_start_idx`(`node_id`, `period_start`),
    INDEX `provider_node_usage_period_start_idx`(`period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_payout` (
    `id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `gross_earnings_cents` INTEGER NOT NULL,
    `deductions_cents` INTEGER NOT NULL DEFAULT 0,
    `net_payout_cents` INTEGER NOT NULL,
    `breakdown` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `processed_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `transaction_ref` VARCHAR(191) NULL,
    `failure_reason` VARCHAR(191) NULL,
    `invoice_number` VARCHAR(191) NULL,
    `invoice_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `provider_payout_provider_id_idx`(`provider_id`),
    INDEX `provider_payout_status_idx`(`status`),
    INDEX `provider_payout_period_start_idx`(`period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_notification` (
    `id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `node_id` VARCHAR(191) NULL,
    `payout_id` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `provider_notification_provider_id_idx`(`provider_id`),
    INDEX `provider_notification_type_idx`(`type`),
    INDEX `provider_notification_sent_at_idx`(`sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_admin_activity` (
    `id` VARCHAR(191) NOT NULL,
    `admin_email` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NULL,
    `node_id` VARCHAR(191) NULL,
    `payout_id` VARCHAR(191) NULL,
    `details` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `provider_admin_activity_admin_email_idx`(`admin_email`),
    INDEX `provider_admin_activity_provider_id_idx`(`provider_id`),
    INDEX `provider_admin_activity_action_idx`(`action`),
    INDEX `provider_admin_activity_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `allowed_gpu_type` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `short_name` VARCHAR(191) NOT NULL,
    `manufacturer` VARCHAR(191) NOT NULL DEFAULT 'NVIDIA',
    `match_patterns` TEXT NOT NULL,
    `default_provider_rate_cents` INTEGER NOT NULL,
    `default_customer_rate_cents` INTEGER NOT NULL,
    `default_terms_type` VARCHAR(191) NOT NULL DEFAULT 'fixed',
    `default_revenue_share_percent` DOUBLE NULL,
    `payout_model_choice` VARCHAR(191) NOT NULL DEFAULT 'fixed_only',
    `min_vram_gb` INTEGER NULL,
    `min_cuda_cores` INTEGER NULL,
    `accepting_submissions` BOOLEAN NOT NULL DEFAULT true,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `allowed_gpu_type_name_key`(`name`),
    INDEX `allowed_gpu_type_accepting_submissions_idx`(`accepting_submissions`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `processed_stripe_event` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_event_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `session_id` VARCHAR(191) NULL,
    `customer_id` VARCHAR(191) NULL,

    UNIQUE INDEX `processed_stripe_event_stripe_event_id_key`(`stripe_event_id`),
    INDEX `processed_stripe_event_stripe_event_id_idx`(`stripe_event_id`),
    INDEX `processed_stripe_event_session_id_idx`(`session_id`),
    INDEX `processed_stripe_event_customer_id_idx`(`customer_id`),
    INDEX `processed_stripe_event_processed_at_idx`(`processed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pod_metrics_history` (
    `id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `tflops_usage` DOUBLE NOT NULL DEFAULT 0,
    `vram_usage_kb` DOUBLE NOT NULL DEFAULT 0,
    `hours_used` DOUBLE NOT NULL DEFAULT 0,
    `cost` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NULL,
    `gpu_count` INTEGER NOT NULL DEFAULT 1,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pod_metrics_history_team_id_recorded_at_idx`(`team_id`, `recorded_at`),
    INDEX `pod_metrics_history_subscription_id_recorded_at_idx`(`subscription_id`, `recorded_at`),
    INDEX `pod_metrics_history_recorded_at_idx`(`recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gpu_hardware_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NULL,
    `pool_id` INTEGER NULL,
    `pool_name` VARCHAR(191) NULL,
    `gpu_utilization` DOUBLE NOT NULL,
    `memory_used_mb` DOUBLE NOT NULL,
    `memory_total_mb` DOUBLE NOT NULL,
    `memory_percent` DOUBLE NOT NULL,
    `temperature` DOUBLE NOT NULL,
    `power_draw` DOUBLE NOT NULL,
    `power_limit` DOUBLE NOT NULL,
    `fan_speed` DOUBLE NOT NULL,
    `cpu_percent` DOUBLE NULL,
    `system_mem_used_mb` DOUBLE NULL,
    `system_mem_total_mb` DOUBLE NULL,
    `system_mem_percent` DOUBLE NULL,
    `disk_workspace_used_mb` DOUBLE NULL,
    `disk_workspace_total_mb` DOUBLE NULL,
    `disk_workspace_percent` DOUBLE NULL,
    `disk_root_used_mb` DOUBLE NULL,
    `disk_root_total_mb` DOUBLE NULL,
    `disk_root_percent` DOUBLE NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gpu_hardware_metrics_subscription_id_recorded_at_idx`(`subscription_id`, `recorded_at`),
    INDEX `gpu_hardware_metrics_stripe_customer_id_recorded_at_idx`(`stripe_customer_id`, `recorded_at`),
    INDEX `gpu_hardware_metrics_team_id_recorded_at_idx`(`team_id`, `recorded_at`),
    INDEX `gpu_hardware_metrics_pool_id_recorded_at_idx`(`pool_id`, `recorded_at`),
    INDEX `gpu_hardware_metrics_recorded_at_idx`(`recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pod_uptime_day` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `heartbeats` INTEGER NOT NULL DEFAULT 0,
    `first_seen` DATETIME(3) NOT NULL,
    `last_seen` DATETIME(3) NOT NULL,

    INDEX `pod_uptime_day_subscription_id_idx`(`subscription_id`),
    INDEX `pod_uptime_day_date_idx`(`date`),
    UNIQUE INDEX `pod_uptime_day_subscription_id_date_key`(`subscription_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `metrics_cache` (
    `id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `cache_data` TEXT NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `metrics_cache_team_id_key`(`team_id`),
    INDEX `metrics_cache_team_id_idx`(`team_id`),
    INDEX `metrics_cache_fetched_at_idx`(`fetched_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_lineage` (
    `id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `root_subscription_id` VARCHAR(191) NOT NULL,
    `previous_subscription_id` VARCHAR(191) NOT NULL,
    `new_subscription_id` VARCHAR(191) NOT NULL,
    `pool_id` VARCHAR(191) NULL,
    `pool_name` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_lineage_new_subscription_id_key`(`new_subscription_id`),
    INDEX `subscription_lineage_team_id_idx`(`team_id`),
    INDEX `subscription_lineage_root_subscription_id_idx`(`root_subscription_id`),
    INDEX `subscription_lineage_previous_subscription_id_idx`(`previous_subscription_id`),
    INDEX `subscription_lineage_new_subscription_id_idx`(`new_subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_commercial_terms` (
    `id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `gpu_type_name` VARCHAR(191) NULL,
    `provider_rate_cents` INTEGER NULL,
    `customer_rate_cents` INTEGER NULL,
    `terms_type` VARCHAR(191) NULL,
    `revenue_share_percent` DOUBLE NULL,
    `min_guaranteed_rate_cents` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effective_until` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `provider_commercial_terms_provider_id_idx`(`provider_id`),
    UNIQUE INDEX `provider_commercial_terms_provider_id_gpu_type_name_key`(`provider_id`, `gpu_type_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pool_settings_defaults` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `time_quantum_sec` INTEGER NOT NULL DEFAULT 90,
    `overcommit_ratio` DOUBLE NOT NULL DEFAULT 1.0,
    `security_mode` VARCHAR(191) NOT NULL DEFAULT 'low',
    `updated_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pool_settings_override` (
    `id` VARCHAR(191) NOT NULL,
    `gpuaas_pool_id` INTEGER NOT NULL,
    `node_id` VARCHAR(191) NULL,
    `pool_name` VARCHAR(191) NULL,
    `time_quantum_sec` INTEGER NULL,
    `overcommit_ratio` DOUBLE NULL,
    `security_mode` VARCHAR(191) NULL,
    `priority` INTEGER NULL,
    `maintenance` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pool_settings_override_gpuaas_pool_id_key`(`gpuaas_pool_id`),
    UNIQUE INDEX `pool_settings_override_node_id_key`(`node_id`),
    INDEX `pool_settings_override_node_id_idx`(`node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gpu_product` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `billing_type` VARCHAR(191) NOT NULL DEFAULT 'hourly',
    `price_per_hour_cents` INTEGER NOT NULL,
    `price_per_month_cents` INTEGER NULL,
    `stripe_product_id` VARCHAR(191) NULL,
    `stripe_price_id` VARCHAR(191) NULL,
    `pool_ids` TEXT NOT NULL DEFAULT '[]',
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `badge_text` VARCHAR(191) NULL,
    `vram_gb` INTEGER NULL,
    `cuda_cores` INTEGER NULL,
    `created_by` VARCHAR(191) NULL,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gpu_product_name_key`(`name`),
    INDEX `gpu_product_active_idx`(`active`),
    INDEX `gpu_product_display_order_idx`(`display_order`),
    INDEX `gpu_product_billing_type_idx`(`billing_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gpu_app` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `long_description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `install_script` TEXT NOT NULL,
    `estimated_install_min` INTEGER NOT NULL DEFAULT 5,
    `min_vram_gb` INTEGER NOT NULL DEFAULT 8,
    `recommended_vram_gb` INTEGER NOT NULL DEFAULT 16,
    `typical_vram_usage_gb` INTEGER NULL,
    `default_port` INTEGER NULL,
    `web_ui_port` INTEGER NULL,
    `service_type` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `badge_text` VARCHAR(191) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` VARCHAR(191) NULL,
    `docs_url` VARCHAR(191) NULL,
    `tags` TEXT NOT NULL DEFAULT '[]',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gpu_app_slug_key`(`slug`),
    INDEX `gpu_app_category_idx`(`category`),
    INDEX `gpu_app_active_idx`(`active`),
    INDEX `gpu_app_display_order_idx`(`display_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installed_app` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `app_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'installing',
    `install_progress` INTEGER NOT NULL DEFAULT 0,
    `install_output` TEXT NULL,
    `error_message` VARCHAR(191) NULL,
    `port` INTEGER NULL,
    `web_ui_port` INTEGER NULL,
    `external_url` VARCHAR(191) NULL,
    `web_ui_url` VARCHAR(191) NULL,
    `pid` INTEGER NULL,
    `started_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `installed_app_subscription_id_idx`(`subscription_id`),
    INDEX `installed_app_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `installed_app_status_idx`(`status`),
    UNIQUE INDEX `installed_app_subscription_id_app_id_key`(`subscription_id`, `app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_template` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NOT NULL,
    `html_content` TEXT NOT NULL,
    `text_content` TEXT NULL,
    `variables` VARCHAR(191) NOT NULL DEFAULT '[]',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_template_slug_key`(`slug`),
    INDEX `email_template_slug_idx`(`slug`),
    INDEX `email_template_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drip_sequence` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `trigger` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `drip_sequence_slug_key`(`slug`),
    INDEX `drip_sequence_trigger_idx`(`trigger`),
    INDEX `drip_sequence_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drip_step` (
    `id` VARCHAR(191) NOT NULL,
    `sequence_id` VARCHAR(191) NOT NULL,
    `step_order` INTEGER NOT NULL,
    `delay_hours` INTEGER NOT NULL,
    `template_slug` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `drip_step_sequence_id_idx`(`sequence_id`),
    UNIQUE INDEX `drip_step_sequence_id_step_order_key`(`sequence_id`, `step_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drip_enrollment` (
    `id` VARCHAR(191) NOT NULL,
    `sequence_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `customer_name` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `current_step` INTEGER NOT NULL DEFAULT 0,
    `enrolled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_sent_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `metadata` TEXT NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',

    INDEX `drip_enrollment_sequence_id_status_idx`(`sequence_id`, `status`),
    INDEX `drip_enrollment_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `drip_enrollment_status_last_sent_at_idx`(`status`, `last_sent_at`),
    INDEX `drip_enrollment_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `drip_enrollment_sequence_id_stripe_customer_id_key`(`sequence_id`, `stripe_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_play` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `score` INTEGER NOT NULL,
    `lines_cleared` INTEGER NOT NULL,
    `avg_utilization` DOUBLE NOT NULL,
    `peak_utilization` DOUBLE NOT NULL,
    `duration` INTEGER NOT NULL,
    `level` INTEGER NOT NULL,
    `pieces_placed` INTEGER NOT NULL,
    `won` BOOLEAN NOT NULL DEFAULT false,
    `voucher_claimed` BOOLEAN NOT NULL DEFAULT false,
    `voucher_code` VARCHAR(191) NULL,
    `user_agent` VARCHAR(191) NULL,
    `screen_width` INTEGER NULL,
    `screen_height` INTEGER NULL,
    `is_mobile` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `game_play_created_at_idx`(`created_at`),
    INDEX `game_play_won_idx`(`won`),
    INDEX `game_play_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_settings` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `monthly_limit_cents` INTEGER NULL,
    `daily_limit_cents` INTEGER NULL,
    `alert_at_50_percent` BOOLEAN NOT NULL DEFAULT true,
    `alert_at_80_percent` BOOLEAN NOT NULL DEFAULT true,
    `alert_at_100_percent` BOOLEAN NOT NULL DEFAULT true,
    `auto_shutdown_enabled` BOOLEAN NOT NULL DEFAULT false,
    `auto_shutdown_threshold` INTEGER NOT NULL DEFAULT 100,
    `last_alert_sent_at` DATETIME(3) NULL,
    `last_alert_percent` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `budget_settings_stripe_customer_id_key`(`stripe_customer_id`),
    INDEX `budget_settings_stripe_customer_id_idx`(`stripe_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_alert` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `alert_type` VARCHAR(191) NOT NULL,
    `percent_used` INTEGER NOT NULL,
    `current_spend_cents` INTEGER NOT NULL,
    `limit_cents` INTEGER NOT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `budget_alert_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `budget_alert_sent_at_idx`(`sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_settings` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `session_timeout_hours` INTEGER NOT NULL DEFAULT 1,
    `pixel_factory_rpm` INTEGER NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_settings_stripe_customer_id_key`(`stripe_customer_id`),
    INDEX `customer_settings_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `customer_settings_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_model` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'packet',
    `model_type` VARCHAR(191) NOT NULL DEFAULT 'chat',
    `context_length` INTEGER NOT NULL DEFAULT 8192,
    `input_price_per_1k` DOUBLE NOT NULL DEFAULT 0,
    `output_price_per_1k` DOUBLE NOT NULL DEFAULT 0,
    `batch_discount` DOUBLE NOT NULL DEFAULT 0.5,
    `vram_required_gb` INTEGER NULL,
    `gpu_types` VARCHAR(191) NULL,
    `supports_lora` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inference_model_name_key`(`name`),
    INDEX `inference_model_active_idx`(`active`),
    INDEX `inference_model_provider_idx`(`provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lora_adapter` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `base_model_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `training_file` VARCHAR(191) NULL,
    `training_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `training_progress` INTEGER NOT NULL DEFAULT 0,
    `training_error` TEXT NULL,
    `adapter_path` VARCHAR(191) NULL,
    `adapter_size_mb` DOUBLE NULL,
    `epochs` INTEGER NOT NULL DEFAULT 3,
    `learning_rate` DOUBLE NOT NULL DEFAULT 0.0002,
    `rank` INTEGER NOT NULL DEFAULT 16,
    `alpha` INTEGER NOT NULL DEFAULT 32,
    `total_tokens` BIGINT NOT NULL DEFAULT 0,
    `last_used_at` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lora_adapter_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `lora_adapter_team_id_idx`(`team_id`),
    INDEX `lora_adapter_base_model_id_idx`(`base_model_id`),
    INDEX `lora_adapter_training_status_idx`(`training_status`),
    UNIQUE INDEX `lora_adapter_team_id_name_key`(`team_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_batch_job` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `model_id` VARCHAR(191) NOT NULL,
    `lora_adapter_id` VARCHAR(191) NULL,
    `input_file` LONGTEXT NOT NULL,
    `output_file` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `sla_type` VARCHAR(191) NOT NULL DEFAULT '24h',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `total_requests` INTEGER NOT NULL DEFAULT 0,
    `completed_requests` INTEGER NOT NULL DEFAULT 0,
    `failed_requests` INTEGER NOT NULL DEFAULT 0,
    `input_tokens` BIGINT NOT NULL DEFAULT 0,
    `output_tokens` BIGINT NOT NULL DEFAULT 0,
    `estimated_cost_cents` INTEGER NOT NULL DEFAULT 0,
    `actual_cost_cents` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `deadline` DATETIME(3) NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inference_batch_job_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `inference_batch_job_team_id_idx`(`team_id`),
    INDEX `inference_batch_job_status_idx`(`status`),
    INDEX `inference_batch_job_deadline_idx`(`deadline`),
    INDEX `inference_batch_job_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_request` (
    `id` VARCHAR(191) NOT NULL,
    `batch_job_id` VARCHAR(191) NULL,
    `custom_id` VARCHAR(191) NULL,
    `input_data` TEXT NOT NULL,
    `output_data` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `latency_ms` INTEGER NULL,
    `error_message` VARCHAR(191) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inference_request_batch_job_id_idx`(`batch_job_id`),
    INDEX `inference_request_status_idx`(`status`),
    INDEX `inference_request_custom_id_idx`(`custom_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_usage` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `model_id` VARCHAR(191) NULL,
    `lora_adapter_id` VARCHAR(191) NULL,
    `request_type` VARCHAR(191) NOT NULL DEFAULT 'realtime',
    `input_tokens` BIGINT NOT NULL,
    `output_tokens` BIGINT NOT NULL,
    `cost_cents` INTEGER NOT NULL,
    `latency_ms` INTEGER NULL,
    `server_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inference_usage_stripe_customer_id_created_at_idx`(`stripe_customer_id`, `created_at`),
    INDEX `inference_usage_team_id_created_at_idx`(`team_id`, `created_at`),
    INDEX `inference_usage_model_id_idx`(`model_id`),
    INDEX `inference_usage_server_id_idx`(`server_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_server` (
    `id` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 8000,
    `gpu_type` VARCHAR(191) NOT NULL,
    `gpu_count` INTEGER NOT NULL DEFAULT 1,
    `vram_total_gb` INTEGER NOT NULL,
    `loaded_model` VARCHAR(191) NULL,
    `loaded_loras` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'offline',
    `health_check_at` DATETIME(3) NULL,
    `current_load` DOUBLE NOT NULL DEFAULT 0,
    `queue_depth` INTEGER NOT NULL DEFAULT 0,
    `provider_node_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inference_server_status_idx`(`status`),
    INDEX `inference_server_loaded_model_idx`(`loaded_model`),
    INDEX `inference_server_provider_node_id_idx`(`provider_node_id`),
    UNIQUE INDEX `inference_server_ip_address_port_key`(`ip_address`, `port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_server_usage` (
    `id` VARCHAR(191) NOT NULL,
    `server_id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `input_tokens` BIGINT NOT NULL,
    `output_tokens` BIGINT NOT NULL,
    `total_tokens` BIGINT NOT NULL,
    `request_count` INTEGER NOT NULL,
    `customer_revenue_cents` INTEGER NOT NULL DEFAULT 0,
    `provider_earnings_cents` INTEGER NOT NULL DEFAULT 0,
    `packet_margin_cents` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inference_server_usage_server_id_period_start_idx`(`server_id`, `period_start`),
    INDEX `inference_server_usage_provider_id_period_start_idx`(`provider_id`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_provider_config` (
    `id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `revenue_share_percent` DOUBLE NOT NULL DEFAULT 50,
    `min_guaranteed_cents` INTEGER NULL,
    `custom_input_per_1m` INTEGER NULL,
    `custom_output_per_1m` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inference_provider_config_provider_id_key`(`provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spheron_deployment` (
    `id` VARCHAR(191) NOT NULL,
    `spheron_deployment_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NOT NULL,
    `gpu_type` VARCHAR(191) NOT NULL,
    `gpu_count` INTEGER NOT NULL DEFAULT 1,
    `region` VARCHAR(191) NOT NULL,
    `operating_system` VARCHAR(191) NOT NULL,
    `instance_type` VARCHAR(191) NOT NULL,
    `offer_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'deploying',
    `ip_address` VARCHAR(191) NULL,
    `ssh_user` VARCHAR(191) NULL,
    `ssh_command` VARCHAR(191) NULL,
    `hourly_price_cents` INTEGER NOT NULL,
    `markup_percent` INTEGER NOT NULL DEFAULT 15,
    `total_hourly_rate_cents` INTEGER NOT NULL,
    `last_billed_at` DATETIME(3) NULL,
    `k8s_enabled` BOOLEAN NOT NULL DEFAULT false,
    `k8s_version` VARCHAR(191) NULL,
    `k8s_cluster_id` VARCHAR(191) NULL,
    `k8s_kubeconfig` TEXT NULL,
    `k8s_service_links` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `terminated_at` DATETIME(3) NULL,

    UNIQUE INDEX `spheron_deployment_spheron_deployment_id_key`(`spheron_deployment_id`),
    INDEX `spheron_deployment_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `spheron_deployment_team_id_idx`(`team_id`),
    INDEX `spheron_deployment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spheron_volume` (
    `id` VARCHAR(191) NOT NULL,
    `spheron_volume_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `size_in_gb` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'available',
    `virtual_ip` VARCHAR(191) NULL,
    `hourly_price_cents` INTEGER NOT NULL,
    `markup_percent` INTEGER NOT NULL DEFAULT 15,
    `total_hourly_rate_cents` INTEGER NOT NULL,
    `last_billed_at` DATETIME(3) NULL,
    `delete_with_instance` BOOLEAN NOT NULL DEFAULT false,
    `attached_deployment_ids` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `spheron_volume_spheron_volume_id_key`(`spheron_volume_id`),
    INDEX `spheron_volume_stripe_customer_id_idx`(`stripe_customer_id`),
    INDEX `spheron_volume_team_id_idx`(`team_id`),
    INDEX `spheron_volume_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inference_pricing_config` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `realtime_input_per_1m` INTEGER NOT NULL DEFAULT 10,
    `realtime_output_per_1m` INTEGER NOT NULL DEFAULT 10,
    `batch_1h_input_per_1m` INTEGER NOT NULL DEFAULT 7,
    `batch_1h_output_per_1m` INTEGER NOT NULL DEFAULT 7,
    `batch_24h_input_per_1m` INTEGER NOT NULL DEFAULT 5,
    `batch_24h_output_per_1m` INTEGER NOT NULL DEFAULT 5,
    `fine_tuning_per_1k_tokens` INTEGER NOT NULL DEFAULT 100,
    `lora_storage_per_month_cents` INTEGER NOT NULL DEFAULT 50,
    `playground_free_tier_tokens` INTEGER NOT NULL DEFAULT 10000,
    `token_provider_revenue_share_percent` DOUBLE NOT NULL DEFAULT 50,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_transaction` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `subscription_id` VARCHAR(191) NULL,
    `pool_id` INTEGER NULL,
    `gpu_count` INTEGER NULL,
    `hourly_rate_cents` INTEGER NULL,
    `billing_minutes` INTEGER NULL,
    `sync_cycle_id` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wallet_transaction_stripe_customer_id_created_at_idx`(`stripe_customer_id`, `created_at`),
    INDEX `wallet_transaction_team_id_created_at_idx`(`team_id`, `created_at`),
    INDEX `wallet_transaction_pool_id_created_at_idx`(`pool_id`, `created_at`),
    INDEX `wallet_transaction_subscription_id_created_at_idx`(`subscription_id`, `created_at`),
    INDEX `wallet_transaction_type_created_at_idx`(`type`, `created_at`),
    INDEX `wallet_transaction_created_at_idx`(`created_at`),
    INDEX `wallet_transaction_sync_cycle_id_idx`(`sync_cycle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_banner` (
    `id` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `link_url` VARCHAR(191) NULL,
    `link_text` VARCHAR(191) NULL,
    `background_color` VARCHAR(191) NOT NULL DEFAULT '#1a4fff',
    `text_color` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `dismissible` BOOLEAN NOT NULL DEFAULT true,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(191) NULL,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaign_banner_active_display_order_idx`(`active`, `display_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `page_view` (
    `id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NOT NULL,
    `page` VARCHAR(191) NOT NULL,
    `referrer` TEXT NULL,
    `utm_source` VARCHAR(191) NULL,
    `utm_medium` VARCHAR(191) NULL,
    `utm_campaign` VARCHAR(191) NULL,
    `utm_content` VARCHAR(191) NULL,
    `utm_term` VARCHAR(191) NULL,
    `converted_customer_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `page_view_utm_source_idx`(`utm_source`),
    INDEX `page_view_utm_campaign_idx`(`utm_campaign`),
    INDEX `page_view_created_at_idx`(`created_at`),
    INDEX `page_view_session_id_idx`(`session_id`),
    INDEX `page_view_converted_customer_id_idx`(`converted_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_lifecycle` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `utm_source` VARCHAR(191) NULL,
    `utm_medium` VARCHAR(191) NULL,
    `utm_campaign` VARCHAR(191) NULL,
    `utm_content` VARCHAR(191) NULL,
    `utm_term` VARCHAR(191) NULL,
    `landing_page` TEXT NULL,
    `referrer` TEXT NULL,
    `session_id` VARCHAR(191) NULL,
    `signed_up_at` DATETIME(3) NOT NULL,
    `first_login_at` DATETIME(3) NULL,
    `first_api_call_at` DATETIME(3) NULL,
    `first_deposit_at` DATETIME(3) NULL,
    `first_gpu_deploy_at` DATETIME(3) NULL,
    `subscribed_at` DATETIME(3) NULL,
    `churned_at` DATETIME(3) NULL,
    `reactivated_at` DATETIME(3) NULL,
    `total_deposits_cents` INTEGER NOT NULL DEFAULT 0,
    `total_spend_cents` INTEGER NOT NULL DEFAULT 0,
    `deposit_count` INTEGER NOT NULL DEFAULT 0,
    `current_billing_type` VARCHAR(191) NOT NULL DEFAULT 'free',
    `last_active_at` DATETIME(3) NULL,
    `gpu_hours_total` DOUBLE NOT NULL DEFAULT 0,
    `inference_tokens` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_lifecycle_stripe_customer_id_key`(`stripe_customer_id`),
    INDEX `customer_lifecycle_utm_source_idx`(`utm_source`),
    INDEX `customer_lifecycle_utm_campaign_idx`(`utm_campaign`),
    INDEX `customer_lifecycle_utm_medium_idx`(`utm_medium`),
    INDEX `customer_lifecycle_signed_up_at_idx`(`signed_up_at`),
    INDEX `customer_lifecycle_current_billing_type_idx`(`current_billing_type`),
    INDEX `customer_lifecycle_total_deposits_cents_idx`(`total_deposits_cents`),
    INDEX `customer_lifecycle_churned_at_idx`(`churned_at`),
    INDEX `customer_lifecycle_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_model` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `architecture` VARCHAR(191) NOT NULL,
    `model_type` VARCHAR(191) NOT NULL DEFAULT 'image',
    `vram_required_gb` DOUBLE NOT NULL,
    `default_steps` INTEGER NOT NULL,
    `default_cfg` DOUBLE NOT NULL,
    `max_width` INTEGER NOT NULL DEFAULT 2048,
    `max_height` INTEGER NOT NULL DEFAULT 2048,
    `price_per_1_image` INTEGER NOT NULL,
    `price_multiplier` DOUBLE NOT NULL DEFAULT 1.0,
    `comfy_workflow` VARCHAR(191) NOT NULL DEFAULT 'flux',
    `comfy_model_file` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_model_name_key`(`name`),
    INDEX `image_model_active_idx`(`active`),
    INDEX `image_model_model_type_idx`(`model_type`),
    INDEX `image_model_architecture_idx`(`architecture`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_generation` (
    `id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NULL,
    `model_id` VARCHAR(191) NOT NULL,
    `model_name` VARCHAR(191) NOT NULL,
    `server_id` VARCHAR(191) NULL,
    `server_gpu_index` INTEGER NULL,
    `prompt` TEXT NOT NULL,
    `negative_prompt` TEXT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `steps` INTEGER NOT NULL,
    `cfg_scale` DOUBLE NOT NULL,
    `seed` BIGINT NULL,
    `n` INTEGER NOT NULL DEFAULT 1,
    `output_format` VARCHAR(191) NOT NULL DEFAULT 'png',
    `output_urls` TEXT NULL,
    `cost_cents` INTEGER NOT NULL,
    `duration_ms` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `error_message` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `image_generation_stripe_customer_id_created_at_idx`(`stripe_customer_id`, `created_at`),
    INDEX `image_generation_team_id_created_at_idx`(`team_id`, `created_at`),
    INDEX `image_generation_model_id_idx`(`model_id`),
    INDEX `image_generation_status_idx`(`status`),
    INDEX `image_generation_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `contact_email` VARCHAR(191) NULL,
    `contact_name` VARCHAR(191) NULL,
    `brand_name` VARCHAR(191) NOT NULL,
    `logo_url` VARCHAR(191) NOT NULL DEFAULT '',
    `favicon_url` VARCHAR(191) NULL,
    `og_image_url` VARCHAR(191) NULL,
    `primary_color` VARCHAR(191) NOT NULL DEFAULT '#1a4fff',
    `accent_color` VARCHAR(191) NOT NULL DEFAULT '#18b6a8',
    `bg_color` VARCHAR(191) NOT NULL DEFAULT '#f7f8fb',
    `text_color` VARCHAR(191) NOT NULL DEFAULT '#0b0f1c',
    `custom_css` TEXT NULL,
    `custom_strings` JSON NULL,
    `stripe_secret_key` VARCHAR(191) NOT NULL DEFAULT '',
    `stripe_publishable_key` VARCHAR(191) NOT NULL DEFAULT '',
    `stripe_webhook_secret` VARCHAR(191) NOT NULL DEFAULT '',
    `wholesale_customer_id` VARCHAR(191) NULL,
    `signup_credit_cents` INTEGER NOT NULL DEFAULT 0,
    `billing_models` VARCHAR(191) NOT NULL DEFAULT 'hourly,monthly',
    `support_email` VARCHAR(191) NOT NULL DEFAULT '',
    `support_url` VARCHAR(191) NULL,
    `status_page_enabled` BOOLEAN NOT NULL DEFAULT true,
    `alert_webhook_url` VARCHAR(191) NULL,
    `lead_webhook_url` VARCHAR(191) NULL,
    `analytics_id` VARCHAR(191) NULL,
    `drip_email_enabled` BOOLEAN NOT NULL DEFAULT true,
    `admin_domains` VARCHAR(191) NOT NULL DEFAULT 'hosted.ai,packet.ai',
    `allowed_gpu_types` VARCHAR(191) NOT NULL DEFAULT 'rtx-pro-6000,b200,h200',
    `max_concurrent_gpus` INTEGER NULL,
    `api_key` VARCHAR(191) NULL,
    `webhook_url` VARCHAR(191) NULL,
    `cli_name` VARCHAR(191) NULL,
    `cli_download_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_slug_key`(`slug`),
    UNIQUE INDEX `tenant_api_key_key`(`api_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_domain` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `verified_at` DATETIME(3) NULL,

    UNIQUE INDEX `tenant_domain_domain_key`(`domain`),
    INDEX `tenant_domain_domain_idx`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_gpu_pricing` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `gpu_type` VARCHAR(191) NOT NULL,
    `hourly_rate_cents` INTEGER NOT NULL,
    `monthly_rate_cents` INTEGER NULL,
    `wholesale_cost_cents` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `tenant_gpu_pricing_tenant_id_gpu_type_key`(`tenant_id`, `gpu_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_customer` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `balance_cents` INTEGER NOT NULL DEFAULT 0,
    `wallet_enabled` BOOLEAN NOT NULL DEFAULT false,
    `low_balance_alert_sent` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_customer_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `tenant_customer_tenant_id_stripe_customer_id_key`(`tenant_id`, `stripe_customer_id`),
    UNIQUE INDEX `tenant_customer_tenant_id_email_key`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_wallet_transaction` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_wallet_transaction_idempotency_key_key`(`idempotency_key`),
    INDEX `tenant_wallet_transaction_customer_id_created_at_idx`(`customer_id`, `created_at`),
    INDEX `tenant_wallet_transaction_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_event` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `payload` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `status_code` INTEGER NULL,
    `error` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,

    INDEX `webhook_event_tenant_id_idx`(`tenant_id`),
    INDEX `webhook_event_status_idx`(`status`),
    INDEX `webhook_event_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_drip_template` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `email_type` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body_html` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tenant_drip_template_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `tenant_drip_template_tenant_id_email_type_key`(`tenant_id`, `email_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_stats_snapshot` (
    `id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `total_customers` INTEGER NOT NULL,
    `active_gpus` INTEGER NOT NULL,
    `mrr_cents` INTEGER NOT NULL,
    `new_this_week` INTEGER NOT NULL,
    `revenue_week_cents` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_stats_snapshot_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_cache` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `stripe_created_at` DATETIME(3) NOT NULL,
    `balance_cents` INTEGER NOT NULL DEFAULT 0,
    `billing_type` VARCHAR(191) NULL,
    `team_id` VARCHAR(191) NULL,
    `product_id` VARCHAR(191) NULL,
    `metadata_json` TEXT NULL,
    `active_pods` INTEGER NOT NULL DEFAULT 0,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `last_synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_cache_email_idx`(`email`),
    INDEX `customer_cache_billing_type_idx`(`billing_type`),
    INDEX `customer_cache_team_id_idx`(`team_id`),
    INDEX `customer_cache_stripe_created_at_idx`(`stripe_created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `referral_claim` ADD CONSTRAINT `referral_claim_referral_code_id_fkey` FOREIGN KEY (`referral_code_id`) REFERENCES `referral_code`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher_redemption` ADD CONSTRAINT `voucher_redemption_voucher_id_fkey` FOREIGN KEY (`voucher_id`) REFERENCES `voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_node` ADD CONSTRAINT `provider_node_pricing_tier_id_fkey` FOREIGN KEY (`pricing_tier_id`) REFERENCES `provider_pricing_tier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_node` ADD CONSTRAINT `provider_node_requested_gpu_type_id_fkey` FOREIGN KEY (`requested_gpu_type_id`) REFERENCES `allowed_gpu_type`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_node` ADD CONSTRAINT `provider_node_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `service_provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_node_usage` ADD CONSTRAINT `provider_node_usage_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `provider_node`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_payout` ADD CONSTRAINT `provider_payout_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `service_provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_notification` ADD CONSTRAINT `provider_notification_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `service_provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_commercial_terms` ADD CONSTRAINT `provider_commercial_terms_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `service_provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pool_settings_override` ADD CONSTRAINT `pool_settings_override_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `provider_node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installed_app` ADD CONSTRAINT `installed_app_app_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `gpu_app`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drip_step` ADD CONSTRAINT `drip_step_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES `drip_sequence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drip_enrollment` ADD CONSTRAINT `drip_enrollment_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES `drip_sequence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lora_adapter` ADD CONSTRAINT `lora_adapter_base_model_id_fkey` FOREIGN KEY (`base_model_id`) REFERENCES `inference_model`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_batch_job` ADD CONSTRAINT `inference_batch_job_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `inference_model`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_batch_job` ADD CONSTRAINT `inference_batch_job_lora_adapter_id_fkey` FOREIGN KEY (`lora_adapter_id`) REFERENCES `lora_adapter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_request` ADD CONSTRAINT `inference_request_batch_job_id_fkey` FOREIGN KEY (`batch_job_id`) REFERENCES `inference_batch_job`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_usage` ADD CONSTRAINT `inference_usage_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `inference_server`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_server` ADD CONSTRAINT `inference_server_provider_node_id_fkey` FOREIGN KEY (`provider_node_id`) REFERENCES `provider_node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_server_usage` ADD CONSTRAINT `inference_server_usage_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `inference_server`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inference_provider_config` ADD CONSTRAINT `inference_provider_config_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `service_provider`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_domain` ADD CONSTRAINT `tenant_domain_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_gpu_pricing` ADD CONSTRAINT `tenant_gpu_pricing_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_customer` ADD CONSTRAINT `tenant_customer_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_drip_template` ADD CONSTRAINT `tenant_drip_template_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

