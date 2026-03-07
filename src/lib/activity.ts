import { PrismaClient } from "@prisma/client";

// Lazy initialization to avoid build-time connection issues
let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Event types for customer activity
export type ActivityEventType =
  // Account events
  | "account_created"
  | "account_login"
  | "login_link_requested"
  | "settings_updated"
  | "two_factor_enabled"
  | "two_factor_disabled"
  // API key events
  | "api_key_created"
  | "api_key_deleted"
  // SSH key events
  | "ssh_key_added"
  | "ssh_key_deleted"
  // Team events
  | "team_member_invited"
  | "team_member_removed"
  | "team_member_joined"
  // GPU events
  | "gpu_launched"
  | "gpu_scaled"
  | "gpu_restarted"
  | "gpu_stopped"
  | "gpu_started"
  | "gpu_terminated"
  | "gpu_error"
  // Billing events
  | "payment_received"
  | "wallet_charged"
  | "wallet_topup"
  | "voucher_redeemed"
  | "budget_set"
  // Inference events
  | "inference"
  | "batch_created"
  | "batch_cancelled"
  | "lora_created"
  | "lora_training_started"
  | "lora_training_completed"
  | "lora_deleted"
  // HuggingFace deployments
  | "hf_deployment_started"
  | "hf_deployment_installing"
  | "hf_deployment_running"
  | "hf_deployment_failed"
  | "hf_deployment_deleted"
  | "hf_deployment_timeout"
  | "hf_deployment_pod_terminated"
  | "hf_deployment_script_started"
  | "hf_deployment_script_failed"
  | "hf_notify_request"
  | "hf_notify_sent"
  // Bare Metal events
  | "bare_metal_deployed"
  | "bare_metal_terminated"
  // Persistent Storage (Volume) events
  | "volume_created"
  | "volume_updated"
  | "volume_deleted"
  | "volume_attached"
  | "volume_detached"
  // Snapshot events
  | "snapshot_created"
  | "snapshot_restored"
  | "snapshot_deleted";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  description: string;
  metadata?: Record<string, unknown>;
  created: number; // Unix timestamp
}

// Log a new activity event
export async function logActivity(
  customerId: string,
  type: ActivityEventType,
  description: string,
  metadata?: Record<string, unknown>
): Promise<ActivityEvent> {
  try {
    const db = getPrisma();
    const event = await db.activityEvent.create({
      data: {
        customerId,
        type,
        description,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return {
      id: event.id,
      type: event.type as ActivityEventType,
      description: event.description,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
      created: Math.floor(event.createdAt.getTime() / 1000),
    };
  } catch (error) {
    console.error("Failed to log activity:", error);
    // Return a mock event if database fails - don't break the app
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      description,
      metadata,
      created: Math.floor(Date.now() / 1000),
    };
  }
}

// Get activity events for a customer
export async function getActivityEvents(
  customerId: string,
  limit: number = 100
): Promise<ActivityEvent[]> {
  try {
    const db = getPrisma();
    const events = await db.activityEvent.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return events.map((event) => ({
      id: event.id,
      type: event.type as ActivityEventType,
      description: event.description,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
      created: Math.floor(event.createdAt.getTime() / 1000),
    }));
  } catch (error) {
    console.error("Failed to get activity events:", error);
    return [];
  }
}

// Helper functions for common events
export function logGPULaunched(
  customerId: string,
  poolName: string,
  gpuCount: number = 1,
  podName?: string,
  subscriptionId?: string
): Promise<ActivityEvent> {
  const desc = podName
    ? `Launched ${gpuCount} GPU${gpuCount > 1 ? "s" : ""} "${podName}" on ${poolName}`
    : `Launched ${gpuCount} GPU${gpuCount > 1 ? "s" : ""} on ${poolName}`;
  return logActivity(
    customerId,
    "gpu_launched",
    desc,
    { poolName, gpuCount, podName, subscriptionId }
  );
}

export function logGPUScaled(
  customerId: string,
  poolName: string,
  fromCount: number,
  toCount: number
): Promise<ActivityEvent> {
  const direction = toCount > fromCount ? "up" : "down";
  return logActivity(
    customerId,
    "gpu_scaled",
    `Scaled ${direction} from ${fromCount} to ${toCount} GPU${toCount > 1 ? "s" : ""} on ${poolName}`,
    { poolName, fromCount, toCount }
  );
}

export function logGPURestarted(
  customerId: string,
  poolName: string,
  podName?: string,
  subscriptionId?: string
): Promise<ActivityEvent> {
  const desc = podName ? `Restarted GPU "${podName}" on ${poolName}` : `Restarted GPU on ${poolName}`;
  return logActivity(customerId, "gpu_restarted", desc, {
    poolName, podName, subscriptionId,
  });
}

export function logGPUStopped(
  customerId: string,
  poolName: string,
  podName?: string,
  subscriptionId?: string
): Promise<ActivityEvent> {
  const desc = podName ? `Stopped GPU "${podName}" on ${poolName}` : `Stopped GPU on ${poolName}`;
  return logActivity(customerId, "gpu_stopped", desc, {
    poolName, podName, subscriptionId,
  });
}

export function logGPUStarted(
  customerId: string,
  poolName: string,
  podName?: string,
  subscriptionId?: string
): Promise<ActivityEvent> {
  const desc = podName ? `Started GPU "${podName}" on ${poolName}` : `Started GPU on ${poolName}`;
  return logActivity(customerId, "gpu_started", desc, {
    poolName, podName, subscriptionId,
  });
}

export function logGPUTerminated(
  customerId: string,
  poolName: string,
  podName?: string,
  subscriptionId?: string
): Promise<ActivityEvent> {
  const desc = podName ? `Terminated GPU "${podName}" on ${poolName}` : `Terminated GPU on ${poolName}`;
  return logActivity(customerId, "gpu_terminated", desc, {
    poolName, podName, subscriptionId,
  });
}

export function logPaymentReceived(
  customerId: string,
  amount: number,
  currency: string = "USD"
): Promise<ActivityEvent> {
  const formatted = `$${(amount / 100).toFixed(2)}`;
  return logActivity(customerId, "payment_received", `Payment received: ${formatted}`, {
    amount,
    currency,
  });
}

export function logWalletCharged(
  customerId: string,
  amount: number,
  description: string
): Promise<ActivityEvent> {
  const formatted = `$${(amount / 100).toFixed(2)}`;
  return logActivity(customerId, "wallet_charged", `Charged ${formatted}: ${description}`, {
    amount,
    description,
  });
}

// Account events
export function logAccountCreated(
  customerId: string,
  email: string,
  billingType: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "account_created", `Account created (${billingType})`, {
    email,
    billingType,
  });
}

export function logAccountLogin(
  customerId: string,
  email: string,
  isTeamMember: boolean = false
): Promise<ActivityEvent> {
  const desc = isTeamMember ? `Team member logged in: ${email}` : `Logged in`;
  return logActivity(customerId, "account_login", desc, { email, isTeamMember });
}

export function logLoginLinkRequested(
  customerId: string,
  email: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "login_link_requested", `Login link requested`, { email });
}

