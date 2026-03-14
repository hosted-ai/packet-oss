import { prisma } from "@/lib/prisma";

// Admin activity event types
export type AdminActivityType =
  | "admin_login"
  | "admin_added"
  | "admin_removed"
  | "admin_invite_resent"
  | "customer_viewed"
  | "customer_credit_added"
  | "quote_created"
  | "quote_updated"
  | "quote_deleted"
  | "quote_sent"
  | "quote_reminder_sent"
  | "cluster_created"
  | "cluster_updated"
  | "cluster_deleted"
  | "settings_updated"
  | "quote_request_received"
  | "login_link_sent"
  | "customer_login"
  | "email_template_created"
  | "email_template_updated"
  | "email_template_deleted"
  | "pod_stop"
  | "pod_start"
  | "pod_restart"
  | "pod_terminate"
  | "wallet_adjustment"
  | "admin_pin_set";

export interface AdminActivity {
  id: string;
  type: AdminActivityType;
  adminEmail: string;
  description: string;
  metadata?: Record<string, unknown>;
  created: number; // Unix timestamp
}

// Log a new admin activity
export async function logAdminActivity(
  adminEmail: string,
  type: AdminActivityType,
  description: string,
  metadata?: Record<string, unknown>
): Promise<AdminActivity> {
  try {
    const event = await prisma.adminActivityEvent.create({
      data: {
        adminEmail,
        type,
        description,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return {
      id: event.id,
      type: event.type as AdminActivityType,
      adminEmail: event.adminEmail,
      description: event.description,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
      created: Math.floor(event.createdAt.getTime() / 1000),
    };
  } catch (error) {
    console.error("Failed to log admin activity:", error);
    // Return a mock event if database fails - don't break the app
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      adminEmail,
      description,
      metadata,
      created: Math.floor(Date.now() / 1000),
    };
  }
}

// Get admin activity events
export async function getAdminActivities(
  limit: number = 100
): Promise<AdminActivity[]> {
  try {
    const events = await prisma.adminActivityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return events.map((event) => ({
      id: event.id,
      type: event.type as AdminActivityType,
      adminEmail: event.adminEmail,
      description: event.description,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
      created: Math.floor(event.createdAt.getTime() / 1000),
    }));
  } catch (error) {
    console.error("Failed to get admin activities:", error);
    return [];
  }
}

// Helper functions for common admin events

export function logAdminLogin(adminEmail: string): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "admin_login",
    `Admin logged in`
  );
}

export function logAdminAdded(
  adminEmail: string,
  newAdminEmail: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "admin_added",
    `Added ${newAdminEmail} as admin`,
    { newAdminEmail }
  );
}

export function logAdminRemoved(
  adminEmail: string,
  removedAdminEmail: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "admin_removed",
    `Removed ${removedAdminEmail} from admins`,
    { removedAdminEmail }
  );
}

export function logAdminInviteResent(
  adminEmail: string,
  invitedAdminEmail: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "admin_invite_resent",
    `Resent admin invite to ${invitedAdminEmail}`,
    { invitedAdminEmail }
  );
}

export function logCustomerViewed(
  adminEmail: string,
  customerId: string,
  customerEmail: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "customer_viewed",
    `Viewed customer ${customerEmail}`,
    { customerId, customerEmail }
  );
}

export function logCustomerCreditAdded(
  adminEmail: string,
  customerId: string,
  customerEmail: string,
  amount: number
): Promise<AdminActivity> {
  const formatted = `$${(amount / 100).toFixed(2)}`;
  return logAdminActivity(
    adminEmail,
    "customer_credit_added",
    `Added ${formatted} credit to ${customerEmail}`,
    { customerId, customerEmail, amount }
  );
}

export function logQuoteCreated(
  adminEmail: string,
  quoteNumber: string,
  customerEmail: string,
  quoteId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "quote_created",
    `Created quote ${quoteNumber} for ${customerEmail}`,
    { quoteNumber, customerEmail, quoteId }
  );
}

export function logQuoteUpdated(
  adminEmail: string,
  quoteNumber: string,
  quoteId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "quote_updated",
    `Updated quote ${quoteNumber}`,
    { quoteNumber, quoteId }
  );
}

export function logQuoteDeleted(
  adminEmail: string,
  quoteNumber: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "quote_deleted",
    `Deleted quote ${quoteNumber}`,
    { quoteNumber }
  );
}

export function logQuoteSent(
  adminEmail: string,
  quoteNumber: string,
  customerEmail: string,
  quoteId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "quote_sent",
    `Sent quote ${quoteNumber} to ${customerEmail}`,
    { quoteNumber, customerEmail, quoteId }
  );
}

export function logQuoteReminderSent(
  adminEmail: string,
  quoteNumber: string,
  customerEmail: string,
  quoteId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "quote_reminder_sent",
    `Sent reminder for quote ${quoteNumber} to ${customerEmail}`,
    { quoteNumber, customerEmail, quoteId }
  );
}

export function logClusterCreated(
  adminEmail: string,
  clusterName: string,
  clusterId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "cluster_created",
    `Created cluster offer "${clusterName}"`,
    { clusterName, clusterId }
  );
}

export function logClusterUpdated(
  adminEmail: string,
  clusterName: string,
  clusterId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "cluster_updated",
    `Updated cluster offer "${clusterName}"`,
    { clusterName, clusterId }
  );
}

export function logClusterDeleted(
  adminEmail: string,
  clusterName: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "cluster_deleted",
    `Deleted cluster offer "${clusterName}"`,
    { clusterName }
  );
}

export function logSettingsUpdated(
  adminEmail: string,
  settingName: string
): Promise<AdminActivity> {
  return logAdminActivity(
    adminEmail,
    "settings_updated",
    `Updated ${settingName} settings`,
    { settingName }
  );
}

export function logQuoteRequestReceived(
  customerEmail: string,
  quoteNumber: string,
  quoteId: string
): Promise<AdminActivity> {
  return logAdminActivity(
    "system",
    "quote_request_received",
    `New quote request ${quoteNumber} from ${customerEmail}`,
    { customerEmail, quoteNumber, quoteId }
  );
}

export function logLoginLinkSent(
  customerEmail: string,
  isTeamMember: boolean = false
): Promise<AdminActivity> {
  const userType = isTeamMember ? "team member" : "customer";
  return logAdminActivity(
    "system",
    "login_link_sent",
    `Login link sent to ${userType} ${customerEmail}`,
    { customerEmail, isTeamMember }
  );
}

export function logCustomerLogin(
  customerEmail: string,
  customerId: string,
  isTeamMember: boolean = false
): Promise<AdminActivity> {
  const userType = isTeamMember ? "Team member" : "Customer";
  return logAdminActivity(
    "system",
    "customer_login",
    `${userType} ${customerEmail} logged in`,
    { customerEmail, customerId, isTeamMember }
  );
}
