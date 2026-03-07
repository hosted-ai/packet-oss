import { Metadata } from "next";
import "./sla.css";

export const metadata: Metadata = {
  title: "Service Level Agreement (SLA) - 99.9% Uptime Guarantee",
  description: "GPU Cloud's 99.9% uptime SLA for GPU cloud infrastructure. Covers service credits, support response times, and infrastructure guarantees.",
  alternates: {
    canonical: "https://example.com/sla",
  },
};

export default function SLAPage() {
  return (
    <div className="legal-page">
      <div className="container">
        <div className="legal-content">
          <h1>Service Level Agreement</h1>
          <p className="last-updated">Last updated: January 2025</p>

          <section>
            <h2>The Short Version</h2>
            <p>
              We guarantee 99.9% uptime for your GPU instances. If we fail to meet this,
              you get credits back proportional to the downtime. This page explains exactly
              how that works, what counts as downtime, and what doesn&apos;t.
            </p>
          </section>

          <section>
            <h2>1. Our Uptime Commitment</h2>
            <p>
              We commit to <strong>99.9% monthly uptime</strong> for all GPU instances.
              This means your instances should be available at least 99.9% of the time
              in any given calendar month.
            </p>
            <p>
              In practical terms, 99.9% uptime allows for up to <strong>43 minutes and
              50 seconds</strong> of downtime per month.
            </p>
            <div className="info-box">
              <h4>How we calculate uptime</h4>
              <p className="formula">
                Monthly Uptime % = ((Total Minutes in Month - Downtime Minutes) / Total Minutes in Month) × 100
              </p>
            </div>
          </section>

          <section>
            <h2>2. Service Credits</h2>
            <p>
              If we don&apos;t meet our 99.9% uptime commitment, you&apos;re entitled to service
              credits based on the following schedule:
            </p>
            <table className="sla-table">
              <thead>
                <tr>
                  <th>Monthly Uptime</th>
                  <th>Credit Percentage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>99.0% - 99.9%</td>
                  <td>10% of monthly bill</td>
                </tr>
                <tr>
                  <td>95.0% - 99.0%</td>
                  <td>25% of monthly bill</td>
                </tr>
                <tr>
                  <td>Below 95.0%</td>
                  <td>50% of monthly bill</td>
                </tr>
              </tbody>
            </table>
            <p>
              Credits are applied to your account balance for future use. The maximum credit
              for any month is 50% of your charges for that month. Credits don&apos;t expire
              but can&apos;t be converted to cash.
            </p>
          </section>

          <section>
            <h2>3. What Counts as Downtime</h2>
            <p>Downtime means your GPU instance is completely unavailable and you cannot:</p>
            <ul>
              <li>SSH into your instance</li>
              <li>Access your running workloads</li>
              <li>Reach services running on your instance</li>
            </ul>
            <p>
              We measure downtime from when we confirm an issue (either through our
              monitoring or your support ticket) until service is restored.
            </p>
          </section>

          <section>
            <h2>4. What Doesn&apos;t Count as Downtime</h2>
            <p>The following situations are excluded from our uptime calculation:</p>
            <ul>
              <li>
                <strong>Scheduled maintenance:</strong> We&apos;ll notify you at least 48 hours
                in advance for planned maintenance windows.
              </li>
              <li>
                <strong>Your code or configuration:</strong> Issues caused by your applications,
                scripts, or misconfiguration.
              </li>
              <li>
                <strong>Resource exhaustion:</strong> Running out of disk space, memory, or
                hitting compute limits you configured.
              </li>
              <li>
                <strong>Network issues outside our control:</strong> Problems with your ISP,
                DNS providers, or internet backbone issues.
              </li>
              <li>
                <strong>Abuse or violations:</strong> Service suspension due to terms of
                service violations or abusive behavior.
              </li>
              <li>
                <strong>Force majeure events:</strong> See section 6 below.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. How to Request Credits</h2>
            <p>To request SLA credits:</p>
            <ol>
              <li>
                Email us at <a href="mailto:support@example.com">support@example.com</a> within
                30 days of the incident.
              </li>
              <li>
                Include: Your account email, affected instance IDs, date and time of the
                incident, and a brief description.
              </li>
              <li>
                We&apos;ll review your request within 5 business days and respond with our
                determination.
              </li>
              <li>
                If approved, credits will be added to your account balance.
              </li>
            </ol>
          </section>

          <section>
            <h2>6. Force Majeure</h2>
            <p>
              We&apos;re not responsible for failures caused by circumstances beyond our
              reasonable control. This includes, but isn&apos;t limited to:
            </p>
            <ul>
              <li>Natural disasters (earthquakes, floods, hurricanes, etc.)</li>
              <li>Wars, terrorism, or civil unrest</li>
              <li>Government actions or court orders</li>
              <li>Widespread power grid failures</li>
              <li>Major internet infrastructure outages affecting multiple providers</li>
              <li>Pandemics or public health emergencies</li>
              <li>Acts of God</li>
            </ul>
            <p>
              During force majeure events, we&apos;ll do our best to restore service as
              quickly as possible and keep you informed of our progress.
            </p>
          </section>

          <section>
            <h2>7. Our Responsibilities</h2>
            <p>We commit to:</p>
            <ul>
              <li>Monitoring our infrastructure 24/7</li>
              <li>Responding to critical issues within 1 hour</li>
              <li>Providing status updates during incidents via our status page</li>
              <li>Conducting post-incident reviews for significant outages</li>
              <li>Continuously improving our infrastructure reliability</li>
            </ul>
          </section>

          <section>
            <h2>8. Your Responsibilities</h2>
            <p>To benefit from this SLA, you should:</p>
            <ul>
              <li>Keep your contact information up to date</li>
              <li>Report issues promptly through our support channels</li>
              <li>Implement reasonable redundancy for critical workloads</li>
              <li>Back up your data regularly (we provide the infrastructure, you own your data)</li>
              <li>Stay within your resource limits and terms of service</li>
            </ul>
          </section>

          <section>
            <h2>9. Limitations</h2>
            <p>
              This SLA applies only to paid GPU instances. Free tiers, beta features,
              and promotional offerings may have different or no uptime guarantees.
            </p>
            <p>
              Service credits are your sole and exclusive remedy for any failure to meet
              our uptime commitment. This SLA doesn&apos;t create any additional warranties
              or liabilities beyond what&apos;s stated here.
            </p>
          </section>

          <section>
            <h2>10. Changes to This SLA</h2>
            <p>
              We may update this SLA from time to time. If we make changes that reduce
              our commitments, we&apos;ll notify you at least 30 days in advance. Continued
              use of our service after changes take effect means you accept the updated terms.
            </p>
          </section>

          <section>
            <h2>Questions?</h2>
            <p>
              If you have questions about this SLA or need to report an incident,
              contact us at <a href="mailto:support@example.com">support@example.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
