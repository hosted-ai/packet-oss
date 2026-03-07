import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact Sales - Book a GPU Cloud Demo",
  description:
    "Talk to our team about GPU cloud solutions. Book a 15-minute walkthrough of GPU Cloud — get a demo, pricing quote, or answers to your GPU infrastructure questions.",
  keywords: [
    "GPU cloud demo",
    "contact GPU cloud sales",
    "GPU pricing quote",
    "talk to sales GPU",
    "GPU cloud consultation",
    "enterprise GPU cloud",
  ],
  openGraph: {
    title: "Contact Sales - Book a GPU Cloud Demo | GPU Cloud",
    description:
      "Talk to our team about GPU cloud solutions. Book a 15-minute walkthrough — get a demo, pricing, or answers to your questions.",
    url: "https://example.com/contact",
  },
  alternates: {
    canonical: "https://example.com/contact",
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