export function logSettingsUpdated(
  customerId: string,
  setting: string,
  value?: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "settings_updated", `Settings updated: ${setting}`, {
    setting,
    value,
  });
}

export function logTwoFactorEnabled(customerId: string): Promise<ActivityEvent> {
  return logActivity(customerId, "two_factor_enabled", "Two-factor authentication enabled");
}

export function logTwoFactorDisabled(customerId: string): Promise<ActivityEvent> {
  return logActivity(customerId, "two_factor_disabled", "Two-factor authentication disabled");
}

// API key events
export function logApiKeyCreated(
  customerId: string,
  keyName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "api_key_created", `API key created: ${keyName}`, { keyName });
}

export function logApiKeyDeleted(
  customerId: string,
  keyName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "api_key_deleted", `API key deleted: ${keyName}`, { keyName });
}

// SSH key events
export function logSshKeyAdded(
  customerId: string,
  keyName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "ssh_key_added", `SSH key added: ${keyName}`, { keyName });
}

export function logSshKeyDeleted(
  customerId: string,
  keyName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "ssh_key_deleted", `SSH key deleted: ${keyName}`, { keyName });
}

// Team events
export function logTeamMemberInvited(
  customerId: string,
  memberEmail: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "team_member_invited", `Team member invited: ${memberEmail}`, {
    memberEmail,
  });
}

export function logTeamMemberRemoved(
  customerId: string,
  memberEmail: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "team_member_removed", `Team member removed: ${memberEmail}`, {
    memberEmail,
  });
}

export function logTeamMemberJoined(
  customerId: string,
  memberEmail: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "team_member_joined", `Team member joined: ${memberEmail}`, {
    memberEmail,
  });
}

// Billing events
export function logWalletTopup(
  customerId: string,
  amount: number
): Promise<ActivityEvent> {
  const formatted = `$${(amount / 100).toFixed(2)}`;
  return logActivity(customerId, "wallet_topup", `Wallet topped up: ${formatted}`, { amount });
}

export function logVoucherRedeemed(
  customerId: string,
  voucherCode: string,
  creditCents: number
): Promise<ActivityEvent> {
  const formatted = `$${(creditCents / 100).toFixed(2)}`;
  return logActivity(customerId, "voucher_redeemed", `Voucher redeemed: ${voucherCode} (${formatted})`, {
    voucherCode,
    creditCents,
  });
}

export function logBudgetSet(
  customerId: string,
  budgetCents: number
): Promise<ActivityEvent> {
  const formatted = `$${(budgetCents / 100).toFixed(2)}`;
  return logActivity(customerId, "budget_set", `Budget set: ${formatted}/month`, { budgetCents });
}

