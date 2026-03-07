import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: {
    default: "GPU Cloud Platform - On-Demand GPUs for AI & ML",
    template: "%s | GPU Cloud",
  },
  description:
    "On-demand GPU cloud infrastructure for AI and machine learning workloads. Deploy GPU instances in minutes with SSH access.",
  keywords: [
    "GPU cloud",
    "GPU rental",
    "AI infrastructure",
    "ML training",
    "GPU as a service",
    "cloud GPU",
    "on-demand GPU",
    "LLM training",
    "AI inference",
  ],
  authors: [{ name: "GPU Cloud" }],
  creator: "GPU Cloud",
  publisher: "GPU Cloud",
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
    title: "GPU Cloud Platform - On-Demand GPUs for AI & ML",
    description:
      "On-demand GPU cloud infrastructure for AI and machine learning workloads. Deploy GPU instances in minutes with SSH access.",
    url: "https://example.com",
    siteName: "GPU Cloud",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "GPU Cloud Platform - On-demand GPU cloud infrastructure for AI and machine learning",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GPU Cloud Platform - On-Demand GPUs for AI & ML",
    description:
      "On-demand GPU cloud infrastructure for AI and machine learning workloads. Deploy GPU instances in minutes.",
    images: ["/og-image.jpg"],
  },
  alternates: {
    canonical: "https://example.com",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
            {/*
              Analytics & tracking scripts removed for open-source release.
              Add your own Google Analytics, ad pixels, or tracking scripts here.
              Example: <Script src="https://www.googletagmanager.com/gtag/js?id=YOUR_ID" />
            */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "GPU Cloud Platform",
              url: "https://example.com",
              description:
                "On-demand GPU cloud infrastructure for AI and machine learning workloads.",
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "GPU Cloud Platform",
              url: "https://example.com",
              description:
                "On-demand GPU cloud infrastructure for AI and machine learning.",
              publisher: {
                "@type": "Organization",
                name: "GPU Cloud Platform",
              },
            }),
          }}
        />
        {children}
      </body>
    </html>
  );
}
