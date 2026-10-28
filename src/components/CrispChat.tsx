"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getAppUrl, getDashboardUrl } from "@/lib/branding-client";

/**
 * CrispChat — root-level live chat component.
 *
 * Placed in the root layout so it runs on every page.
 * Returns null (no DOM output).
 *
 * Features implemented here:
 *   1 — Load Crisp SDK once
 *   4 — Segment routing (support vs sales) based on current pathname
 *   6 — Auto-reply after 3 min with no agent response
 *   7 — Inactivity closing message 5 min after agent reply
 *   8 — Infinite-loop prevention flags
 *
 * Features 2, 3, 5 (user identification, session data, logout reset) live in
 * CrispUserSync which is rendered inside the dashboard once user data loads.
 */
export function CrispChat() {
  const pathname = usePathname();
  const autoReplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Feature 8: prevents automated messages from triggering each other
  const isAutomatedMessageRef = useRef(false);
  // Feature 8: prevents sending a second closing message for the same conversation
  const conversationClosedRef = useRef(false);
  // Guard so we only register Crisp event handlers once
  const handlersSetRef = useRef(false);

  // ─── Feature 1: Load Crisp SDK ────────────────────────────────────────────
  useEffect(() => {
    const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
    if (!websiteId) return;

    const SCRIPT_ID = "crisp-sdk";
    // Only append the script once — bail if it already exists in the DOM
    if (document.getElementById(SCRIPT_ID)) return;

    window.$crisp = window.$crisp || ([] as unknown as Window["$crisp"]);
    window.CRISP_WEBSITE_ID = websiteId;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // ─── Feature 4: Segment routing ───────────────────────────────────────────
  // Re-runs on every pathname change so the segment always reflects the current page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Initialise the queue if the SDK hasn't loaded yet
    window.$crisp = window.$crisp || ([] as unknown as Window["$crisp"]);

    const segment = pathname.includes("/support") ? "support" : "sales";
    window.$crisp.push(["set", "session:segments", [[segment]]]);
  }, [pathname]);

  // ─── Features 6, 7, 8: Messaging + loop prevention ────────────────────────
  // Set up Crisp event handlers exactly once.  Commands pushed before the SDK
  // loads are queued and replayed once the SDK initialises, so no polling needed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (handlersSetRef.current) return;
    handlersSetRef.current = true;

    window.$crisp = window.$crisp || ([] as unknown as Window["$crisp"]);

    /** Safely read the visitor's display name from Crisp (only works post-init). */
    const getUserName = (): string => {
      try {
        return window.$crisp.get?.("user:nickname") ?? "";
      } catch {
        return "";
      }
    };

    // Feature 6: Auto-reply — fire if no agent responds within 3 minutes
    const onMessageSent = () => {
      // Feature 8: visitor sent a new message → reopen closed conversation
      conversationClosedRef.current = false;

      // Reset any pending auto-reply timer
      if (autoReplyTimerRef.current) clearTimeout(autoReplyTimerRef.current);

      autoReplyTimerRef.current = setTimeout(() => {
        const name = getUserName();
        const hi = name ? `Hi ${name}! ` : "Hi! ";
        // Feature 8: mark as automated before pushing so the received handler skips it
        isAutomatedMessageRef.current = true;
        window.$crisp.push([
          "do",
          "message:show",
          [
            "text",
            `${hi}All our agents are busy right now. We will connect back with you soon.\n\nYou can find:\n📄 Docs: ${getDashboardUrl()}/docs\n💻 CLI: ${getAppUrl()}/cli\n💰 Products and pricing: ${getAppUrl()}/pricing`,
          ],
        ]);
      }, 60_000); // 1 minute (testing — restore to 180_000 for production)
    };

    // Feature 7: Inactivity closing — fire 5 min after agent reply with no visitor response
    const onMessageReceived = () => {
      // Feature 8: this is one of our own automated messages being reflected back
      // → skip the inactivity timer and clear the flag
      if (isAutomatedMessageRef.current) {
        isAutomatedMessageRef.current = false;
        return;
      }

      // An agent replied → cancel the pending auto-reply timer
      if (autoReplyTimerRef.current) {
        clearTimeout(autoReplyTimerRef.current);
        autoReplyTimerRef.current = null;
      }

      // Start (or restart) the inactivity closing timer
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(() => {
        // Feature 8: only send closing message once per conversation
        if (conversationClosedRef.current) return;
        conversationClosedRef.current = true;
        const name = getUserName();
        const hi = name ? `Hi ${name}! ` : "Hi! ";
        isAutomatedMessageRef.current = true;
        window.$crisp.push([
          "do",
          "message:show",
          [
            "text",
            `${hi}We're closing this conversation as we haven't heard back from you. Feel free to start a new chat anytime — we're happy to help!`,
          ],
        ]);
      }, 60_000); // 1 minute (testing — restore to 300_000 for production)
    };

    window.$crisp.push(["on", "message:sent", onMessageSent]);
    window.$crisp.push(["on", "message:received", onMessageReceived]);

    // Notify CrispUserSync that the Crisp session is ready so it can (re-)push
    // all user data.  This fires on every fresh page load — including after a
    // Stripe redirect — ensuring wallet balance and profile fields are always
    // current even if they were pushed before Crisp finished initialising.
    window.$crisp.push(["on", "session:loaded", () => {
      window.dispatchEvent(new Event("crisp:session-loaded"));
    }]);

    return () => {
      if (autoReplyTimerRef.current) clearTimeout(autoReplyTimerRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, []);

  return null;
}
