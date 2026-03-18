"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Eye, Save, X, AlertCircle, Check, ChevronDown, ChevronRight, Send } from "lucide-react";

interface EmailTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  subject: string;
  htmlContent: string;
  textContent: string | null;
  variables: string;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

// Default templates that can be created from scratch
const DEFAULT_TEMPLATES = [
  // ── Signup & onboarding ──
  {
    slug: "signup-welcome",
    name: "Signup Welcome",
    description: "Sent to new users after free signup — includes API key and dashboard link",
    variables: ["customerName", "dashboardUrl", "apiKey", "gpuName"],
    defaultSubject: "Your account is ready",
  },
  {
    slug: "welcome",
    name: "Paid Welcome",
    description: "Sent to customers after paid checkout with wallet balance",
    variables: ["customerName", "productName", "dashboardUrl", "walletBalance"],
    defaultSubject: "Welcome — Your GPU wallet is ready",
  },
  // ── GPU events ──
  {
    slug: "gpu-launched",
    name: "GPU Launched",
    description: "Sent when a customer launches a new GPU instance",
    variables: ["customerName", "poolName", "gpuCount", "dashboardUrl"],
    defaultSubject: "GPU instance started",
  },
  {
    slug: "gpu-terminated",
    name: "GPU Terminated",
    description: "Sent when a GPU is terminated",
    variables: ["customerName", "poolName", "dashboardUrl"],
    defaultSubject: "GPU terminated",
  },
  {
    slug: "model-deploying",
    name: "Model Deploying",
    description: "Sent when a HuggingFace model deployment starts",
    variables: ["customerName", "modelName", "dashboardUrl"],
    defaultSubject: "Deploying your model",
  },
  {
    slug: "model-deployed",
    name: "Model Deployed",
    description: "Sent when a model deployment succeeds",
    variables: ["customerName", "modelName", "dashboardUrl"],
    defaultSubject: "Your model is ready",
  },
  {
    slug: "model-deploy-failed",
    name: "Model Deploy Failed",
    description: "Sent when a model deployment fails",
    variables: ["customerName", "modelName", "dashboardUrl", "errorMessage"],
    defaultSubject: "Deployment failed",
  },
  // ── Billing & budget ──
  {
    slug: "budget-alert",
    name: "Budget Alert",
    description: "Sent at 50%, 80%, 100% budget thresholds",
    variables: ["customerName", "alertTitle", "alertMessage", "currentSpend", "limit", "percentUsed", "limitTypeLabel", "dashboardUrl"],
    defaultSubject: "Budget Alert",
  },
  {
    slug: "auto-shutdown",
    name: "Auto-Shutdown",
    description: "Sent when instances are stopped due to budget limit",
    variables: ["customerName", "currentSpend", "limit", "limitTypeLabel", "dashboardUrl"],
    defaultSubject: "GPU instances stopped — budget threshold reached",
  },
  {
    slug: "negative-balance",
    name: "Negative Balance",
    description: "Sent when account goes negative and resources are terminated",
    variables: ["customerName", "balanceOwed", "dashboardUrl", "podsTerminated", "volumesDeleted"],
    defaultSubject: "Account resources terminated — negative balance",
  },
  // ── Support ──
  {
    slug: "support-reply",
    name: "Support Reply",
    description: "Sent when support replies to a ticket",
    variables: ["customerName", "ticketTitle", "messagePreview", "dashboardUrl"],
    defaultSubject: "New reply to your support ticket",
  },
  // ── Batch jobs ──
  {
    slug: "batch-completed",
    name: "Batch Completed",
    description: "Sent when a batch inference job completes",
    variables: ["customerName", "modelName", "dashboardUrl", "totalRequests", "completedRequests"],
    defaultSubject: "Batch job completed",
  },
  // ── Quotes ──
  {
    slug: "quote",
    name: "Quote Sent",
    description: "Sent to customer with their GPU cluster quote",
    variables: ["customerName", "quoteNumber", "quoteUrl", "gpuType", "gpuCount"],
    defaultSubject: "Your GPU Cluster Quote",
  },
  {
    slug: "quote-reminder",
    name: "Quote Reminder",
    description: "Sent when a quote is about to expire",
    variables: ["customerName", "quoteNumber", "quoteUrl", "gpuType", "gpuCount", "expiresDate"],
    defaultSubject: "Your quote expires soon",
  },
  // ── Drip campaign ──
  {
    slug: "drip-day1-api",
    name: "Drip: Day 1 — API Quick Start",
    description: "Sent 24h after free signup — get first API call working",
    variables: ["customerName", "dashboardUrl"],
    defaultSubject: "Make your first API call in 30 seconds",
  },
  {
    slug: "drip-day3-explore",
    name: "Drip: Day 3 — Explore Features",
    description: "Sent 3 days after signup — highlight batch, embeddings, models",
    variables: ["customerName", "dashboardUrl"],
    defaultSubject: "3 things you can build with your GPU",
  },
  {
    slug: "drip-day7-deploy",
    name: "Drip: Day 7 — Deploy a GPU",
    description: "Sent 7 days after signup — encourage first GPU deployment",
    variables: ["customerName", "dashboardUrl"],
    defaultSubject: "Ready to deploy? $50 gets you started",
  },
  {
    slug: "drip-day14-value",
    name: "Drip: Day 14 — Case Study",
    description: "Sent 14 days after signup — social proof and case study",
    variables: ["customerName", "dashboardUrl"],
    defaultSubject: "How developers are using the platform",
  },
  // ── Contact & support ──
  {
    slug: "contact-form",
    name: "Contact Form",
    description: "Internal notification when someone submits the contact form",
    variables: ["name", "email", "company", "message", "brandName"],
    defaultSubject: "New inquiry from {{name}}",
  },
  {
    slug: "pod-failure",
    name: "Pod Failure Alert",
    description: "Internal alert when a customer pod enters a failed status",
    variables: ["podName", "podStatus", "subscriptionId", "teamId", "customerEmail", "poolName", "gpuCount", "region"],
    defaultSubject: "[URGENT] Pod Failed: {{podName}}",
  },
  {
    slug: "storage-alert",
    name: "Storage Alert",
    description: "Sent to customer when persistent storage exceeds 80% usage",
    variables: ["displayName", "usedGb", "totalGb", "percent", "dashboardUrl"],
    defaultSubject: "Storage almost full on {{displayName}} — {{percent}}% used",
  },
  // ── Provider portal ──
  {
    slug: "provider-login",
    name: "Provider Login",
    description: "Magic link email for provider dashboard login",
    variables: ["companyName", "loginUrl", "brandName"],
    defaultSubject: "Login to Provider Portal",
  },
  {
    slug: "provider-app-received",
    name: "Provider Application Received",
    description: "Confirmation sent when a provider submits their application",
    variables: ["contactName", "companyName", "brandName", "supportEmail"],
    defaultSubject: "Application Received — {{companyName}}",
  },
  {
    slug: "provider-approved",
    name: "Provider Approved",
    description: "Sent when a provider application is approved",
    variables: ["contactName", "companyName", "loginUrl", "brandName", "supportEmail"],
    defaultSubject: "Your Provider Account is Approved!",
  },
  {
    slug: "provider-rejected",
    name: "Provider Rejected",
    description: "Sent when a provider application is not approved",
    variables: ["contactName", "companyName", "reason", "brandName", "supportEmail"],
    defaultSubject: "Provider Application Update",
  },
  {
    slug: "node-approved",
    name: "Node Approved",
    description: "Sent to provider when their server node is approved",
    variables: ["contactName", "nodeName", "brandName"],
    defaultSubject: "Your node has been approved",
  },
  {
    slug: "node-live",
    name: "Node Live",
    description: "Sent to provider when their node goes live on the marketplace",
    variables: ["contactName", "nodeName", "brandName"],
    defaultSubject: "Your node is now live",
  },
  {
    slug: "node-removal-scheduled",
    name: "Node Removal Scheduled",
    description: "Sent to provider when their node is scheduled for removal",
    variables: ["contactName", "nodeName", "removalDate", "brandName"],
    defaultSubject: "Node removal scheduled",
  },
  {
    slug: "provider-server-vacated",
    name: "Server Vacated",
    description: "Sent to provider when all customers have been migrated off their server",
    variables: ["contactName", "nodeName", "brandName"],
    defaultSubject: "Server vacated — ready for removal",
  },
  {
    slug: "customer-server-removal",
    name: "Customer Server Removal",
    description: "Sent to customer when their instance is being migrated due to server removal",
    variables: ["customerName", "nodeName", "migrationDate", "brandName"],
    defaultSubject: "Your instance is being migrated",
  },
  {
    slug: "admin-new-provider",
    name: "Admin: New Provider",
    description: "Internal alert when a new provider application is submitted",
    variables: ["companyName", "contactName", "contactEmail"],
    defaultSubject: "New provider application: {{companyName}}",
  },
  {
    slug: "admin-new-node",
    name: "Admin: New Node",
    description: "Internal alert when a provider adds a new server node",
    variables: ["companyName", "nodeName", "gpuType", "gpuCount"],
    defaultSubject: "New node added: {{nodeName}}",
  },
  // ── Tenant ──
  {
    slug: "tenant-welcome",
    name: "Tenant Welcome",
    description: "Sent to resellers when their white-label tenant is created",
    variables: ["contactName", "brandName", "setupUrl", "slug", "previewUrl"],
    defaultSubject: "Your {{brandName}} Platform is Ready",
  },
  {
    slug: "tenant-admin-login",
    name: "Tenant Admin Login",
    description: "Magic link for tenant reseller admin portal login",
    variables: ["tenantBrandName", "setupUrl", "previewUrl", "brandName"],
    defaultSubject: "Admin Login - {{tenantBrandName}}",
  },
  {
    slug: "tenant-customer-login",
    name: "Tenant Customer Login",
    description: "Magic link for tenant end-customer dashboard login",
    variables: ["tenantBrandName", "loginUrl"],
    defaultSubject: "Login - {{tenantBrandName}}",
  },
  {
    slug: "tenant-customer-welcome",
    name: "Tenant Customer Welcome",
    description: "Sent to tenant end-customers after signup",
    variables: ["tenantBrandName", "loginUrl"],
    defaultSubject: "Welcome to {{tenantBrandName}}",
  },
  // ── Login & auth ──
  {
    slug: "customer-login",
    name: "Customer Login",
    description: "Magic link sent to customers to access their dashboard",
    variables: ["customerName", "accountUrl", "billingUrl", "brandName", "dashboardUrl"],
    defaultSubject: "Your {{brandName}} login link",
  },
  {
    slug: "free-trial-login",
    name: "Free Trial Login",
    description: "Magic link for free trial users (no billing portal)",
    variables: ["customerName", "accountUrl", "brandName", "dashboardUrl"],
    defaultSubject: "Your {{brandName}} login link",
  },
  {
    slug: "team-member-login",
    name: "Team Member Login",
    description: "Magic link for team members to access the shared dashboard",
    variables: ["memberName", "teamOwnerName", "accountUrl", "expiryText", "brandName", "dashboardUrl"],
    defaultSubject: "Your {{brandName}} login link",
  },
  {
    slug: "team-member-invite",
    name: "Team Member Invite",
    description: "Invitation email sent when a team owner adds a new member",
    variables: ["inviterName", "inviterEmail", "teamOwnerName", "dashboardUrl", "brandName"],
    defaultSubject: "{{inviterName}} invited you to {{brandName}}",
  },
  {
    slug: "admin-login",
    name: "Admin Login",
    description: "Magic link for admin dashboard login",
    variables: ["email", "loginUrl", "brandName"],
    defaultSubject: "Admin Login - {{brandName}}",
  },
  {
    slug: "admin-invite",
    name: "Admin Invite",
    description: "Invitation email when adding a new admin user",
    variables: ["email", "loginUrl", "invitedBy", "brandName"],
    defaultSubject: "You've been invited as an admin - {{brandName}}",
  },
  {
    slug: "widget-login",
    name: "Widget Login",
    description: "Magic link sent from embedded widget authentication",
    variables: ["customerName", "loginUrl", "tenantBrandName"],
    defaultSubject: "Your {{tenantBrandName}} login link",
  },
  // ── Investor ──
  {
    slug: "investor-invite",
    name: "Investor Invite",
    description: "Invitation to access the investor dashboard with real-time metrics",
    variables: ["email", "loginUrl", "invitedBy", "brandName"],
    defaultSubject: "You've been invited to the {{brandName}} Investor Dashboard",
  },
  {
    slug: "investor-login",
    name: "Investor Login",
    description: "Magic link for investor dashboard login",
    variables: ["email", "loginUrl", "brandName"],
    defaultSubject: "Investor Dashboard Login - {{brandName}}",
  },
  // ── Sales notifications ──
  {
    slug: "quote-request-notification",
    name: "Quote Request (Internal)",
    description: "Internal notification sent to sales when a customer requests a GPU quote",
    variables: ["name", "email", "company", "phone", "gpuType", "gpuCount", "location", "commitmentMonths", "budget", "requirements", "quoteNumber", "adminUrl"],
    defaultSubject: "New Quote Request: {{gpuCount}}x {{gpuType}} - {{quoteNumber}}",
  },
  {
    slug: "cluster-inquiry-notification",
    name: "Cluster Inquiry (Internal)",
    description: "Internal notification sent to sales when a customer inquires about a cluster",
    variables: ["name", "email", "company", "phone", "offerName", "gpuType", "gpuCount", "gpuMemory", "location", "minimumCommitment", "message", "offerId"],
    defaultSubject: "Cluster Inquiry: {{offerName}}",
  },
  // ── Game ──
  {
    slug: "game-voucher",
    name: "GPU Tetris Voucher",
    description: "Voucher code email sent to GPU Tetris game winners",
    variables: ["voucherCode", "creditDollars", "expiresDate", "brandName", "dashboardUrl", "supportEmail", "appUrl"],
    defaultSubject: "Your GPU Tetris Voucher: {{voucherCode}}",
  },
  // ── System ──
  {
    slug: "system-alert",
    name: "System Alert",
    description: "Critical system alerts (pod failures, provisioning errors, etc.)",
    variables: ["alertTitle", "alertBody"],
    defaultSubject: "[System Alert] {{alertTitle}}",
  },
  {
    slug: "midnight-status",
    name: "Midnight Status Report",
    description: "Daily KPI report with revenue, customers, and pod metrics",
    variables: ["date", "totalRevenue", "mrr", "activeCustomers", "totalPods", "brandName"],
    defaultSubject: "Daily Status Report — {{date}}",
  },
];

