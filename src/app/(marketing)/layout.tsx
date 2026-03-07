import Link from "next/link";
import Image from "next/image";
import { IBM_Plex_Sans, Plus_Jakarta_Sans } from "next/font/google";
import "./styles.css";
import MarketingHeader from "@/components/MarketingHeader";
import CampaignBanner from "@/components/CampaignBanner";
import PageTracker from "@/components/PageTracker";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
});

export default async function Staging3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || "GPU Cloud";
  const logoUrl = "/packet-logo.png";

  return (
    <>
      <div className={`staging3 ${ibmPlexSans.variable} ${plusJakartaSans.variable}`}>
        {/* Anonymous page-view tracking (cookie-free) */}
        <PageTracker />

        {/* Campaign Banner */}
        <CampaignBanner />

        {/* Navigation */}
        <MarketingHeader
          isDefault={true}
          brandName={brandName}
          logoUrl={logoUrl}
        />

      <main>{children}</main>

      {/* Footer */}
      <footer className="footer-section">
        <div className="container footer">
          <div className="footer-brand">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Image
                src={logoUrl}
                alt={brandName}
                width={100}
                height={35}
                className="h-7 w-auto opacity-60"
              />
              <span style={{
                fontSize: "8px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "1px 4px",
                borderRadius: "3px",
                background: "linear-gradient(135deg, #14b8a6, #0d9488)",
                color: "white",
                opacity: 0.65,
              }}>Beta</span>
            </div>
            <span>
              GPU Cloud Platform. Waste less compute.
            </span>
          </div>
          <div className="footer-links">
            <Link href="/features">Features</Link>
            <Link href="/cli">CLI</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/about">About</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/sla">SLA</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
        <div className="footer-payment-methods">
          <span className="payment-label">We accept</span>
          <div className="payment-icons">
            <span className="payment-method">Visa</span>
            <span className="payment-method">Mastercard</span>
            <span className="payment-method">Bank Transfer</span>
            <span className="payment-method">Crypto</span>
          </div>
        </div>
      </footer>
    </div>
    </>
  );
}
