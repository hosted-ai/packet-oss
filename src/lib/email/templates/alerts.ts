/**
 * Critical Alert Email Templates
 *
 * Sends alerts to CRITICAL_ALERT_EMAIL for system failures that require
 * immediate attention (e.g., server removal failures, provisioning failures).
 */

import { sendEmailDirect } from "../client";
import { escapeHtml, emailLayout, emailDangerBox, emailDetailBox } from "../utils";
import { loadTemplate } from "../template-loader";

const CRITICAL_ALERT_EMAIL = process.env.CRITICAL_ALERT_EMAIL;

interface CriticalAlertParams {
  subject: string;
  errorType: string;
  errorMessage: string;
  context: Record<string, unknown>;
  timestamp?: Date;
}

export async function sendCriticalAlertEmail(params: CriticalAlertParams): Promise<void> {
  if (!CRITICAL_ALERT_EMAIL) {
    console.warn("[Critical Alert] CRITICAL_ALERT_EMAIL not configured, skipping alert");
    return;
  }

  const timestamp = params.timestamp || new Date();
  const contextHtml = Object.entries(params.context)
    .map(([key, value]) => `<tr><td style="padding: 4px 8px 4px 0; font-size: 13px; color: #5b6476; vertical-align: top;">${escapeHtml(key)}:</td><td style="padding: 4px 0; font-size: 13px; color: #0b0f1c; font-family: monospace;">${escapeHtml(JSON.stringify(value))}</td></tr>`)
    .join("\n");

  const contextText = Object.entries(params.context)
    .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
    .join("\n");

  const body = `
    ${emailDangerBox(`<p style="margin: 0; font-size: 16px; color: #991b1b;"><strong>Critical Alert: ${escapeHtml(params.subject)}</strong></p>`)}
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #5b6476;"><strong>Error Type:</strong> <span style="color: #0b0f1c;">${escapeHtml(params.errorType)}</span></p>
    `)}
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin: 16px 0; font-family: monospace; font-size: 13px; color: #991b1b; white-space: pre-wrap; word-break: break-word;">${escapeHtml(params.errorMessage)}</div>
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #5b6476;">Context:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        ${contextHtml}
      </table>
    `)}
    <p style="margin: 16px 0 0 0; font-size: 12px; color: #5b6476;">Timestamp: ${timestamp.toISOString()}<br>Environment: ${process.env.NODE_ENV || "development"}</p>
  `;

  const html = emailLayout({ preheader: `CRITICAL: ${params.subject}`, body });

  const text = `
CRITICAL ALERT: ${params.subject}
====================================

Error Type: ${params.errorType}

Error Message:
${params.errorMessage}

Context:
${contextText}

Timestamp: ${timestamp.toISOString()}
Environment: ${process.env.NODE_ENV || "development"}
`;

  try {
    const template = await loadTemplate("system-alert", {
      alertSubject: params.subject,
      errorType: params.errorType,
      errorMessage: params.errorMessage,
      timestamp: timestamp.toISOString(),
      environment: process.env.NODE_ENV || "development",
    }, {
      subject: `[CRITICAL] ${params.subject}`,
      html,
      text,
    });

    await sendEmailDirect({
      to: CRITICAL_ALERT_EMAIL,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
    console.log(`[Critical Alert] Email sent to ${CRITICAL_ALERT_EMAIL}: ${params.subject}`);
  } catch (error) {
    console.error(`[Critical Alert] Failed to send email:`, error);
  }
}

export async function alertServerRemovalFailed(params: {
  nodeId: string;
  hostname: string;
  ipAddress: string;
  providerId: string;
  gpuaasNodeId?: number | null;
  gpuaasClusterId?: number | null;
  gpuaasRegionId?: number | null;
  error: string;
}): Promise<void> {
  await sendCriticalAlertEmail({
    subject: `Server Removal Failed: ${params.hostname}`,
    errorType: "SERVER_REMOVAL_FAILED",
    errorMessage: params.error,
    context: {
      nodeId: params.nodeId,
      hostname: params.hostname,
      ipAddress: params.ipAddress,
      providerId: params.providerId,
      gpuaasNodeId: params.gpuaasNodeId,
      gpuaasClusterId: params.gpuaasClusterId,
      gpuaasRegionId: params.gpuaasRegionId,
    },
  });
}

export async function alertServerProvisioningFailed(params: {
  nodeId: string;
  hostname: string;
  ipAddress: string;
  providerId: string;
  step: string;
  error: string;
}): Promise<void> {
  await sendCriticalAlertEmail({
    subject: `Server Provisioning Failed: ${params.hostname}`,
    errorType: "SERVER_PROVISIONING_FAILED",
    errorMessage: params.error,
    context: {
      nodeId: params.nodeId,
      hostname: params.hostname,
      ipAddress: params.ipAddress,
      providerId: params.providerId,
      failedStep: params.step,
    },
  });
}

export async function alertPoolDeletionFailed(params: {
  poolId: number;
  clusterId?: number | null;
  nodeHostname: string;
  error: string;
}): Promise<void> {
  await sendCriticalAlertEmail({
    subject: `Pool Deletion Failed: Pool ${params.poolId}`,
    errorType: "POOL_DELETION_FAILED",
    errorMessage: params.error,
    context: {
      poolId: params.poolId,
      clusterId: params.clusterId,
      nodeHostname: params.nodeHostname,
    },
  });
}

export async function alertGPUaaSError(params: {
  operation: string;
  endpoint: string;
  error: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await sendCriticalAlertEmail({
    subject: `GPUaaS API Error: ${params.operation}`,
    errorType: "GPUAAS_API_ERROR",
    errorMessage: params.error,
    context: {
      operation: params.operation,
      endpoint: params.endpoint,
      ...params.context,
    },
  });
}
