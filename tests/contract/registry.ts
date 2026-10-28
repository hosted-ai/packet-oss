// Registry of internal API endpoints covered by the contract test suite
// (PA-261, Part A). Each entry's `response` schema is the single source of
// truth for both the generated OpenAPI spec (`generate-openapi.ts`) and the
// live response-shape assertions in `*.test.ts`.
//
// Scope: a deliberately chosen subset of cheap, low-side-effect internal
// endpoints (public marketing/config routes + a slice of customer-authed
// account routes). Excluded on purpose: `/api/v1/**` (Token Factory —
// feature-dead per CLAUDE.md), `/api/cron/**`, `/api/webhooks/**`,
// `/api/admin/**`, and `/api/sync` (billing engine) — all too risky/heavy
// for a first contract-test pass. Grow this list over time.

import type { ZodTypeAny } from "zod";
import * as s from "./schemas";

export interface EndpointContract {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  summary: string;
  response: ZodTypeAny;
}

export const contractEndpoints: EndpointContract[] = [
  // Public / no-auth
  { method: "GET", path: "/api/branding", summary: "Public branding values", response: s.BrandingResponse },
  { method: "GET", path: "/api/analytics-config", summary: "PostHog analytics config", response: s.AnalyticsConfigResponse },
  { method: "GET", path: "/api/cli-config", summary: "CLI bootstrap config", response: s.CliConfigResponse },
  { method: "GET", path: "/api/status", summary: "Public GPU status page", response: s.StatusResponse },
  { method: "GET", path: "/api/widget/gpu-status", summary: "Embeddable GPU status widget", response: s.WidgetGpuStatusResponse },
  { method: "GET", path: "/api/widget/pricing", summary: "Embeddable pricing widget", response: s.WidgetPricingResponse },
  { method: "GET", path: "/api/tenants/config", summary: "Tenant branding for the current hostname", response: s.TenantsConfigResponse },
  { method: "GET", path: "/api/gpu-offerings", summary: "Marketing GPU offerings catalog", response: s.GpuOfferingsResponse },
  { method: "GET", path: "/api/providers/gpu-types", summary: "GPU types accepted from providers", response: s.ProvidersGpuTypesResponse },
  { method: "GET", path: "/api/banner", summary: "Active campaign banner", response: s.BannerResponse },
  { method: "GET", path: "/api/demand", summary: "List active infrastructure demand requests", response: s.DemandListResponse },
  { method: "POST", path: "/api/demand", summary: "Submit interest in an infrastructure demand request", response: s.DemandInterestResponse },
  { method: "GET", path: "/api/demand/subscribe", summary: "Check demand-notification subscription status", response: s.DemandSubscriptionStatusResponse },
  { method: "POST", path: "/api/demand/subscribe", summary: "Subscribe to demand notifications", response: s.DemandSubscribeResponse },
  { method: "GET", path: "/api/quote/{token}", summary: "Fetch a customer quote by token", response: s.QuoteResponse },
  { method: "POST", path: "/api/quote/{token}", summary: "Customer responds to a quote", response: s.QuoteResponseActionResponse },
  { method: "POST", path: "/api/track", summary: "Anonymous marketing page-view recorder", response: s.TrackResponse },
  { method: "POST", path: "/api/game/play", summary: "Record a marketing mini-game play", response: s.GamePlayResponse },
  { method: "POST", path: "/api/voucher/validate", summary: "Validate a voucher code (public)", response: s.VoucherValidateResponse },
  { method: "POST", path: "/api/contact", summary: "Marketing contact form submission", response: s.ContactResponse },
  { method: "GET", path: "/api/providers/apply", summary: "GPU types + regions for the provider application form", response: s.ProvidersApplyGetResponse },

  // Customer-authed
  { method: "GET", path: "/api/account/activity", summary: "Customer activity feed", response: s.AccountActivityResponse },
  { method: "POST", path: "/api/account/logout", summary: "Log out (revoke session)", response: s.OkResponse },
  { method: "POST", path: "/api/account/session", summary: "Refresh the customer session", response: s.SessionTokenResponse },
  { method: "GET", path: "/api/account/budget", summary: "Get budget/alert settings", response: s.BudgetSettingsResponse },
  { method: "PUT", path: "/api/account/budget", summary: "Update budget/alert settings", response: s.BudgetUpdateResponse },
  { method: "POST", path: "/api/account/voucher/validate", summary: "Validate a voucher code (authed)", response: s.AccountVoucherValidateResponse },
  { method: "POST", path: "/api/account/voucher/redeem", summary: "Redeem a voucher code", response: s.VoucherRedeemResponse },
  { method: "GET", path: "/api/support/unread", summary: "Unread support-reply badge", response: s.SupportUnreadResponse },
  { method: "GET", path: "/api/instances/snapshots", summary: "List pod snapshots", response: s.SnapshotsListResponse },
];
