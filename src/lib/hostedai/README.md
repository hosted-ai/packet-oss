# hosted.ai Integration Module (`src/lib/hostedai/`)

API client for hosted.ai GPUaaS (GPU-as-a-Service) platform.

## File Structure

```
hostedai/
├── index.ts        # Public exports (use this for imports)
├── types.ts        # TypeScript interfaces for API responses
├── client.ts       # HTTP client with caching
├── teams.ts        # Team/user management
├── billing.ts      # Billing and usage data
├── instances.ts    # VM instance management
├── pools.ts        # GPU pool subscriptions (GPUaaS)
├── metrics.ts      # GPU metrics and monitoring
├── services.ts     # Service exposure (NodePort/LoadBalancer)
└── README.md       # This file
```

## Usage

```typescript
// Import from module root
import {
  createTeam,
  subscribeToPool,
  getPoolSubscriptions,
  getConnectionInfo
} from "@/lib/hostedai";

// Or legacy import (backwards compatible)
import { createTeam } from "@/lib/hostedai";
```

## Core Concepts

### Teams
Each Stripe customer maps to a hosted.ai team:

```typescript
import { createTeam, suspendTeam } from "@/lib/hostedai";

// Create team for new customer
const team = await createTeam({
  name: "Customer Name",
  email: "user@example.com",
  package_id: "pkg_gpu_standard"
});

// Suspend for payment failure
await suspendTeam(team.id);
```

### GPU Pool Subscriptions (GPUaaS)
Provision GPU resources from shared pools:

```typescript
import {
  getAvailablePools,
  subscribeToPool,
  getConnectionInfo,
  unsubscribeFromPool
} from "@/lib/hostedai";

// Find available GPUs
const pools = await getAvailablePools(teamId);

// Subscribe to a pool
const subscription = await subscribeToPool({
  pool_id: pools[0].id,
  team_id: teamId,
  vgpus: 1,
  instance_type_id: "type_medium",
  ephemeral_storage_block_id: "storage_100gb"
});

// Get SSH credentials
const connection = await getConnectionInfo(subscription.subscription_id);
// { host, port, username, password }

// Terminate when done
await unsubscribeFromPool(subscription.subscription_id, teamId);
```

### Billing

```typescript
import { getTeamBillingSummaryV2 } from "@/lib/hostedai";

const billing = await getTeamBillingSummaryV2(
  teamId,
  "2024-01-01T00:00:00Z",
  "2024-01-31T23:59:59Z"
);
// { total_cost, pool_hours, gpuaas_summary }
```

### Service Exposure
Expose services running on GPU pods:

```typescript
import { exposeService, getExposedServices } from "@/lib/hostedai";

// Expose vLLM API server
await exposeService(subscriptionId, teamId, {
  port: 8000,
  service_type: "LoadBalancer"
});

// Get external endpoints
const services = await getExposedServices(subscriptionId, teamId);
```

## Caching

The client includes an in-memory cache for frequently accessed data:

```typescript
import { clearCache } from "@/lib/hostedai";

// Clear all cached data
clearCache();
```

Cache TTLs vary by endpoint type:
- Pool lists: 5 minutes
- Instance types: 10 minutes
- Billing data: No cache

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOSTEDAI_API_URL` | Yes | API base URL |
| `HOSTEDAI_API_KEY` | Yes | API authentication key |
| `DEFAULT_USER_PASSWORD` | No | Default password for pre-onboarded users |
| `DEFAULT_IMAGE_UUID` | No | Fallback VM image UUID |

## Error Handling

All functions throw descriptive errors:

```typescript
try {
  await subscribeToPool({ ... });
} catch (error) {
  if (error.message.includes("No GPUs available")) {
    // Handle capacity issues
  }
  if (error.message.includes("Already subscribed")) {
    // Handle duplicate subscription
  }
}
```

## Important Notes

1. **Image IDs**: The `/policy/image` endpoint returns hash-format IDs (64 chars), but the subscribe API expects UUID format. Use `DEFAULT_IMAGE_UUID` as fallback.

2. **Instance Types**: Use `gpu_workload: true` types from `/instance-type`. The `/gpuaas/pool/compatible-instance-types` endpoint returns incorrect types.

3. **User Pre-onboarding**: Pass `password` and `pre_onboard: true` in the team member object during team creation. Don't use the separate `/api/onboard` endpoint.
