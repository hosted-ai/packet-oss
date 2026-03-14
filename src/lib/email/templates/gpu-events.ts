import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailSuccessBox, emailWarningBox, emailDangerBox, emailInfoBox, emailSignoff, plainTextFooter } from "../utils";
import { loadTemplate } from "../template-loader";
import { getBrandName } from "@/lib/branding";

export async function sendHfDeploymentEmail(params: {
  to: string;
  customerName: string;
  modelName: string;
  status: "success" | "failed";
  errorMessage?: string;
  dashboardUrl: string;
}) {
  const { to, customerName, modelName, status, errorMessage, dashboardUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safeModelName = escapeHtml(modelName);
  const safeErrorMessage = errorMessage ? escapeHtml(errorMessage) : "";

  const isSuccess = status === "success";
  const subject = isSuccess
    ? `Your model ${modelName} is ready`
    : `Deployment failed: ${modelName}`;

  const body = `
    ${emailGreeting(safeCustomerName)}
    ${isSuccess ? `
      ${emailSuccessBox(`<p style="margin: 0; font-size: 15px; color: #065f46;">
        <strong>Model deployment complete</strong><br>
        <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safeModelName}</code> has been deployed and is running.
      </p>`)}
      ${emailText("Your vLLM server is accepting requests. View connection details in your dashboard.")}
    ` : `
      ${emailDangerBox(`<p style="margin: 0; font-size: 15px; color: #991b1b;">
        <strong>Deployment failed</strong><br>
        We couldn't deploy <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safeModelName}</code>.
      </p>`)}
      ${safeErrorMessage ? `<div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 6px; padding: 12px; margin: 0 0 16px 0;"><p style="margin: 0; font-size: 13px; font-family: monospace; color: #5b6476;">${safeErrorMessage}</p></div>` : ""}
      ${emailText("You can view the logs in your dashboard for more details, or try deploying again.")}
    `}
    ${emailButton("Go to Dashboard", dashboardUrl)}
    ${emailSignoff()}
  `;

  const fallbackHtml = emailLayout({ preheader: isSuccess ? `${modelName} is live and accepting requests` : `Deployment of ${modelName} failed`, body });
  const fallbackText = `Hi ${customerName},

${isSuccess
  ? `Your model is ready! ${modelName} has been successfully deployed and is now running.

Your vLLM server is up and accepting requests. Head to your dashboard to view connection details and start using your model.`
  : `Deployment failed. We couldn't deploy ${modelName}.
${errorMessage ? `\nError: ${errorMessage}` : ""}

You can view the logs in your dashboard for more details, or try deploying again.`}

Go to Dashboard: ${dashboardUrl}

The ${getBrandName()} Team
${plainTextFooter()}`;

  const templateSlug = isSuccess ? "model-deployed" : "model-deploy-failed";
  const template = await loadTemplate(
    templateSlug,
    { customerName: safeCustomerName, modelName: safeModelName, dashboardUrl, errorMessage: safeErrorMessage },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function sendGpuLaunchedEmail(params: {
  to: string;
  customerName: string;
  poolName: string;
  gpuCount: number;
  dashboardUrl: string;
}) {
  const { to, customerName, poolName, gpuCount, dashboardUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safePoolName = escapeHtml(poolName);

  const body = `
    ${emailGreeting(safeCustomerName)}
    ${emailSuccessBox(`<p style="margin: 0; font-size: 15px; color: #065f46;">
      <strong>GPU Instance Started</strong><br>
      ${gpuCount} GPU${gpuCount > 1 ? "s" : ""} on <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safePoolName}</code>
    </p>`)}
    ${emailText("Your GPU is being provisioned. View connection details in your dashboard.")}
    ${emailButton("Open Dashboard", dashboardUrl)}
    ${emailSignoff()}
  `;

  const subject = `GPU instance started: ${gpuCount} GPU${gpuCount > 1 ? "s" : ""} on ${poolName}`;
  const fallbackHtml = emailLayout({ preheader: `${gpuCount} GPU${gpuCount > 1 ? "s" : ""} provisioned on ${poolName}`, body });
  const fallbackText = `Hi ${customerName},

GPU Instance Started
${gpuCount} GPU${gpuCount > 1 ? "s" : ""} on ${poolName}

Your GPU is being provisioned. View connection details in your dashboard.

Open Dashboard: ${dashboardUrl}

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "gpu-launched",
    { customerName: safeCustomerName, poolName: safePoolName, gpuCount: String(gpuCount), dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function sendGpuTerminatedEmail(params: {
  to: string;
  customerName: string;
  poolName: string;
  dashboardUrl: string;
}) {
  const { to, customerName, poolName, dashboardUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safePoolName = escapeHtml(poolName);

  const body = `
    ${emailGreeting(safeCustomerName)}
    ${emailWarningBox(`<p style="margin: 0; font-size: 15px; color: #92400e;">
      <strong>GPU Terminated</strong><br>
      Your GPU on <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safePoolName}</code> has been terminated.
    </p>`)}
    ${emailText("Your GPU instance has been removed and is no longer running.")}
    ${emailText("Need to launch another GPU? Head to your dashboard.")}
    ${emailButton("Go to Dashboard", dashboardUrl)}
    ${emailSignoff()}
  `;

  const subject = `GPU terminated: ${poolName}`;
  const fallbackHtml = emailLayout({ preheader: `Your GPU on ${poolName} has been terminated`, body });
  const fallbackText = `Hi ${customerName},

GPU Terminated. Your GPU on ${poolName} has been terminated.

Your GPU instance has been removed and is no longer running.

Need to launch another GPU? Head to your dashboard.

Go to Dashboard: ${dashboardUrl}

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "gpu-terminated",
    { customerName: safeCustomerName, poolName: safePoolName, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function sendHfDeploymentStartedEmail(params: {
  to: string;
  customerName: string;
  modelName: string;
  dashboardUrl: string;
}) {
  const { to, customerName, modelName, dashboardUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safeModelName = escapeHtml(modelName);

  const body = `
    ${emailGreeting(safeCustomerName)}
    ${emailInfoBox(`<p style="margin: 0; font-size: 15px; color: #0b0f1c;">
      <strong>Model Deployment Started</strong><br>
      <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safeModelName}</code> is being deployed to your GPU.
    </p>`)}
    ${emailText("This typically takes 5-10 minutes. We'll send you another email when the model is ready.")}
    ${emailText("You can monitor the deployment progress in your dashboard.")}
    ${emailButton("Go to Dashboard", dashboardUrl)}
    ${emailSignoff()}
  `;

  const subject = `Deploying model: ${modelName}`;
  const fallbackHtml = emailLayout({ preheader: `${modelName} deployment in progress`, body });
  const fallbackText = `Hi ${customerName},

Model Deployment Started. ${modelName} is being deployed to your GPU.

This typically takes 5-10 minutes. We'll send you another email when the model is ready.

You can monitor the deployment progress in your dashboard.

Go to Dashboard: ${dashboardUrl}

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "model-deploying",
    { customerName: safeCustomerName, modelName: safeModelName, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}
