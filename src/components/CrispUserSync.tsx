"use client";

import { useEffect, useRef, useCallback } from "react";
import type { AccountData } from "@/app/dashboard/components/types";

interface CrispUserSyncProps {
  data: AccountData;
  token: string | null;
}

/**
 * CrispUserSync — keeps Crisp in sync with the logged-in user's live state.
 *
 * A single `syncAll()` function pushes everything to Crisp, called from
 * three triggers so data is never stale:
 *
 *   1. Whenever `data` or `token` change (every verify call / page load)
 *   2. On `crisp:session-loaded`  — fires after the Crisp SDK initialises its
 *      session, which may happen AFTER our first push on a fresh page load
 *      (e.g. after a Stripe redirect).  Re-pushing here guarantees the Crisp
 *      session holds current values (wallet balance, etc.).
 *   3. On `crisp:profile-updated` — fired by ProfileSettings on save so
 *      use_case / phone / timezone update in Crisp without a page refresh.
 *
 * Features implemented here:
 *   2 — User identification (email, nickname, phone, company)
 *   3 — Custom session:data fields (wallet_balance, role, use_case, …)
 *
 * Feature 5 (session:reset on logout) is called in handleLogout in
 * DashboardContent so it fires before the page navigates away.
 */
export function CrispUserSync({ data, token }: CrispUserSyncProps) {
  // Refs hold the latest values so event-listener callbacks are never stale
  const dataRef  = useRef(data);
  const tokenRef = useRef(token);
  useEffect(() => { dataRef.current  = data;  }, [data]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // ─── CRISP_TOKEN_ID: cross-device session continuity ──────────────────────
  // Set as early as possible so the SDK can link this browser to the user's
  // existing conversation history.  Must be set before (or shortly after) the
  // SDK script initialises — the Stripe customer ID is a stable, unique token.
  useEffect(() => {
    const customerId = data?.customer?.id;
    if (!customerId) return;
    window.CRISP_TOKEN_ID = customerId;
  }, [data?.customer?.id]);

  // ─── Core sync function ───────────────────────────────────────────────────
  const syncAll = useCallback(() => {
    const d = dataRef.current;
    const t = tokenRef.current;
    if (!d?.userEmail) return;

    window.$crisp = window.$crisp || ([] as unknown as Window["$crisp"]);

    // Feature 2: User identity
    const email       = d.userEmail;
    const displayName = d.userDisplayName || d.customer.name || email;
    window.$crisp.push(["set", "user:email",    [email]]);
    window.$crisp.push(["set", "user:nickname", [displayName]]);
    if (d.customer.teamName) {
      window.$crisp.push(["set", "user:company", [{ name: d.customer.teamName }]]);
    }

    // Feature 3: Session data (always fresh — wallet balance, role, etc.)
    // billing_type values: "hourly" = pay-per-hour wallet, "monthly" = subscription
    const billingLabel =
      d.customer.billingType === "monthly" ? "Monthly subscription"
      : d.customer.billingType === "free"  ? "Free / trial"
      : "Hourly (prepaid wallet)";

    const sessionData: [string, string | number][] = [
      ["stripe_customer_id", d.customer.id],
      ["billing_type",       billingLabel],
      ["team_id",            d.customer.teamId      || ""],
      ["role",               d.role ?? (d.isOwner ? "owner" : "member")],
      ["wallet_balance",     d.wallet?.balanceFormatted ?? "N/A"],
      ["account_created",    new Date(d.customer.created * 1000).toLocaleDateString()],
    ];
    if (d.customer.teamName) sessionData.push(["team_name",      d.customer.teamName]);
    if (d.roleDisplayName)   sessionData.push(["role_display",   d.roleDisplayName]);
    if (d.bareMetalEnabled)  sessionData.push(["bare_metal_access", "yes"]);
    window.$crisp.push(["set", "session:data", [sessionData]]);

    // Feature 3 (extended): profile fields from /api/account/profile
    if (!t) return;
    fetch("/api/account/profile", { headers: { Authorization: `Bearer ${t}` } })
      .then((res) => {
        if (!res.ok) {
          console.error(`[CrispUserSync] profile fetch failed: ${res.status}`);
          return null;
        }
        return res.json();
      })
      .then((body) => {
        // Response shape: { success: true, profile: { useCase, phone, … } }
        const profile = body?.profile;
        if (!profile) return;

        // Feature 2: phone
        if (profile.phone) {
          window.$crisp.push(["set", "user:phone", [profile.phone]]);
        }

        // Company from KYC profile (may be richer than teamName)
        const companyName = profile.company || d.customer.teamName;
        if (companyName) {
          window.$crisp.push(["set", "user:company", [{ name: companyName }]]);
        }

        // Feature 3: extended sidebar fields
        const USE_CASE_LABELS: Record<string, string> = {
          "ml-training":  "Machine Learning Training",
          "inference":    "AI Inference",
          "fine-tuning":  "Model Fine-tuning",
          "research":     "Research & Development",
          "rendering":    "3D Rendering / Video",
          "gaming":       "Gaming / Streaming",
          "other":        "Other",
        };
        const profileData: [string, string][] = [];
        if (profile.useCase)          profileData.push(["use_case",       USE_CASE_LABELS[profile.useCase] ?? profile.useCase]);
        if (profile.timezone)         profileData.push(["timezone",        profile.timezone]);
        if (profile.country)          profileData.push(["country",         profile.country]);
        if (profile.jobTitle)         profileData.push(["job_title",       profile.jobTitle]);
        if (profile.companyWebsite)   profileData.push(["company_website", profile.companyWebsite]);
        if (profile.companyRegNumber) profileData.push(["company_reg",     profile.companyRegNumber]);

        if (profileData.length > 0) {
          window.$crisp.push(["set", "session:data", [profileData]]);
        }
      })
      .catch((err) => console.error("[CrispUserSync] profile fetch error:", err));
  }, []); // stable — reads latest values via refs

  // Trigger 1: data or token changed (every page load / verify call)
  useEffect(() => {
    if (!data?.userEmail) return;
    syncAll();
  }, [data, token, syncAll]);

  // Trigger 2: Crisp session loaded (re-push after SDK initialises its session)
  // Trigger 3: profile saved in Settings
  useEffect(() => {
    window.addEventListener("crisp:session-loaded",   syncAll);
    window.addEventListener("crisp:profile-updated",  syncAll);
    return () => {
      window.removeEventListener("crisp:session-loaded",  syncAll);
      window.removeEventListener("crisp:profile-updated", syncAll);
    };
  }, [syncAll]);

  return null;
}
