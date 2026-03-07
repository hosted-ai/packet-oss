import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
  description: "How GPU Cloud collects, uses, and protects your personal information. Secure data handling with enterprise-grade data centers.",
  alternates: {
    canonical: "https://example.com/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div className="container" style={{ maxWidth: "800px", padding: "60px 20px" }}>
      <h1 className="display" style={{ fontSize: "2.5rem", marginBottom: "8px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--muted)", marginBottom: "40px" }}>Last updated: January 25, 2025</p>

      <div style={{ lineHeight: "1.8", color: "var(--ink)" }}>
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Introduction</h2>
          <p>
            Hosted AI Inc. (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), a Delaware corporation, operates the platform. This Privacy
            Policy explains how we collect, use, share, and protect your personal information when you use
            our GPU cloud computing services.
          </p>
          <p style={{ marginTop: "12px" }}>
            We respect your privacy and are committed to protecting your personal data. Please read this
            policy carefully to understand our practices.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Information We Collect</h2>

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginTop: "16px", marginBottom: "8px" }}>Information You Provide</h3>
          <ul style={{ marginLeft: "20px" }}>
            <li><strong>Account Information:</strong> Email address, name, company name, and password when you create an account</li>
            <li><strong>Payment Information:</strong> Credit card details (processed securely by Stripe), billing address</li>
            <li><strong>SSH Keys:</strong> Public SSH keys you upload for accessing instances</li>
            <li><strong>Support Communications:</strong> Messages and files you send to our support team</li>
          </ul>

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginTop: "16px", marginBottom: "8px" }}>Information We Collect Automatically</h3>
          <ul style={{ marginLeft: "20px" }}>
            <li><strong>Usage Data:</strong> GPU usage, storage consumption, bandwidth, and computing metrics</li>
            <li><strong>Log Data:</strong> IP addresses, browser type, access times, pages viewed</li>
            <li><strong>Device Information:</strong> Device type, operating system, unique device identifiers</li>
          </ul>

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginTop: "16px", marginBottom: "8px" }}>Your Computing Data</h3>
          <p>
            We do <strong>not</strong> access, monitor, or analyze the content of your computing workloads,
            files, or data stored on our servers. Your data is yours, and we only access it when:
          </p>
          <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
            <li>You explicitly request support</li>
            <li>Required by law or valid legal process</li>
            <li>Necessary to protect our systems from security threats</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Provide, operate, and maintain our Services</li>
            <li>Process payments and manage your account</li>
            <li>Send transactional emails (receipts, security alerts, service updates)</li>
            <li>Respond to support requests and communicate with you</li>
            <li>Detect, prevent, and address security incidents and fraud</li>
            <li>Improve and optimize our Services</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Information Sharing</h2>
          <p>We do not sell your personal information. We may share your information with:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li><strong>Payment Processors:</strong> Stripe processes payments on our behalf</li>
            <li><strong>Infrastructure Providers:</strong> Data center partners who host our hardware</li>
            <li><strong>Analytics Services:</strong> To understand usage patterns (anonymized data only)</li>
            <li><strong>Legal Requirements:</strong> When required by law, subpoena, or court order</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Data Security</h2>
          <p>We implement industry-standard security measures to protect your data:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Encryption of data in transit (TLS/SSL) and at rest</li>
            <li>Regular security audits and penetration testing</li>
            <li>Access controls and authentication requirements</li>
            <li>Secure data centers with physical security measures</li>
            <li>Employee security training and access limitations</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            While we strive to protect your data, no method of transmission over the Internet is 100% secure.
            We cannot guarantee absolute security.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Data Retention</h2>
          <p>We retain your data as follows:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li><strong>Account Data:</strong> Until you delete your account, plus 30 days</li>
            <li><strong>Computing Data:</strong> Deleted upon instance termination (unless you use persistent storage)</li>
            <li><strong>Billing Records:</strong> 7 years for tax and legal compliance</li>
            <li><strong>Support Communications:</strong> 3 years after resolution</li>
            <li><strong>Log Data:</strong> 90 days for security purposes</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Your Rights</h2>
          <p>You have the right to:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Update or correct inaccurate information</li>
            <li><strong>Deletion:</strong> Request deletion of your personal data</li>
            <li><strong>Portability:</strong> Receive your data in a portable format</li>
            <li><strong>Opt-out:</strong> Unsubscribe from marketing communications</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            To exercise these rights, contact us at <a href="mailto:privacy@example.com" style={{ color: "var(--blue)" }}>privacy@example.com</a>.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Cookies and Tracking</h2>
          <p>We use cookies and similar technologies to:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Keep you logged into your account</li>
            <li>Remember your preferences</li>
            <li>Understand how you use our Services</li>
            <li>Improve performance and user experience</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            You can control cookies through your browser settings, but disabling them may affect functionality.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>International Data Transfers</h2>
          <p>
            Our servers are located in the European Union and United States. If you access our Services from
            other regions, your data may be transferred to and processed in these locations. We ensure
            appropriate safeguards are in place for such transfers.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Children&apos;s Privacy</h2>
          <p>
            Our Services are not directed to children under 18. We do not knowingly collect personal
            information from children. If we learn we have collected such information, we will delete it promptly.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by
            email or through a prominent notice on our website. Your continued use of the Services after
            changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, contact us at:
          </p>
          <p style={{ marginTop: "12px" }}>
            Hosted AI Inc.<br />
            622 North 9th Street<br />
            San Jose, CA 95112, USA<br />
            Email: <a href="mailto:privacy@example.com" style={{ color: "var(--blue)" }}>privacy@example.com</a><br />
            Website: <a href="https://example.com" style={{ color: "var(--blue)" }}>https://the platform</a>
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>Related Documents</h2>
          <ul style={{ marginLeft: "20px" }}>
            <li><Link href="/terms" style={{ color: "var(--blue)" }}>Terms of Service</Link></li>
            <li><Link href="/sla" style={{ color: "var(--blue)" }}>Service Level Agreement</Link></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
