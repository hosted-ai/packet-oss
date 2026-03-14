"use client";

import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, Eye, Save, X, AlertCircle, Check } from "lucide-react";

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
];

export function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  // Create new template from default
  const handleCreateFromDefault = (defaultTemplate: typeof DEFAULT_TEMPLATES[0]) => {
    setEditingTemplate(null);
    setFormData({
      slug: defaultTemplate.slug,
      name: defaultTemplate.name,
      description: defaultTemplate.description,
      subject: defaultTemplate.defaultSubject,
      htmlContent: generateDefaultHtml(defaultTemplate),
      textContent: "",
      variables: defaultTemplate.variables,
      active: true,
    });
    setError(null);
    setSuccess(null);
  };

  // Generate default HTML template
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
        Customize email templates that are sent to customers. Changes take effect immediately.
      </p>

      {/* Existing templates */}
      {templates.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">Active Templates</h3>
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
                  className="flex items-center gap-2 px-3 py-1.5 text-[#1a4fff] hover:bg-[#1a4fff]/5 rounded-lg text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Customize
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