// ── Email Settings (from name, company, footer) ───────────────────────────

const EMAIL_SETTING_FIELDS: { key: string; label: string; placeholder: string; helper?: string }[] = [
  { key: "EMAIL_FROM_NAME", label: "From Name", placeholder: "e.g. My GPU Platform" },
  { key: "EMAIL_FROM_ADDRESS", label: "From Email Address", placeholder: "e.g. no-reply@example.com" },
  { key: "COMPANY_NAME", label: "Company Name", placeholder: "e.g. Acme Inc." },
  { key: "COMPANY_ADDRESS", label: "Company Address (CAN-SPAM)", placeholder: "e.g. 123 Main St, City, State, ZIP", helper: "Required for CAN-SPAM compliance in commercial emails." },
  { key: "EMAIL_FOOTER_TEXT", label: "Footer Text", placeholder: "Custom text shown in email footer" },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailSettingsSection() {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform-settings");
      if (res.ok) {
        const json = await res.json();
        const emailService = json.services?.email;
        if (emailService?.settings) {
          const initial: Record<string, string> = {};
          for (const [key, val] of Object.entries(emailService.settings)) {
            initial[key] = (val as string) || "";
          }
          setValues(initial);
        }
      }
    } catch {
      // Silently fail — settings may not be configured yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) fetchSettings();
  }, [expanded, fetchSettings]);

  // D1: Auto-dismiss success messages after 3s
  useEffect(() => {
    if (message?.type === "success") {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  function validateEmail() {
    const addr = values.EMAIL_FROM_ADDRESS?.trim();
    if (addr && !EMAIL_REGEX.test(addr)) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function handleSave() {
    if (!validateEmail()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: values }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Email settings saved!" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/email-templates/test", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Test email sent to ${data.recipient}` });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send test email" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to send test email" });
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#e4e7ef] mb-8">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full p-5 flex items-center justify-between text-left"
      >
        <div>
          <h3 className="font-semibold text-[#0b0f1c]">Email Settings</h3>
          <p className="text-xs text-[#5b6476] mt-0.5">
            Sender name, address, company info, and footer text for all outgoing emails.
          </p>
        </div>
        {expanded
          ? <ChevronDown className="w-5 h-5 text-[#5b6476]" aria-hidden="true" />
          : <ChevronRight className="w-5 h-5 text-[#5b6476]" aria-hidden="true" />
        }
      </button>

      {expanded && (
        <div className="border-t border-[#e4e7ef] p-5 space-y-4 bg-zinc-50/50">
          {loading ? (
            <p className="text-sm text-[#5b6476]">Loading...</p>
          ) : (
            <>
              {EMAIL_SETTING_FIELDS.map(({ key, label, placeholder, helper }) => (
                <div key={key}>
                  <label htmlFor={`email-setting-${key}`} className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    {label}
                  </label>
                  <input
                    id={`email-setting-${key}`}
                    type="text"
                    value={values[key] || ""}
                    onChange={(e) => {
                      setValues({ ...values, [key]: e.target.value });
                      if (key === "EMAIL_FROM_ADDRESS") setEmailError(null);
                    }}
                    onBlur={() => { if (key === "EMAIL_FROM_ADDRESS") validateEmail(); }}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                  {key === "EMAIL_FROM_ADDRESS" && emailError && (
                    <p className="text-xs text-red-500 mt-1">{emailError}</p>
                  )}
                  {helper && (
                    <p className="text-xs text-[#5b6476] mt-1">{helper}</p>
                  )}
                </div>
              ))}

              {message && (
                <div
                  role="alert"
                  className={`p-3 rounded-lg text-sm ${
                    message.type === "success"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1a4fff]/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleSendTest}
                  disabled={sendingTest}
                  className="px-4 py-2 bg-white border border-[#e4e7ef] hover:bg-zinc-50 text-[#0b0f1c] rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  {sendingTest ? "Sending..." : "Send Test Email"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDefault, setLoadingDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    slug: "",
    name: "",
    description: "",
    subject: "",
    htmlContent: "",
    textContent: "",
    variables: [] as string[],
    active: true,
  });

  // Load templates
  const loadTemplates = async () => {
    try {
      const res = await fetch("/api/admin/email-templates");
      const data = await res.json();
      if (data.success) {
        setTemplates(data.data);
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // Open edit modal
  const handleEdit = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setFormData({
      slug: template.slug,
      name: template.name,
      description: template.description || "",
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent || "",
      variables: JSON.parse(template.variables || "[]"),
      active: template.active,
    });
    setError(null);
    setSuccess(null);
  };

  // Create new template from default — fetches the actual code-based fallback HTML
  // from the server so the admin sees the real email, not a placeholder skeleton.
  const handleCreateFromDefault = async (defaultTemplate: typeof DEFAULT_TEMPLATES[0]) => {
    setEditingTemplate(null);
    setError(null);
    setSuccess(null);
    setLoadingDefault(true);

    // Optimistically set form data with the slug/name so the editor section appears
    setFormData({
      slug: defaultTemplate.slug,
      name: defaultTemplate.name,
      description: defaultTemplate.description,
      subject: defaultTemplate.defaultSubject,
      htmlContent: "",
      textContent: "",
      variables: defaultTemplate.variables,
      active: true,
    });

    try {
      const res = await fetch(`/api/admin/email-templates/defaults?slug=${encodeURIComponent(defaultTemplate.slug)}`);
      if (res.ok) {
        const data = await res.json();
        setFormData((prev) => ({
          ...prev,
          subject: data.subject || prev.subject,
          htmlContent: data.html || generateDefaultHtml(defaultTemplate),
          textContent: data.text || "",
        }));
      } else {
        // Server doesn't have a renderer for this slug — use generic fallback
        setFormData((prev) => ({
          ...prev,
          htmlContent: generateDefaultHtml(defaultTemplate),
        }));
      }
    } catch {
      // Network error — use generic fallback
      setFormData((prev) => ({
        ...prev,
        htmlContent: generateDefaultHtml(defaultTemplate),
      }));
    } finally {
      setLoadingDefault(false);
    }
  };

  // Generic fallback HTML skeleton — used only when the server-side default
  // renderer is not available for a given slug.
  const generateDefaultHtml = (template: typeof DEFAULT_TEMPLATES[0]) => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #000; margin: 0; font-size: 28px;">GPU Cloud</h1>
  </div>

  <h2 style="color: #000; font-size: 22px;">Hey {{customerName}},</h2>

  <p style="font-size: 16px;">
    <!-- Add your email content here -->
    This is the ${template.name} email template.
  </p>

  <p style="font-size: 16px;">
    Available variables: ${template.variables.map(v => `{{${v}}}`).join(", ")}
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 13px; text-align: center;">
    <strong>The Team</strong>
  </p>
</body>
</html>`;
  };

  // Save template
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const method = editingTemplate ? "PUT" : "POST";
      const url = editingTemplate
        ? `/api/admin/email-templates/${editingTemplate.slug}`
        : "/api/admin/email-templates";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          variables: formData.variables,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(editingTemplate ? "Template updated!" : "Template created!");
        loadTemplates();
        setTimeout(() => {
          setEditingTemplate(null);
          setFormData({
            slug: "",
            name: "",
            description: "",
            subject: "",
            htmlContent: "",
            textContent: "",
            variables: [],
            active: true,
          });
        }, 1500);
      } else {
        setError(data.error || "Failed to save template");
      }
    } catch (err) {
      setError("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  // Delete template
  const handleDelete = async (template: EmailTemplate) => {
    if (!confirm(`Delete "${template.name}"? This will revert to the code-based template.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/email-templates/${template.slug}`, {
        method: "DELETE",
      });

      if (res.ok) {
        loadTemplates();
      }
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  // Preview with sample data
  const handlePreview = () => {
    let html = formData.htmlContent;
    // Replace variables with sample data
    const sampleData: Record<string, string> = {
      customerName: "John Doe",
      productName: "RTX 6000 Ada",
      dashboardUrl: "https://your-dashboard-url/dashboard?token=xxx",
      gpuType: "NVIDIA RTX 6000 Ada",
      gpuName: "NVIDIA B200",
      region: "EU West",
      duration: "4 hours 32 minutes",
      cost: "$9.07",
      balance: "$12.50",
      walletBalance: "$50.00",
      topupUrl: "https://your-dashboard-url/account",
      ticketSubject: "Help with deployment",
      ticketTitle: "Help with deployment",
      ticketUrl: "https://your-dashboard-url/support/123",
      messagePreview: "We've looked into your issue and here's what we found...",
      apiKey: "pk-abc123def456ghi789jkl012",
      poolName: "my-gpu-pool",
      gpuCount: "2",
      modelName: "meta-llama/Llama-3-8B-Instruct",
      errorMessage: "CUDA out of memory",
      alertTitle: "Daily Budget: 80% Used",
      alertMessage: "You are approaching your daily budget limit.",
      currentSpend: "$40.00",
      limit: "$50.00",
      percentUsed: "80",
      limitTypeLabel: "Daily",
      balanceOwed: "$12.50",
      podsTerminated: "2",
      volumesDeleted: "1",
      totalRequests: "1000",
      completedRequests: "998",
      quoteNumber: "Q-2026-001",
      quoteUrl: "https://your-dashboard-url/quotes/Q-2026-001",
      expiresDate: "Friday, March 15, 2026",
      companyName: "Acme Inc.",
      companyAddress: "123 Main St, City, State, ZIP",
      emailFooterText: "Powered by GPU Cloud",
      // Login & auth
      memberName: "Jane Smith",
      teamOwnerName: "John Doe",
      accountUrl: "https://your-dashboard-url/dashboard?token=xxx",
      billingUrl: "https://billing.stripe.com/session/xxx",
      expiryText: "1 hour",
      brandName: "GPU Cloud",
      loginUrl: "https://your-dashboard-url/admin/verify?token=xxx",
      email: "john@example.com",
      invitedBy: "admin@example.com",
      inviterName: "John Doe",
      inviterEmail: "john@example.com",
      dashboardBaseUrl: "https://your-dashboard-url",
      // Tenant
      tenantBrandName: "My GPU Platform",
      setupUrl: "https://your-dashboard-url/tenants/setup?token=xxx",
      previewUrl: "https://my-platform.tenants.example.com",
      // Game
      voucherCode: "GAME-AB12-CD34",
      creditDollars: "1.50",
      supportEmail: "support@example.com",
      appUrl: "https://your-dashboard-url",
      // Sales
      name: "John Doe",
      company: "Acme Inc.",
      phone: "+1 555-0123",
      location: "US East",
      commitmentMonths: "6",
      budget: "$10,000/month",
      requirements: "Need NVLink interconnect for distributed training.",
      adminUrl: "https://your-dashboard-url/admin#quotes",
      offerName: "8x H100 SXM5 Cluster",
      gpuMemory: "80GB HBM3",
      minimumCommitment: "3 months",
      pricingRows: "<tr><td>Monthly</td><td>$25/hr</td></tr>",
      specsHtml: "<ul><li>CPU: AMD EPYC 9654</li></ul>",
      message: "Interested in a dedicated cluster for our ML team.",
      offerId: "cluster-h100-8x",
    };

    for (const [key, value] of Object.entries(sampleData)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    setPreviewHtml(html);
  };

  // Get templates that haven't been created yet
  const missingTemplates = DEFAULT_TEMPLATES.filter(
    (dt) => !templates.find((t) => t.slug === dt.slug)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1a4fff]" />
      </div>
    );
  }

  // Edit/Create form
  if (editingTemplate !== null || formData.slug) {
    return (
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[#0b0f1c]">
            {editingTemplate ? `Edit: ${editingTemplate.name}` : `Create: ${formData.name}`}
          </h2>
          <button
            onClick={() => {
              setEditingTemplate(null);
              setFormData({
                slug: "",
                name: "",
                description: "",
                subject: "",
                htmlContent: "",
                textContent: "",
                variables: [],
                active: true,
              });
            }}
            className="text-[#5b6476] hover:text-[#0b0f1c]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 flex items-center gap-2">
            <Check className="w-4 h-4" />
            {success}
          </div>
        )}

        <div className="bg-white rounded-xl border border-[#e4e7ef] p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                Template Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                Slug (ID)
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                disabled={!!editingTemplate}
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] disabled:bg-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
              Subject Line
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
              placeholder="Use {{variables}} for dynamic content"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
              Available Variables
            </label>
            <div className="flex flex-wrap gap-2">
              {formData.variables.map((v) => (
                <span
                  key={v}
                  className="px-2 py-1 bg-[#f7f8fb] text-[#5b6476] text-sm rounded-lg font-mono"
                >
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-[#0b0f1c]">
                HTML Content
              </label>
              <button
                onClick={handlePreview}
                className="text-sm text-[#1a4fff] hover:underline flex items-center gap-1"
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
            </div>
            <textarea
              value={formData.htmlContent}
              onChange={(e) => setFormData({ ...formData, htmlContent: e.target.value })}
              rows={20}
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
              Plain Text Content (optional)
            </label>
            <textarea
              value={formData.textContent}
              onChange={(e) => setFormData({ ...formData, textContent: e.target.value })}
              rows={6}
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] font-mono text-sm"
              placeholder="Auto-generated from HTML if left empty"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-4 h-4 text-[#1a4fff] rounded"
            />
            <label htmlFor="active" className="text-sm text-[#0b0f1c]">
              Active (use database template instead of code)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => {
                setEditingTemplate(null);
                setFormData({
                  slug: "",
                  name: "",
                  description: "",
                  subject: "",
                  htmlContent: "",
                  textContent: "",
                  variables: [],
                  active: true,
                });
              }}
              className="px-4 py-2 text-[#5b6476] hover:text-[#0b0f1c]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Template"}
            </button>
          </div>
        </div>

        {/* Preview Modal */}
        {previewHtml && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold">Email Preview</h3>
                <button onClick={() => setPreviewHtml(null)}>
                  <X className="w-5 h-5 text-[#5b6476]" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="border rounded-lg">
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-[500px]"
                    title="Email Preview"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Template list
  return (
    <div>
      <p className="text-[#5b6476] mb-6">
        Configure email sender settings and customize templates. Changes take effect immediately.
      </p>

      <EmailSettingsSection />

      {/* Existing templates */}
      {templates.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">Active Templates ({templates.length})</h3>
          <div className="grid gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-white rounded-xl border border-[#e4e7ef] p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-[#0b0f1c]">{template.name}</h4>
                    <span className="text-xs px-2 py-0.5 bg-[#f7f8fb] text-[#5b6476] rounded">
                      {template.slug}
                    </span>
                    {template.active ? (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-sm text-[#5b6476] mt-1">{template.description}</p>
                  )}
                  <p className="text-xs text-[#5b6476] mt-1">
                    Subject: {template.subject}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(template)}
                    className="p-2 text-[#5b6476] hover:text-[#1a4fff] hover:bg-[#f7f8fb] rounded-lg"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(template)}
                    className="p-2 text-[#5b6476] hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available templates to create */}
      {missingTemplates.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
            Available Templates
          </h3>
          <p className="text-sm text-[#5b6476] mb-4">
            These templates are currently using code-based defaults. Click to customize.
          </p>
          <div className="grid gap-4">
            {missingTemplates.map((template) => (
              <div
                key={template.slug}
                className="bg-white rounded-xl border border-[#e4e7ef] border-dashed p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-[#0b0f1c]">{template.name}</h4>
                    <span className="text-xs px-2 py-0.5 bg-[#f7f8fb] text-[#5b6476] rounded">
                      {template.slug}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                      Using code default
                    </span>
                  </div>
                  <p className="text-sm text-[#5b6476] mt-1">{template.description}</p>
                </div>
                <button
                  onClick={() => handleCreateFromDefault(template)}
                  disabled={loadingDefault}
                  className="flex items-center gap-2 px-3 py-1.5 text-[#1a4fff] hover:bg-[#1a4fff]/5 rounded-lg text-sm disabled:opacity-50"
                >
                  {loadingDefault && formData.slug === template.slug ? (
                    <>
                      <span className="w-4 h-4 border-2 border-[#1a4fff]/30 border-t-[#1a4fff] rounded-full animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Customize
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
