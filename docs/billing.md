# Billing & Usage Guide

Understand how billing works and manage your costs effectively.

## Billing Model

GPU Cloud Platform uses **pay-as-you-go** billing:

- **GPU compute**: Billed per hour while running
- **Persistent storage**: Billed per hour continuously
- **Network**: Included at no extra charge

You're only charged for what you use. No long-term commitments required.

## Pricing

### GPU Compute

| GPU Model | Price per Hour |
|-----------|----------------|
| NVIDIA L4 | $0.50 - $0.80 |
| NVIDIA A100 40GB | $2.00 - $3.00 |
| NVIDIA A100 80GB | $3.00 - $4.00 |
| NVIDIA H100 | $4.00 - $5.00 |

*Prices vary by availability and region.*

### Storage

| Type | Price per Hour | Price per Month (approx) |
|------|----------------|--------------------------|
| 10GB Persistent | $0.005 | ~$3.60 |
| 20GB Persistent | $0.01 | ~$7.20 |
| 50GB Persistent | $0.025 | ~$18.00 |
| 100GB Persistent | $0.05 | ~$36.00 |

Ephemeral storage is included with your GPU at no extra cost.

## Payment Methods

### Subscription Plans

Monthly subscription with included credits:

1. Choose a plan during signup
2. Credits are added to your balance monthly
3. Overage is charged to your card

### Prepaid Balance

Add funds to your account:

1. Go to **Billing** in the sidebar
2. Click **Add Funds**
3. Choose an amount ($25, $50, $100, $500, or custom)
4. Complete payment via Stripe

### Voucher Codes

Redeem promotional vouchers:

1. Go to **Billing** in the sidebar
2. Enter your voucher code
3. Credits are instantly added to your balance

## Understanding Your Bill

### Current Balance

Your balance in the sidebar shows:
- **Available credits** from subscription or prepaid
- **Pending charges** accumulating this billing period

### Usage Breakdown

View detailed usage in **Billing**:

- GPU hours by instance
- Storage hours by volume
- Daily and monthly trends

### Invoice History

Access past invoices:
1. Go to **Billing**
2. Click **Invoice History**
3. Download PDF invoices for accounting

## Cost Optimization Tips

### 1. Stop Unused Instances

Stopped instances don't incur GPU charges:

```
Running: $2.00/hr → Stopped: $0.00/hr
```

Use **Stop** when not actively training or inferencing.

### 2. Right-Size Your GPU

Don't overprovision:

| Workload | Recommended |
|----------|-------------|
| Small models (< 7B) | 1x L4 |
| Medium models (7B-13B) | 1x L4 or A100 |
| Large models (30B-70B) | 2-4x L4 or A100 |
| Training | Multiple GPUs |

### 3. Use Ephemeral Storage When Possible

Persistent storage costs extra. Use it only for:
- Training checkpoints you need to keep
- Datasets you'll reuse
- Model weights you're iterating on

### 4. Clean Up Unused Resources

Regularly review and terminate:
- Instances you no longer need
- Persistent volumes not attached to instances

### 5. Monitor Spending

Set up alerts (coming soon) or check your dashboard daily during active development.

## Billing Cycle

### How Charges Accumulate

1. **Start instance**: Billing begins immediately
2. **Running**: Charges accumulate per hour
3. **Stop instance**: GPU billing pauses
4. **Terminate**: Final charges applied

### Proration

All charges are prorated to the second. If you run a $2/hr GPU for 30 minutes, you're charged $1.00.

### When You're Charged

- **Subscription**: Monthly on your billing date
- **Overages**: Charged when you exceed plan credits
- **Prepaid**: Deducted from balance in real-time

## Low Balance Warnings

When your balance is low:

1. **Warning email** at $10 remaining
2. **Critical email** at $5 remaining
3. **Service pause** at $0 (you can add funds to resume)

Keep your balance healthy to avoid interruptions.

## Account Management

### Update Payment Method

1. Go to **Billing**
2. Click **Manage Payment**
3. Update card via Stripe portal

### Cancel Subscription

1. Terminate all running instances
2. Go to **Settings**
3. Click **Cancel Subscription**
4. Remaining balance is available until depleted

### Download Invoices

1. Go to **Billing**
2. Click **Invoice History**
3. Download individual invoices or statements

## Referral Program

Earn credits by referring others:

1. Share your referral link from **Settings**
2. When someone signs up and adds funds, you both get credits
3. No limit on referrals

## FAQ

### When am I charged?

Immediately when you start a GPU. Charges accumulate per-second and are billed to your balance or card.

### Can I set a spending limit?

Not yet, but we're working on budget alerts. For now, monitor your usage in the dashboard.

### What happens if I run out of credits?

Running instances will be paused. Add funds to resume immediately.

### Do stopped instances cost money?

GPU charges stop when you stop an instance. Persistent storage continues to be billed.

### Can I get a refund?

Contact support for billing issues. Unused prepaid credits can be refunded within 30 days.

### Is there a free trial?

Check our website for current promotions. Some plans include free credits to get started.

## Need Help?

For billing questions, contact [support@example.com](mailto:support@example.com)
