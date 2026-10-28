// Zod response schemas backing the OpenAPI contract spec (PA-261, Part A).
//
// Single source of truth: `generate-openapi.ts` turns each schema into an
// OpenAPI `components.schemas` entry (via zod v4's built-in `z.toJSONSchema`),
// and `*.test.ts` files parse a real handler response against the same
// schema. Add a schema here + an entry in `registry.ts` for each new endpoint
// this suite covers.

import { z } from "zod";

// ── Public / no-auth ────────────────────────────────────────────────────────

export const BrandingResponse = z.object({
  brandName: z.string(),
  appUrl: z.string(),
  dashboardUrl: z.string(),
  supportEmail: z.string(),
  logoUrl: z.string().optional(),
}).passthrough();

export const AnalyticsConfigResponse = z.object({
  key: z.string().nullable(),
  host: z.string().nullable(),
});

export const CliConfigResponse = z.object({
  brandName: z.string(),
  apiBaseUrl: z.string(),
  dashboardUrl: z.string(),
  docsUrl: z.string(),
  statusUrl: z.string(),
  supportEmail: z.string(),
  version: z.string(),
});

export const StatusResponse = z.object({
  status: z.enum(["operational", "degraded"]),
  gpus: z.array(
    z.object({ gpuType: z.string(), name: z.string(), status: z.string() }),
  ),
  uptime: z.record(z.string(), z.number()),
  lastChecked: z.string(),
});

export const WidgetGpuStatusResponse = z.array(
  z.object({ gpuType: z.string(), name: z.string(), status: z.string() }),
);

export const WidgetPricingResponse = z.array(
  z.object({
    gpuType: z.string(),
    name: z.string(),
    hourlyRateCents: z.number(),
    monthlyRateCents: z.number().nullable(),
    specs: z.object({ vram: z.string(), architecture: z.string() }).nullable(),
  }),
);

export const TenantsConfigResponse = z.object({
  brandName: z.string(),
  logoUrl: z.string(),
  primaryColor: z.string(),
  customStrings: z.record(z.string(), z.string()).nullable(),
});

export const GpuOfferingsResponse = z.object({
  success: z.literal(true),
  data: z.object({
    offerings: z.array(z.record(z.string(), z.unknown())),
    proofSection: z.record(z.string(), z.unknown()),
    carouselSettings: z.record(z.string(), z.unknown()),
  }),
});

export const ProvidersGpuTypesResponse = z.object({
  success: z.literal(true),
  data: z.object({
    gpuTypes: z.array(
      z.object({
        id: z.union([z.string(), z.number()]),
        name: z.string(),
        shortName: z.string(),
        manufacturer: z.string(),
        providerRate: z.object({ cents: z.number(), formatted: z.string() }),
        customerRate: z.object({ cents: z.number(), formatted: z.string() }),
        termsType: z.string(),
        revenueSharePercent: z.number(),
        payoutModelChoice: z.string().nullable(),
        minVramGb: z.number().nullable(),
        estimatedMonthly: z.object({
          at100: z.string(),
          at80: z.string(),
          at60: z.string(),
        }),
      }),
    ),
    note: z.string(),
  }),
});

export const BannerResponse = z.object({
  success: z.literal(true),
  data: z
    .object({
      id: z.union([z.string(), z.number()]),
      text: z.string(),
      linkUrl: z.string().nullable(),
      linkText: z.string().nullable(),
      backgroundColor: z.string().nullable(),
      textColor: z.string().nullable(),
      dismissible: z.boolean(),
    })
    .nullable(),
});

export const DemandListResponse = z.object({
  requests: z.array(z.record(z.string(), z.unknown())),
});

export const DemandInterestResponse = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const DemandSubscribeResponse = z.object({
  success: z.literal(true),
  message: z.string(),
  subscriber: z.object({ id: z.union([z.string(), z.number()]), email: z.string(), name: z.string() }),
});

export const DemandSubscriptionStatusResponse = z.object({
  subscribed: z.boolean(),
  subscriber: z
    .object({
      id: z.union([z.string(), z.number()]),
      email: z.string(),
      name: z.string(),
      company: z.string(),
    })
    .nullable(),
});

export const QuoteResponse = z.object({
  quote: z.object({
    quoteNumber: z.string(),
    customerName: z.string(),
    customerCompany: z.string(),
    gpuType: z.string(),
    gpuCount: z.number(),
    gpuMemory: z.string().nullable().optional(),
    specs: z.string().nullable().optional(),
    pricing: z.record(z.string(), z.unknown()).nullable().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    startsAt: z.string().nullable().optional(),
    expiresAt: z.string(),
    status: z.string(),
    customerResponse: z.unknown().nullable().optional(),
  }),
});

export const QuoteResponseActionResponse = z.object({
  success: z.literal(true),
  status: z.string(),
});

export const TrackResponse = z.object({ ok: z.literal(true) });

export const GamePlayResponse = z.object({
  success: z.literal(true),
  id: z.union([z.string(), z.number()]),
});

export const VoucherValidateResponse = z.object({
  success: z.literal(true),
  voucher: z.record(z.string(), z.unknown()),
});

export const ContactResponse = z.object({ success: z.literal(true) });

export const ProvidersApplyGetResponse = z.object({
  success: z.literal(true),
  data: z.object({
    gpuTypes: z.array(
      z.object({
        name: z.string(),
        shortName: z.string(),
        manufacturer: z.string(),
        providerRate: z.string(),
        customerRate: z.string(),
        termsType: z.string(),
        revenueSharePercent: z.number(),
      }),
    ),
    regions: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

// ── Customer-authed ─────────────────────────────────────────────────────────

export const AccountActivityResponse = z.object({
  events: z.array(z.record(z.string(), z.unknown())),
});

export const OkResponse = z.object({ ok: z.literal(true) });

export const SessionTokenResponse = z.object({ token: z.string() });

export const BudgetSettingsResponse = z.object({
  monthlyLimitCents: z.number().nullable(),
  dailyLimitCents: z.number().nullable(),
  alertAt50Percent: z.boolean(),
  alertAt80Percent: z.boolean(),
  alertAt100Percent: z.boolean(),
  autoShutdownEnabled: z.boolean(),
  autoShutdownThreshold: z.number(),
});

export const BudgetUpdateResponse = z.object({
  success: z.literal(true),
  settings: BudgetSettingsResponse,
});

export const AccountVoucherValidateResponse = z.object({
  success: z.literal(true),
  voucher: z.record(z.string(), z.unknown()),
});

export const VoucherRedeemResponse = z.object({
  success: z.literal(true),
  creditCents: z.number(),
});

export const SupportUnreadResponse = z.object({
  success: z.literal(true),
  hasUnreadReplies: z.boolean(),
});

export const SnapshotResponse = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  notes: z.string().nullable(),
  snapshotType: z.string(),
  poolId: z.string().nullable(),
  poolName: z.string().nullable(),
  vgpus: z.number().nullable(),
  hasStorage: z.boolean(),
  storage: z
    .object({
      id: z.union([z.string(), z.number()]).nullable(),
      name: z.string().nullable(),
      sizeGb: z.number().nullable(),
    })
    .nullable(),
  hfModel: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      type: z.string().nullable(),
      deployScript: z.string().nullable(),
    })
    .nullable(),
  // Always a string post-JSON.stringify, even though the Prisma row's field is a Date.
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SnapshotsListResponse = z.object({
  success: z.literal(true),
  snapshots: z.array(SnapshotResponse),
  count: z.number(),
});
