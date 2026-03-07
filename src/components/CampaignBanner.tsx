"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface BannerData {
  id: string;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  backgroundColor: string;
  textColor: string;
  dismissible: boolean;
}

export default function CampaignBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchBanner = async () => {
      try {
        const res = await fetch("/api/banner");
        const result = await res.json();
        if (result.success && result.data) {
          // Check if this banner was previously dismissed
          const dismissedId = sessionStorage.getItem("dismissed_banner");
          if (dismissedId !== result.data.id) {
            setBanner(result.data);
          }
        }
      } catch {
        // Silently fail - banner is non-critical
      }
    };
    fetchBanner();
  }, []);

  if (!banner || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("dismissed_banner", banner.id);
  };

  return (
    <div
      className="w-full px-4 py-2.5 text-center text-sm font-medium relative"
      style={{ backgroundColor: banner.backgroundColor, color: banner.textColor }}
    >
      <span>{banner.text}</span>
      {banner.linkUrl && (
        <>
          {" "}
          <Link
            href={banner.linkUrl}
            className="underline underline-offset-2 font-semibold hover:opacity-80 transition-opacity"
            style={{ color: banner.textColor }}
          >
            {banner.linkText || "Learn more"}
          </Link>
        </>
      )}
      {banner.dismissible && (
        <button
          onClick={handleDismiss}
          className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-70 transition-opacity"
          style={{ color: banner.textColor }}
          aria-label="Dismiss banner"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
