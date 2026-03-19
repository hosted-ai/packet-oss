/**
 * Email Module
 *
 * Transactional email system using SMTP via nodemailer.
 * Transport configured via Platform Settings (SMTP_HOST, etc.).
 * Provides both low-level email sending and pre-built templates for
 * common application events.
 *
 * Templates are organized by category:
 * - Welcome: New customer onboarding emails
 * - Contact: Contact form submissions
 * - GPU Events: GPU launch, termination, and deployment notifications
 * - Quotes: Custom quote requests and responses
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
export {
  sendEmail, sendEmailDirect, sendAdminCopy,
  verifySmtpConnection, getActiveTransport, clearSmtpPool, autoDetectTls,
  type EmailParams, type EmailDirectParams,
} from "./client";

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

// Template functions - Quotes
// OSS stub — original: export {   sendQuoteEmail,   sendQuoteResponseNotification,   sendQuoteReminderEmail,   generateQuoteEmailHtml,   type QuoteEmailParams, } from "./templates/quotes";
export function sendQuoteEmail(..._args: unknown[]) { return undefined as any; }
export function sendQuoteResponseNotification(..._args: unknown[]) { return undefined as any; }
export function sendQuoteReminderEmail(..._args: unknown[]) { return undefined as any; }
export function generateQuoteEmailHtml(..._args: unknown[]) { return undefined as any; }
export type QuoteEmailParams = Record<string, never>;

// Template functions - Support
// OSS stub — original: export { sendSupportReplyNotification } from "./templates/support";
export function sendSupportReplyNotification(..._args: unknown[]) { return undefined as any; }

// Template functions - Budget Alerts
export {
  sendBudgetAlertEmail,
  sendAutoShutdownNotificationEmail,
  sendNegativeBalanceShutdownEmail,
} from "./templates/budget";

// Template functions - Batch Jobs
// OSS stub — original: export { sendBatchCompletionEmail } from "./templates/batch";
export function sendBatchCompletionEmail(..._args: unknown[]) { return undefined as any; }

// Template functions - Pod Failure Alerts
export { sendPodFailureAlertEmail } from "./templates/pod-failure";

// Template functions - Midnight Status Report
export { sendMidnightStatusEmail, type DailySnapshot, type MidnightStatusEmailParams } from "./templates/midnight-status";