// Inference events
export function logBatchCreated(
  customerId: string,
  batchId: string,
  requestCount: number
): Promise<ActivityEvent> {
  return logActivity(customerId, "batch_created", `Batch job created: ${requestCount} requests`, {
    batchId,
    requestCount,
  });
}

export function logLoraCreated(
  customerId: string,
  loraName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "lora_created", `LoRA adapter created: ${loraName}`, { loraName });
}

export function logLoraTrainingStarted(
  customerId: string,
  loraName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "lora_training_started", `LoRA training started: ${loraName}`, {
    loraName,
  });
}

export function logLoraTrainingCompleted(
  customerId: string,
  loraName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "lora_training_completed", `LoRA training completed: ${loraName}`, {
    loraName,
  });
}

export function logLoraDeleted(
  customerId: string,
  loraName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "lora_deleted", `LoRA adapter deleted: ${loraName}`, { loraName });
}

// Snapshot events
export function logSnapshotCreated(
  customerId: string,
  snapshotName: string,
  poolName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "snapshot_created", `Snapshot created: ${snapshotName} on ${poolName}`, {
    snapshotName,
    poolName,
  });
}

export function logSnapshotRestored(
  customerId: string,
  snapshotName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "snapshot_restored", `Snapshot restored: ${snapshotName}`, {
    snapshotName,
  });
}

export function logSnapshotDeleted(
  customerId: string,
  snapshotName: string
): Promise<ActivityEvent> {
  return logActivity(customerId, "snapshot_deleted", `Snapshot deleted: ${snapshotName}`, {
    snapshotName,
  });
}

// Get the first gpu_launched event for a customer (for time-to-first-gpu calculation)
export async function getFirstGpuLaunch(
  customerId: string
): Promise<{ timestamp: number } | null> {
  try {
    const db = getPrisma();
    const event = await db.activityEvent.findFirst({
      where: {
        customerId,
        type: "gpu_launched",
      },
      orderBy: { createdAt: "asc" },
    });

    if (!event) return null;

    return {
      timestamp: Math.floor(event.createdAt.getTime() / 1000),
    };
  } catch (error) {
    console.error("Failed to get first GPU launch:", error);
    return null;
  }
}

// Bare Metal events
export function logBareMetalDeployed(
  customerId: string,
  gpuType: string,
  gpuCount: number,
  region: string,
  deploymentId: string
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "bare_metal_deployed",
    `Deployed bare metal: ${gpuType} x${gpuCount} in ${region}`,
    { gpuType, gpuCount, region, deploymentId }
  );
}

export function logBareMetalTerminated(
  customerId: string,
  gpuType: string,
  deploymentId: string
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "bare_metal_terminated",
    `Terminated bare metal: ${gpuType}`,
    { gpuType, deploymentId }
  );
}

// Persistent Storage (Volume) events
export function logVolumeCreated(
  customerId: string,
  volumeName: string,
  sizeInGb: number,
  provider: string
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "volume_created",
    `Created volume "${volumeName}" (${sizeInGb} GB) on ${provider}`,
    { volumeName, sizeInGb, provider }
  );
}

export function logVolumeUpdated(
  customerId: string,
  volumeName: string,
  changes: Record<string, unknown>
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "volume_updated",
    `Updated volume "${volumeName}"`,
    { volumeName, changes }
  );
}

export function logVolumeDeleted(
  customerId: string,
  volumeName: string,
  sizeInGb: number
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "volume_deleted",
    `Deleted volume "${volumeName}" (${sizeInGb} GB)`,
    { volumeName, sizeInGb }
  );
}

export function logVolumeAttached(
  customerId: string,
  volumeName: string,
  deploymentId: string
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "volume_attached",
    `Attached volume "${volumeName}" to deployment`,
    { volumeName, deploymentId }
  );
}

export function logVolumeDetached(
  customerId: string,
  volumeName: string,
  deploymentId: string
): Promise<ActivityEvent> {
  return logActivity(
    customerId,
    "volume_detached",
    `Detached volume "${volumeName}" from deployment`,
    { volumeName, deploymentId }
  );
}

// Get first GPU launch timestamps for all customers (for investor stats)
export async function getAllFirstGpuLaunches(): Promise<
  Map<string, number>
> {
  try {
    const db = getPrisma();
    // Get the earliest gpu_launched event per customerId
    const events = await db.activityEvent.findMany({
      where: { type: "gpu_launched" },
      orderBy: { createdAt: "asc" },
    });

    const firstLaunches = new Map<string, number>();
    for (const event of events) {
      // Only keep the first one per customer
      if (!firstLaunches.has(event.customerId)) {
        firstLaunches.set(
          event.customerId,
          Math.floor(event.createdAt.getTime() / 1000)
        );
      }
    }

    return firstLaunches;
  } catch (error) {
    console.error("Failed to get all first GPU launches:", error);
    return new Map();
  }
}
