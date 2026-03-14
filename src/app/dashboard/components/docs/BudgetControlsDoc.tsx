"use client";

export function BudgetControlsDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>Budget Controls & Auto-Shutdown</h1>
      <p className="lead">
        Set spending limits, receive alerts, and automatically stop instances to prevent unexpected charges.
      </p>

      <h2>Overview</h2>
      <p>
        Budget controls help you manage your GPU spending by setting limits and receiving
        notifications before exceeding your budget. You can also enable automatic instance
        shutdown to prevent overspending.
      </p>

      <h2>Setting Up Budget Limits</h2>
      <p>
        Navigate to <strong>Settings</strong> in your dashboard and find the{" "}
        <strong>Budget Controls</strong> section.
      </p>

      <h3>Spending Limits</h3>
      <p>You can set two types of limits:</p>
      <table>
        <thead>
          <tr>
            <th>Limit Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Monthly Limit</strong></td>
            <td>Maximum spend per calendar month (resets on the 1st)</td>
          </tr>
          <tr>
            <td><strong>Daily Limit</strong></td>
            <td>Maximum spend per day (resets at midnight UTC)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Leave a field empty to disable that limit. You can use monthly limits alone,
        daily limits alone, or both together.
      </p>

      <h3>Example Configuration</h3>
      <pre>
        <code>{`Monthly Limit: $500
Daily Limit: $50

This ensures:
- You never spend more than $500/month
- No single day exceeds $50 (prevents runaway jobs)`}</code>
      </pre>

      <h2>Email Alerts</h2>
      <p>
        Receive email notifications when approaching your budget limits. You can enable
        alerts at three thresholds:
      </p>
      <ul>
        <li><strong>50% Alert</strong> - Early warning to review your usage</li>
        <li><strong>80% Alert</strong> - Approaching limit, consider reducing usage</li>
        <li><strong>100% Alert</strong> - Budget limit reached</li>
      </ul>
      <p>
        Alerts are sent once per threshold per billing period. For daily limits, alerts
        reset each day. For monthly limits, you&apos;ll receive at most three alerts per month
        (one at each threshold).
      </p>

      <h3>Alert Email Example</h3>
      <p>When you reach 80% of your monthly budget, you&apos;ll receive an email like:</p>
      <div style={{
        background: "#f8f8f8",
        border: "1px solid #e5e5e5",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "16px",
      }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Subject: Monthly Budget Warning: 80% Used</p>
        <p style={{ margin: "8px 0 0 0", fontSize: "14px", color: "#666" }}>
          You&apos;ve used $400 of your $500 monthly budget (80%). Consider reviewing your
          active instances to stay within your limit.
        </p>
      </div>

      <h2>Auto-Shutdown</h2>
      <p>
        Enable auto-shutdown to automatically stop all running GPU instances when you
        reach a specified percentage of your budget limit.
      </p>

      <h3>How It Works</h3>
      <ol>
        <li>Enable the <strong>Auto-Shutdown</strong> toggle in Budget Controls</li>
        <li>Select your shutdown threshold (50%, 75%, 80%, 90%, or 100%)</li>
        <li>When your spending reaches this threshold, all running instances are stopped</li>
        <li>You&apos;ll receive an email notification with the list of stopped instances</li>
      </ol>

      <h3>Important Notes</h3>
      <ul>
        <li>
          <strong>Stopped instances can be restarted</strong> - Your instances are stopped,
          not terminated. You can manually restart them after increasing your budget or
          waiting for the next billing period.
        </li>
        <li>
          <strong>Save your work</strong> - Any unsaved work in memory will be lost when
          instances are stopped. Use persistent storage for important data.
        </li>
        <li>
          <strong>Daily vs Monthly</strong> - Auto-shutdown triggers on whichever limit
          is reached first. If you have both limits, the more restrictive one applies.
        </li>
      </ul>

      <h3>Recommended Settings</h3>
      <table>
        <thead>
          <tr>
            <th>Use Case</th>
            <th>Monthly Limit</th>
            <th>Daily Limit</th>
            <th>Auto-Shutdown</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Personal Projects</td>
            <td>$100</td>
            <td>$20</td>
            <td>90%</td>
          </tr>
          <tr>
            <td>ML Training</td>
            <td>$500</td>
            <td>$100</td>
            <td>100%</td>
          </tr>
          <tr>
            <td>Development Team</td>
            <td>$2,000</td>
            <td>None</td>
            <td>80%</td>
          </tr>
          <tr>
            <td>Production Workloads</td>
            <td>Set high</td>
            <td>None</td>
            <td>Disabled</td>
          </tr>
        </tbody>
      </table>

      <h2>API Access</h2>
      <p>
        Budget settings can also be managed via the API for automated configuration.
      </p>

      <h3>Get Budget Settings</h3>
      <pre>
        <code>{`GET /api/account/budget
Authorization: Bearer <token>

Response:
{
  "monthlyLimitCents": 50000,
  "dailyLimitCents": 5000,
  "alertAt50Percent": true,
  "alertAt80Percent": true,
  "alertAt100Percent": true,
  "autoShutdownEnabled": true,
  "autoShutdownThreshold": 90
}`}</code>
      </pre>

      <h3>Update Budget Settings</h3>
      <pre>
        <code>{`PUT /api/account/budget
Authorization: Bearer <token>
Content-Type: application/json

{
  "monthlyLimitCents": 50000,
  "dailyLimitCents": 5000,
  "alertAt50Percent": true,
  "alertAt80Percent": true,
  "alertAt100Percent": true,
  "autoShutdownEnabled": true,
  "autoShutdownThreshold": 90
}`}</code>
      </pre>

      <h2>Best Practices</h2>
      <ol>
        <li>
          <strong>Start with conservative limits</strong> - Begin with lower limits and
          increase as you understand your usage patterns.
        </li>
        <li>
          <strong>Use daily limits for development</strong> - Daily limits prevent
          accidentally leaving instances running overnight.
        </li>
        <li>
          <strong>Enable all alerts</strong> - The 50% alert gives you early warning to
          plan your remaining budget.
        </li>
        <li>
          <strong>Set auto-shutdown below 100%</strong> - Setting auto-shutdown at 90%
          gives you a buffer to save work before hitting your limit.
        </li>
        <li>
          <strong>Use persistent storage</strong> - Always save important data to
          persistent storage so it survives auto-shutdown.
        </li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>Not receiving alert emails?</h3>
      <ul>
        <li>Check your spam folder</li>
        <li>Verify your email address in Profile settings</li>
        <li>Alerts are sent once per threshold - you won&apos;t receive duplicates</li>
      </ul>

      <h3>Instances stopped unexpectedly?</h3>
      <ul>
        <li>Check if auto-shutdown is enabled</li>
        <li>Review your budget alerts email for details</li>
        <li>Increase your budget limit or disable auto-shutdown to restart</li>
      </ul>

      <h3>Budget not resetting?</h3>
      <ul>
        <li>Monthly limits reset on the 1st of each month (UTC)</li>
        <li>Daily limits reset at midnight UTC</li>
        <li>The dashboard shows your current spending since the last reset</li>
      </ul>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab for assistance with
        budget configuration or billing questions.
      </p>
    </div>
  );
}
