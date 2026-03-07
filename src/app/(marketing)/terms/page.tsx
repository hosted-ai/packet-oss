import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
  description: "Terms and conditions for using GPU Cloud GPU cloud services. Covers usage policies, billing, acceptable use, and service guarantees.",
  alternates: {
    canonical: "https://example.com/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="container" style={{ maxWidth: "800px", padding: "60px 20px" }}>
      <h1 className="display" style={{ fontSize: "2.5rem", marginBottom: "8px" }}>Terms of Service</h1>
      <p style={{ color: "var(--muted)", marginBottom: "40px" }}>Last updated: January 25, 2025</p>

      <div style={{ lineHeight: "1.8", color: "var(--ink)" }}>
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>1. Agreement to Terms</h2>
          <p>
            These Terms of Service (&quot;Terms&quot;) constitute a legally binding agreement between you and Hosted AI Inc.,
            a Delaware corporation (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), governing your access to and use of the
            the platform website and GPU cloud computing services (collectively, the &quot;Services&quot;).
          </p>
          <p style={{ marginTop: "12px" }}>
            By accessing or using our Services, you agree to be bound by these Terms. If you do not agree to these
            Terms, you may not access or use the Services.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>2. Description of Services</h2>
          <p>
            the platform provides on-demand GPU cloud computing services, including but not limited to:
          </p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Access to NVIDIA GPU instances</li>
            <li>SSH and API access to computing resources</li>
            <li>Persistent storage solutions</li>
            <li>Model deployment and inference services</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>3. Account Registration</h2>
          <p>
            To use certain features of the Services, you must register for an account. You agree to:
          </p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Provide accurate, current, and complete information during registration</li>
            <li>Maintain and promptly update your account information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Accept responsibility for all activities under your account</li>
            <li>Notify us immediately of any unauthorized use of your account</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>4. Billing and Payment</h2>
          <p>
            <strong>4.1 Pricing.</strong> Our Services are billed on a pay-as-you-go basis. Current pricing is
            displayed on our website and may be updated from time to time with notice.
          </p>
          <p style={{ marginTop: "12px" }}>
            <strong>4.2 Deposits.</strong> An initial deposit is required to activate Services. Upon account
            closure, any remaining balance (minus outstanding charges) can be withdrawn.
          </p>
          <p style={{ marginTop: "12px" }}>
            <strong>4.3 Usage Charges.</strong> You will be charged based on your actual usage of computing
            resources, storage, and bandwidth as measured by our systems.
          </p>
          <p style={{ marginTop: "12px" }}>
            <strong>4.4 Auto-Refill.</strong> If enabled, your payment method may be charged automatically when
            your balance falls below a threshold.
          </p>
          <p style={{ marginTop: "12px" }}>
            <strong>4.5 Disputes.</strong> Any billing disputes must be reported within 30 days of the charge.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>5. Acceptable Use Policy</h2>
          <p>You agree not to use the Services to:</p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Violate any applicable laws or regulations</li>
            <li>Infringe upon intellectual property rights of others</li>
            <li>Distribute malware, viruses, or harmful code</li>
            <li>Engage in any form of cryptocurrency mining, blockchain validation, proof-of-work computation, or operate any crypto-focused services on our infrastructure. This prohibition is absolute and applies regardless of the cryptocurrency, protocol, or method used</li>
            <li>Conduct denial-of-service attacks or spam operations</li>
            <li>Store or transmit illegal content</li>
            <li>Attempt to gain unauthorized access to systems or data</li>
            <li>Resell Services without authorization</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            We reserve the right to suspend or terminate accounts that violate this policy.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>6. Service Level Agreement</h2>
          <p>
            We strive to maintain 99.9% uptime for our Services. Our full Service Level Agreement is available
            at <Link href="/sla" style={{ color: "var(--blue)" }}>/sla</Link>. Credits for service disruptions
            are provided in accordance with the SLA.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>7. Data and Privacy</h2>
          <p>
            Your use of the Services is also governed by our <Link href="/privacy" style={{ color: "var(--blue)" }}>Privacy Policy</Link>.
            You retain ownership of all data you upload to the Services. We do not access your data except as
            necessary to provide the Services or as required by law.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>8. Intellectual Property</h2>
          <p>
            The Services, including all software, documentation, and content created by us, are owned by
            Hosted AI Inc. and protected by intellectual property laws. You are granted a limited, non-exclusive
            license to use the Services for their intended purpose.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>9. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, HOSTED AI INC. SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES,
            WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
          </p>
          <p style={{ marginTop: "12px" }}>
            OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNTS PAID BY YOU TO US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>10. Disclaimer of Warranties</h2>
          <p>
            THE SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS
            FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>11. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Hosted AI Inc. and its officers, directors, employees,
            and agents from any claims, damages, losses, liabilities, and expenses arising out of your use
            of the Services or violation of these Terms.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>12. Termination</h2>
          <p>
            Either party may terminate this agreement at any time. Upon termination:
          </p>
          <ul style={{ marginTop: "12px", marginLeft: "20px" }}>
            <li>Your access to Services will be revoked</li>
            <li>Outstanding charges will be deducted from your balance</li>
            <li>Remaining balance can be withdrawn within 30 days</li>
            <li>Your data will be deleted within 30 days unless otherwise required by law</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>13. Modifications to Terms</h2>
          <p>
            We may modify these Terms at any time. We will notify you of material changes via email or
            through the Services. Continued use of the Services after changes constitutes acceptance of
            the modified Terms.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>14. Governing Law</h2>
          <p>
            These Terms shall be governed by the laws of the State of Delaware, without regard to its
            conflict of laws principles. Any disputes shall be resolved in the state or federal courts
            located in Delaware.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "12px" }}>15. Contact Information</h2>
          <p>
            For questions about these Terms, please contact us at:
          </p>
          <p style={{ marginTop: "12px" }}>
            Hosted AI Inc.<br />
            622 North 9th Street<br />
            San Jose, CA 95112, USA<br />
            Email: <a href="mailto:legal@example.com" style={{ color: "var(--blue)" }}>legal@example.com</a><br />
            Website: <a href="https://example.com" style={{ color: "var(--blue)" }}>https://the platform</a>
          </p>
        </section>
      </div>
    </div>
  );
}
