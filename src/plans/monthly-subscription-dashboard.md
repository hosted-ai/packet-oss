# Monthly Subscription GPU Dashboard - Implementation Plan

## Current State

After paying $199/mo via Stripe checkout, a monthly subscriber lands on the dashboard. Today, the dashboard is entirely wallet-centric: it gates GPU launches behind `walletBalance > 0`, shows a live cost ticker, and has no concept of "subscription entitlements." Monthly users see a CTA banner to subscribe (even if they already have) but cannot deploy a GPU because the wallet check blocks them.

## Goal

Monthly subscribers see their active subscription(s) as deployable GPU entitlements in the dashboard, visually distinct (teal) from hourly GPUs. They can deploy/terminate GPUs freely while their subscription is active. The hourly wallet flow remains untouched and works side-by-side.

---

## Phase 1: Database - Add `billingType` and `stripeSubscriptionId` to PodMetadata

**File:** `prisma/schema.prisma` (lines 49-69)

Add two fields to `PodMetadata`:
```
billingType           String?   // "hourly" or "monthly" - null for legacy pods
stripeSubscriptionId  String?   // Links monthly pod to the Stripe subscription that pays for it
```

Run `npx prisma migrate dev --name add-pod-billing-fields`.

**Why:** When a subscription is canceled, we need to find which pod(s) belong to it. And the dashboard needs to know whether a running pod is hourly or monthly for visual distinction and billing logic.

---

## Phase 2: Verify API - Return Multiple Subscriptions

**File:** `src/app/api/account/verify/route.ts` (lines 96-115)

Currently fetches `limit: 1` active subscription and returns a single `subscription` object.

**Changes:**
1. Fetch `limit: 10` (or all) active subscriptions instead of 1
2. For each subscription, look up the associated `GpuProduct` via the subscription's `stripePriceId`
3. Return `subscriptions: [...]` array (plural) alongside the existing `subscription` for backward compatibility
4. Each subscription object includes: `id`, `status`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `productId`, `productName`, `poolIds`
5. Still return `wallet` for non-monthly users (keep existing logic)

**Key insight:** A customer with `billing_type: "monthly"` may also want hourly GPUs. The verify API should always return wallet data regardless of billing_type, but also always check for active subscriptions.

---

## Phase 3: Checkout Flow - Allow Additional Subscriptions

**File:** `src/app/api/checkout/route.ts` (lines 73-95)

**Current problem:** Lines 73-95 check if a customer has ANY active subscription and redirects to billing portal. This blocks buying a second subscription.

**Changes:**
1. For monthly products: check if the customer already has an active subscription for **this specific product** (same `stripePriceId`). If yes, redirect to portal.
2. If they have a subscription for a DIFFERENT product, allow checkout for the new one.
3. For hourly products: keep existing logic (redirect to wallet if already hourly).

---

## Phase 4: Instances API - Monthly Deploy Bypass

**File:** `src/app/api/instances/route.ts` (POST handler, lines 609-817)

**Current blockers for monthly:**
- Line 640-647: Rejects if `hourlyRateCents === 0`
- Lines 649-687: Wallet balance check and pre-charge
- Lines 803-817: WalletTransaction logging

**Changes:**

Add a new code path when the request includes `billingType: "monthly"` and `stripeSubscriptionId`:

1. **Validate subscription:** Before deploying, call Stripe API to verify the subscription is active and matches the customer
2. **Skip wallet check entirely** - no balance check, no prepaid amount, no WalletTransaction
3. **Set PodMetadata fields:** `billingType: "monthly"`, `stripeSubscriptionId`, `hourlyRateCents: 0`
4. **Check entitlement:** Ensure the customer doesn't already have a running pod for this subscription (1 GPU per subscription)
5. **Use product's poolIds** to determine which pool to deploy from

The request body from the frontend will include: `{ ...existingFields, billingType: "monthly", stripeSubscriptionId: "sub_xxx", productId: "clxxx" }`

---

## Phase 5: Webhook - Terminate Monthly GPUs on Cancellation

**File:** `src/app/api/webhooks/stripe/route.ts`

### `handleSubscriptionCanceled` (lines 748-769)

**Current:** Only calls `suspendTeam(teamId)`.

