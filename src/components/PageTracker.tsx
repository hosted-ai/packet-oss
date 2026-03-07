"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureUtm } from "@/lib/utm";
import { trackPageView } from "@/lib/tracker";

/**
 * Drop-in client component that captures UTM params and records
 * anonymous page views. Add once in a layout — it re-fires on
 * every client-side navigation via usePathname().
 */
export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    captureUtm();
    trackPageView();
  }, [pathname]);

  return null;
}
