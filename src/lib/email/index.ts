/**
 * Email Module
 *
 * Transactional email system using Emailit as the delivery provider.
 * Provides both low-level email sending and pre-built templates for
 * common application events.
 *
 * Templates are organized by category:
 * - Welcome: New customer onboarding emails
 * - Contact: Contact form submissions
 * - GPU Events: GPU launch, termination, and deployment notifications
 *
 * @module email
 *
 * @example
 * ```typescript
 * import { sendWelcomeEmail, sendGpuLaunchedEmail } from "@/lib/email";
 *
 * // Send welcome email to new customer
 * await sendWelcomeEmail({
 *   to: "user@example.com",
 *   customerName: "John",
 *   loginUrl: "https://example.com/..."
 * });
 *
 * // Notify about GPU launch
 * await sendGpuLaunchedEmail({
 *   to: "user@example.com",
 *   gpuType: "NVIDIA A100",
 *   region: "us-east"
 * });
 * ```
 */

// Core client functions
export { sendEmail, sendEmailDirect, sendAdminCopy, type EmailParams } from "./client";

// Utilities
export { escapeHtml, delay } from "./utils";

// Template functions - Welcome
export { sendWelcomeEmail } from "./templates/welcome";

// Template functions - Contact
export { sendContactEmail } from "./templates/contact";

// Template functions - GPU Events
export {
  sendHfDeploymentEmail,
  sendGpuLaunchedEmail,
  sendGpuTerminatedEmail,
  sendHfDeploymentStartedEmail,
} from "./templates/gpu-events";

// Template functions - Support
export { sendSupportReplyNotification } from "./templates/support";

// Template functions - Budget Alerts
export {
  sendBudgetAlertEmail,
  sendAutoShutdownNotificationEmail,
  sendNegativeBalanceShutdownEmail,
} from "./templates/budget";

// Template functions - Pod Failure Alerts
export { sendPodFailureAlertEmail } from "./templates/pod-failure";

// Template functions - Midnight Status Report
export { sendMidnightStatusEmail, type DailySnapshot, type MidnightStatusEmailParams } from "./templates/midnight-status";
