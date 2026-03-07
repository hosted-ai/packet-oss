"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import {
  GettingStartedDoc,
  HuggingFaceDoc,
  Pro6000BlackwellDoc,
  InferencePlaygroundDoc,
  GPUMetricsDoc,
  TokenUsageDoc,
  ServiceExposureDoc,
  PersistentStorageDoc,
  SSHAccessDoc,
  BillingDoc,
  BudgetControlsDoc,
  WorkspaceDoc,
  BrowserIDEDoc,
} from "./docs";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
    </div>
  ),
});

interface DocsTabProps {
  isOwner: boolean;
}

type DocSection =
  | "getting-started"
  | "huggingface"
  | "pro-6000-blackwell"
  | "inference-playground"
  | "gpu-metrics"
  | "token-usage"
  | "service-exposure"
  | "persistent-storage"
  | "ssh-access"
  | "workspace"
  | "browser-ide"
  | "billing"
  | "budget-controls"
  | "api";

interface NavItemConfig {
  id: DocSection;
  label: string;
  shortLabel: string;
  isNew?: boolean;
}

const navItems: NavItemConfig[] = [
  // Getting Started & Deployment
  { id: "getting-started", label: "Getting Started", shortLabel: "Start" },
  { id: "huggingface", label: "HuggingFace Deploy", shortLabel: "HF" },
  { id: "pro-6000-blackwell", label: "Pro 6000 Blackwell", shortLabel: "Pro 6000", isNew: true },
  // Using Your Models
  { id: "inference-playground", label: "Playground", shortLabel: "Play", isNew: true },
  // Monitoring & Analytics
  { id: "gpu-metrics", label: "GPU Metrics", shortLabel: "GPU", isNew: true },
  { id: "token-usage", label: "Token Usage", shortLabel: "Tokens", isNew: true },
  // Advanced Configuration
  { id: "service-exposure", label: "Service Exposure", shortLabel: "Services" },
  { id: "persistent-storage", label: "Storage", shortLabel: "Storage" },
  { id: "ssh-access", label: "SSH Access", shortLabel: "SSH" },
  { id: "workspace", label: "Persistent Workspace", shortLabel: "Workspace", isNew: true },
  { id: "browser-ide", label: "Browser IDEs", shortLabel: "IDEs", isNew: true },
  // Account & Reference
  { id: "billing", label: "Billing", shortLabel: "Billing" },
  { id: "budget-controls", label: "Budget Controls", shortLabel: "Budget", isNew: true },
  { id: "api", label: "API Reference", shortLabel: "Docs" },
];

