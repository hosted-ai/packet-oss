import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { isPro } from "@/lib/edition";
import { getBrandName, getAppUrl } from "@/lib/branding";
import { BrandStyles } from "@/components/BrandStyles";
import "./globals.css";

const brandName = getBrandName();
const appUrl = getAppUrl();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: `${brandName} - On-Demand GPU Cloud for AI & ML`,
    template: `%s | ${brandName}`,
  },
  description:
    "Rent NVIDIA B200, H200, and RTX 6000 96GB GPUs on-demand. Deploy in under 5 minutes with SSH access, no contracts, and up to 75% savings vs AWS. European GPU cloud built by hosted.ai.",
  keywords: [
    "GPU cloud",
    "NVIDIA GPU rental",
    "B200 GPU",
    "H200 GPU",
    "RTX 6000 GPU",
    "AI infrastructure",
    "ML training",
    "GPU as a service",
    "cloud GPU",
    "on-demand GPU",
    "LLM training",
    "AI inference",
    "European GPU cloud",
  ],
  authors: [{ name: brandName, url: appUrl }],
  creator: brandName,
  publisher: brandName,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: `${brandName} - On-Demand GPU Cloud for AI & ML`,
    description:
      "Rent NVIDIA B200, H200, and RTX 6000 96GB GPUs on-demand. Deploy in under 5 minutes, no contracts, up to 75% cheaper than AWS.",
    url: appUrl,
    siteName: brandName,
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: `${brandName} - On-demand GPU cloud infrastructure for AI and machine learning`,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${brandName} - On-Demand GPU Cloud for AI & ML`,
    description:
      "Rent NVIDIA B200, H200, and RTX 6000 96GB GPUs on-demand. Deploy in under 5 minutes, no contracts.",
    images: ["/og-image.jpg"],
  },
  alternates: {
    canonical: appUrl,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const proMode = isPro();

  // Tenant config — only available in Pro edition
  const tenant = proMode
    ? await import("@/lib/tenant").then((m) => m.getTenantConfig())
    : { isDefault: false, analyticsId: null as string | null };

  // Premium components — dynamically imported only in Pro edition
  const TenantStyles = proMode
    ? (await import("@/components/TenantStyles")).TenantStyles
    : null;
  const PlerdyBeacons = proMode
    ? (await import("@/components/PlerdyBeacons")).PlerdyBeacons
    : null;
  const CookieConsent = proMode
    ? (await import("@/components/CookieConsent")).CookieConsent
    : null;

  return (
    <html lang="en">
      <head>
        <BrandStyles />
        {TenantStyles && <TenantStyles />}
        {proMode && tenant.isDefault && (
          <>
            {/* Google Consent Mode v2 — defaults MUST come before gtag loads */}
            <Script id="consent-defaults" strategy="beforeInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'});`}
            </Script>
            {/* Google Ads (gtag.js) */}
            <Script
              src="https://www.googletagmanager.com/gtag/js?id=AW-17978041064"
              strategy="afterInteractive"
            />
            <Script id="google-ads-gtag" strategy="afterInteractive">
              {`gtag('js',new Date());gtag('config','AW-17978041064');`}
            </Script>
            {/* End Google Ads */}

            {/* Growify Pixel v2 — sendBeacon→fetch shim ensures reliable delivery */}
            <script
              dangerouslySetInnerHTML={{
                // Static trusted inline script — no user input, XSS-safe
                __html: `(function(){var o=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){if(typeof u==='string'&&u.indexOf('growify')!==-1){try{fetch(u,{method:'POST',body:d,keepalive:true}).catch(function(){});return true}catch(e){return o(u,d)}}return o(u,d)}})();`,
              }}
            />
            <script
              src="https://cdn.growify.ai/pixel.min.js"
              data-website-id="baa085dff1d66ae50ac0a03d9942dc2d:85ff45616aab7ed7c09d7a0af4edcb109c202edea66962c723b7ad8650797f9725a2a8146922bb167147a47534bc1d90"
              data-endpoint="api_v2"
              data-platform="web"
            ></script>
            {/* End Growify Pixel v2 */}

            {/* Pixel Code - https://ore.io/ */}
            <Script
              src="https://ore.io/pixel/WjDv8Sw8EoZfkyml"
              strategy="beforeInteractive"
            />
            {/* END Pixel Code */}

            {/* Reddit Pixel */}
            <Script id="reddit-pixel" strategy="afterInteractive">
              {`!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init','a2_igebsl70a5t9');rdt('track', 'PageVisit');`}
            </Script>
            {/* End Reddit Pixel */}
            {/* LinkedIn Insight Tag */}
            <Script id="linkedin-partner" strategy="afterInteractive">
              {`_linkedin_partner_id = "8809780";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);`}
            </Script>
            <Script id="linkedin-insight" strategy="afterInteractive">
              {`(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);`}
            </Script>
            {/* End LinkedIn Insight Tag */}

            {/* TruConversion */}
            <Script id="truconversion" strategy="afterInteractive">
              {`var _tip = _tip || [];
(function(d,s,id){
    var js, tjs = d.getElementsByTagName(s)[0];
    if(d.getElementById(id)) { return; }
    js = d.createElement(s); js.id = id;
    js.async = true;
    js.src = d.location.protocol + '//app.truconversion.com/ti-js/57545/5a1a1.js';
    tjs.parentNode.insertBefore(js, tjs);
}(document, 'script', 'ti-js'));`}
            </Script>
            {/* TruConversion RevealID visitor tracking */}
            <Script id="truconversion-reveal" strategy="afterInteractive">
              {`!function(){var e="rest.revealid.xyz/v3/script?clientId=efBSwfJhEFPrA8LVHNW1np&version=4.0.0",
t=document.createElement("script");window.location.protocol.split(":")[0];
t.src="https://"+e;var c=document.getElementsByTagName("script")[0];
t.async = true;
t.onload = function(){ new Reveal.default };
c.parentNode.insertBefore(t,c)}();`}
            </Script>
          </>
        )}
        {proMode && !tenant.isDefault && tenant.analyticsId && (
          <Script
            id="tenant-ga4"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${tenant.analyticsId}`}
          />
        )}
        {proMode && !tenant.isDefault && tenant.analyticsId && (
          <Script id="tenant-ga4-config" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tenant.analyticsId}');`}
          </Script>
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {proMode && tenant.isDefault && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Organization",
                name: brandName,
                url: appUrl,
                logo: `${appUrl}/packet-logo.png`,
                description:
                  "On-demand GPU cloud infrastructure for AI and machine learning. Rent NVIDIA B200, H200, and RTX 6000 96GB GPUs with instant setup, SSH access, and no contracts.",
                foundingDate: "2024",
                parentOrganization: {
                  "@type": "Organization",
                  name: "hosted.ai",
                  url: "https://hosted.ai",
                },
                sameAs: [
                  "https://www.linkedin.com/company/hostedai/",
                ],
                contactPoint: {
                  "@type": "ContactPoint",
                  contactType: "Sales",
                  email: `hello@${new URL(appUrl).hostname}`,
                  url: `${appUrl}/contact`,
                },
                address: {
                  "@type": "PostalAddress",
                  addressCountry: "SE",
                  addressRegion: "Europe",
                },
                offers: {
                  "@type": "AggregateOffer",
                  priceCurrency: "USD",
                  lowPrice: "0.66",
                  highPrice: "2.25",
                  offerCount: "3",
                  offers: [
                    {
                      "@type": "Offer",
                      name: "NVIDIA B200 GPU",
                      price: "2.25",
                      priceCurrency: "USD",
                      unitText: "per hour",
                      url: `${appUrl}/gpu/b200`,
                    },
                    {
                      "@type": "Offer",
                      name: "NVIDIA H200 GPU",
                      price: "1.50",
                      priceCurrency: "USD",
                      unitText: "per hour",
                      url: `${appUrl}/gpu/h200`,
                    },
                    {
                      "@type": "Offer",
                      name: "NVIDIA RTX 6000 Pro GPU",
                      price: "0.66",
                      priceCurrency: "USD",
                      unitText: "per hour",
                      url: `${appUrl}/gpu/rtx-6000`,
                    },
                  ],
                },
              }),
            }}
          />
        )}
        {proMode && tenant.isDefault && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: brandName,
                url: appUrl,
                description:
                  "On-demand GPU cloud infrastructure for AI and machine learning.",
                publisher: {
                  "@type": "Organization",
                  name: brandName,
                },
              }),
            }}
          />
        )}
        {children}
        {proMode && tenant.isDefault && PlerdyBeacons && CookieConsent && (
          <>
            {/* LinkedIn noscript fallback */}
            <noscript>
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                alt=""
                src="https://px.ads.linkedin.com/collect/?pid=8809780&fmt=gif"
              />
            </noscript>
            <PlerdyBeacons />
            <CookieConsent />
            {/* Plerdy Heatmap & Analytics */}
            <Script
              id="plerdy"
              strategy="lazyOnload"
              data-plerdy_code="1"
              dangerouslySetInnerHTML={{
                __html: `var _protocol="https:"==document.location.protocol?"https://":"http://";_site_hash_code = "f676eac3de170bf7d881dbf34c9cdc5f",_suid=72753, plerdyScript=document.createElement("script");plerdyScript.setAttribute("defer",""),plerdyScript.dataset.plerdymainscript="plerdymainscript",plerdyScript.src="https://d.plerdy.com/public/js/click/main.js?v="+Math.random();var plerdymainscript=document.querySelector("[data-plerdymainscript='plerdymainscript']");plerdymainscript&&plerdymainscript.parentNode.removeChild(plerdymainscript);try{document.head.appendChild(plerdyScript)}catch(t){console.log(t,"unable add script tag")}`,
              }}
            />
          </>
        )}
      </body>
    </html>
  );
}