**Add:**
1. Query `PodMetadata` for records with `stripeSubscriptionId` matching the canceled subscription ID
2. For each found pod, call the hosted.ai API to terminate the pool subscription
3. Delete/clean up the PodMetadata record
4. Log the termination

### `handlePaymentFailed` (lines 771-789)

**Add:** Same pod termination logic as cancellation - if a monthly payment fails, terminate the associated GPU.

### `handlePaymentSucceeded` (lines 791-812)

**No change needed** - the subscription stays active, GPU keeps running.

---

## Phase 6: Dashboard UI - Subscription Entitlement Cards

**File:** `src/app/dashboard/components/DashboardContent.tsx`

This is the largest change. Here's the breakdown:

### 6a. Fetch and store subscription data

Add state for subscriptions array:
```typescript
const subscriptions = data?.customer?.subscriptions || [];
```

### 6b. "Monthly GPU" entitlement cards section

Above or alongside the existing hourly GPU grid, render a new section for monthly subscription entitlements:

- Each active subscription shows as a teal-bordered card
- Card shows: GPU name, "$199/mo", subscription period, status
- If no pod is running for this subscription: show a "Deploy GPU" button
- If a pod IS running: show the pod status, SSH info, and a "Terminate" button
- Visual: teal gradient border/accent (matching existing BlackwellModal styling)

### 6c. Fix `handleLaunchGpu` (line 278-285)

The existing function gates behind `walletBalance > 0`. Monthly users should bypass this:

```typescript
const handleLaunchGpu = React.useCallback(() => {
  // Monthly users with active subscriptions can always launch
  if (subscriptions.length > 0) {
    setShowLaunchModal(true);
    return;
  }
  // Hourly users need wallet balance
  const walletBalance = data?.wallet?.balance ?? 0;
  if (walletBalance <= 0) {
    setShowTopupModal(true);
    return;
  }
  setShowLaunchModal(true);
}, [data?.wallet?.balance, subscriptions]);
```

But actually, monthly deploy should use a **dedicated flow** - not the same launch modal. Monthly users click "Deploy" on their subscription card, which calls the instances API with the subscription context. No launch modal needed.

### 6d. Monthly subscription CTA banner

The existing CTA banner (lines 754-773) should only show if the user has NO active monthly subscription. If they already have one, replace it with their subscription card.

### 6e. Running pods visual distinction

In the pod cards grid, monthly pods should have a teal indicator/badge saying "Monthly" and should NOT show cost/spend info (since they're flat-rate).

---

## Phase 7: BlackwellModal - Repurpose for Additional Subscriptions

**File:** `src/app/dashboard/components/BlackwellModal.tsx`

Currently only used for initial purchase. Keep it as-is but make it available for buying **additional** subscriptions from the dashboard. The modal already handles checkout redirect correctly.

---

## Implementation Order

1. **Phase 1** - Database migration (PodMetadata fields)
2. **Phase 2** - Verify API returns subscriptions array
3. **Phase 3** - Checkout allows multiple subscriptions
4. **Phase 4** - Instances API monthly deploy bypass
5. **Phase 5** - Webhook pod termination on cancellation
6. **Phase 6** - Dashboard UI (subscription cards, deploy flow, visual distinction)
7. **Phase 7** - BlackwellModal tweaks

Each phase can be tested independently before moving to the next.

---

## Edge Cases to Handle

1. **User has both hourly wallet AND monthly subscription** - Both should work independently. Dashboard shows wallet section + subscription cards side by side.
2. **User terminates monthly GPU and re-deploys** - Should work as long as subscription is active. Check subscription status before allowing redeploy.
3. **Subscription renewal** - No action needed, GPU keeps running.
4. **Failed payment → grace period → cancellation** - Terminate GPU on `customer.subscription.deleted` (Stripe handles the grace period internally).
5. **User cancels subscription with `cancel_at_period_end`** - GPU runs until period end. On `customer.subscription.deleted` event, terminate.
6. **Multiple subscriptions** - Each subscription = 1 GPU entitlement. User can have N subscriptions and N monthly GPUs.
7. **Race condition on deploy** - Use existing deploy lock mechanism (Stripe customer metadata) to prevent double-deploy for same subscription.