export function DocsTab({ isOwner }: DocsTabProps) {
  const [activeSection, setActiveSection] = useState<DocSection>("getting-started");

  const renderDocContent = () => {
    switch (activeSection) {
      // Getting Started & Deployment
      case "getting-started":
        return <GettingStartedDoc />;
      case "huggingface":
        return <HuggingFaceDoc />;
      case "pro-6000-blackwell":
        return <Pro6000BlackwellDoc />;
      // Using Your Models
      case "inference-playground":
        return <InferencePlaygroundDoc />;
      // Monitoring & Analytics
      case "gpu-metrics":
        return <GPUMetricsDoc />;
      case "token-usage":
        return <TokenUsageDoc />;
      // Advanced Configuration
      case "service-exposure":
        return <ServiceExposureDoc />;
      case "persistent-storage":
        return <PersistentStorageDoc />;
      case "ssh-access":
        return <SSHAccessDoc />;
      case "workspace":
        return <WorkspaceDoc />;
      case "browser-ide":
        return <BrowserIDEDoc />;
      // Account & Reference
      case "billing":
        return <BillingDoc />;
      case "budget-controls":
        return <BudgetControlsDoc />;
      case "api":
        return (
          <div className="overflow-hidden -m-8">
            <style jsx global>{`
              .swagger-ui .topbar { display: none; }
              .swagger-ui .info { margin: 1.5rem 1.5rem 1rem; }
              .swagger-ui .info .title { font-family: var(--font-display), system-ui, sans-serif; color: #18181b; font-size: 1.5rem; }
              .swagger-ui .scheme-container { background: #f9fafb; padding: 1rem; }
              .swagger-ui .opblock { border-radius: 8px; margin: 0 0 0.5rem; border: 1px solid #e4e4e7; box-shadow: none; }
              .swagger-ui .opblock .opblock-summary { border-radius: 8px; padding: 0.75rem 1rem; }
              .swagger-ui .opblock.opblock-get { border-color: #10B981; background: rgba(16, 185, 129, 0.05); }
              .swagger-ui .opblock.opblock-post { border-color: #3B82F6; background: rgba(59, 130, 246, 0.05); }
              .swagger-ui .opblock.opblock-delete { border-color: #EF4444; background: rgba(239, 68, 68, 0.05); }
              .swagger-ui .opblock.opblock-patch { border-color: #F59E0B; background: rgba(245, 158, 11, 0.05); }
              .swagger-ui .btn { border-radius: 6px; font-weight: 500; }
              .swagger-ui .btn.execute { background: #0d9488; border-color: #0d9488; }
              .swagger-ui input[type=text], .swagger-ui textarea { border-radius: 6px; border: 1px solid #e4e4e7; }
              .swagger-ui .opblock-tag { border-bottom: 1px solid #e4e4e7; padding: 0.75rem 0; }
              .swagger-ui code { font-family: 'SF Mono', Monaco, monospace; font-size: 13px; }
              .swagger-ui .markdown code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #18181b; }
              .swagger-ui .markdown pre { background: #1e293b; border-radius: 8px; padding: 1rem; }
              .swagger-ui .markdown pre code { background: transparent; color: #e2e8f0; }
            `}</style>
            <SwaggerUI
              url="/api/openapi"
              docExpansion="list"
              defaultModelsExpandDepth={0}
              persistAuthorization={true}
            />
          </div>
        );
      default:
        return <GettingStartedDoc />;
    }
  };

  const currentItem = navItems.find(item => item.id === activeSection);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900">Documentation</h1>
        <a
          href="mailto:support@example.com"
          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
        >
          Need help? Contact Support
        </a>
      </div>

      {/* Navigation Select */}
      <div className="flex items-center gap-3">
        <label htmlFor="doc-section" className="text-sm font-medium text-zinc-500">
          Topic:
        </label>
        <select
          id="doc-section"
          value={activeSection}
          onChange={(e) => setActiveSection(e.target.value as DocSection)}
          className="flex-1 max-w-md px-4 py-2.5 text-sm font-medium text-zinc-900 bg-white border border-zinc-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 cursor-pointer"
        >
          <optgroup label="Getting Started">
            <option value="getting-started">Getting Started</option>
            <option value="huggingface">HuggingFace Deploy</option>
            <option value="pro-6000-blackwell">Pro 6000 Blackwell ✨</option>
          </optgroup>
          <optgroup label="Using Your Models">
            <option value="inference-playground">Playground ✨</option>
          </optgroup>
          <optgroup label="Monitoring">
            <option value="gpu-metrics">GPU Metrics ✨</option>
            <option value="token-usage">Token Usage ✨</option>
          </optgroup>
          <optgroup label="Configuration">
            <option value="service-exposure">Service Exposure</option>
            <option value="persistent-storage">Storage</option>
            <option value="ssh-access">SSH Access</option>
            <option value="workspace">Persistent Workspace ✨</option>
            <option value="browser-ide">Browser IDEs ✨</option>
          </optgroup>
          <optgroup label="Account">
            <option value="billing">Billing</option>
            <option value="budget-controls">Budget Controls ✨</option>
            <option value="api">API Reference</option>
          </optgroup>
        </select>
        {currentItem?.isNew && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
            NEW
          </span>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-8">
        <div className="[&_pre]:overflow-x-auto [&_pre]:max-w-full [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full">
          {renderDocContent()}
        </div>
      </div>
    </div>
  );
}
