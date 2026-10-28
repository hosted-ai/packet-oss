"use client";

export function BillingDoc() {
  return (
    <div>
      <p className="lead">
        This platform offers two ways to rent GPUs: pay-as-you-go with a prepaid wallet, or a flat-rate monthly subscription.
      </p>

      {/* Table of Contents */}
      <nav className="docs-toc">
        <h4>On this page</h4>
        <ul>
          <li><a href="#two-billing-models">Two Ways to Rent a GPU</a></li>
          <li><a href="#hourly-wallet">Hourly (Pay-as-you-go)</a></li>
          <li><a href="#monthly-subscription">Monthly Subscription</a></li>
          <li><a href="#gpu-pricing">GPU Pricing</a></li>
          <li><a href="#how-wallet-works">How the Wallet Works</a></li>
          <li><a href="#storage-pricing">Storage Pricing</a></li>
          <li><a href="#cost-management">Cost Management Tips</a></li>
          <li><a href="#faq">FAQ</a></li>
        </ul>
      </nav>

      {/* ── Two Billing Models ─────────────────────────────────── */}

      <h2 id="two-billing-models">Two Ways to Rent a GPU</h2>
      <p>
        Every GPU on this platform is available through one of two billing models.
        Choose the one that fits your workload:
      </p>

      <div className="docs-plans">
        <div className="docs-plan">
          <p className="docs-plan-eyebrow">Option 1</p>
          <h3 className="docs-plan-title">Hourly (Wallet)</h3>
          <ul>
            <li>Top up your wallet, deploy GPUs on demand</li>
            <li>Pay only for what you use</li>
            <li>Billed in 30-minute intervals</li>
            <li>Unused time in a billing window is credited back</li>
            <li>No commitment &mdash; terminate anytime</li>
          </ul>
        </div>
        <div className="docs-plan docs-plan-accent">
          <p className="docs-plan-eyebrow">Option 2</p>
          <h3 className="docs-plan-title">Monthly Subscription</h3>
          <ul>
            <li>$299/mo flat rate for one dedicated GPU</li>
            <li>Paid via credit card (Stripe subscription)</li>
            <li>Completely independent of your wallet balance</li>
            <li>Renews automatically each month</li>
            <li>Cancel anytime from your account</li>
          </ul>
        </div>
      </div>

      {/* ── Hourly / Wallet ────────────────────────────────────── */}

      <h2 id="hourly-wallet">Hourly (Pay-as-you-go)</h2>
      <p>
        The hourly model is designed for on-demand workloads. You add funds to your
        wallet and deploy GPUs whenever you need them. Billing works in <strong>30-minute
        intervals</strong>:
      </p>
      <ol>
        <li><strong>Deploy a GPU</strong> &mdash; 30 minutes of usage is pre-charged from your wallet.</li>
        <li><strong>Every 30 minutes</strong> &mdash; usage is recalculated and the next interval is deducted.</li>
        <li><strong>Terminate early</strong> &mdash; if you stop before the 30-minute window ends, the unused portion is credited back to your wallet.</li>
      </ol>

      <div className="docs-callout docs-callout-success">
        <h4>Example</h4>
        <p>
          You launch an RTX PRO 6000 at $0.66/hr. After 45 minutes you terminate it.
          You&apos;re charged for two 30-minute intervals ($0.33 each = $0.66 total), but
          the 15 unused minutes from the second interval are credited back ($0.165).
          Net cost: <strong>$0.495</strong> for 45 minutes of GPU time.
        </p>
      </div>

      {/* ── Monthly Subscription ───────────────────────────────── */}

      <h2 id="monthly-subscription">Monthly Subscription</h2>
      <p>
        The monthly plan gives you a dedicated GPU for a fixed price. It&apos;s ideal
        for always-on workloads where you know you&apos;ll use the GPU continuously.
      </p>
      <ul>
        <li><strong>$299/month</strong> for one NVIDIA RTX PRO 6000 Blackwell (96GB VRAM)</li>
        <li>Paid via Stripe &mdash; billed to your credit card, not your wallet</li>
        <li>Your wallet balance is completely separate and unaffected</li>
        <li>Renews automatically on the same day each month</li>
        <li>Cancel from your account page &mdash; the GPU stays active until the end of the billing period</li>
      </ul>

      <div className="docs-callout docs-callout-info">
        <h4>Monthly vs. Hourly</h4>
        <p>
          The monthly subscription for the RTX PRO 6000 works out to ~$0.41/hr
          (based on 730 hours/month) &mdash; a <strong>38% saving</strong> compared
          to the hourly rate of $0.66/hr. If you plan to run a GPU for more than
          ~19 days in a month, the subscription is cheaper.
        </p>
      </div>

      {/* ── GPU Pricing ────────────────────────────────────────── */}

      <h2 id="gpu-pricing">GPU Pricing</h2>
      <table>
        <thead>
          <tr>
            <th>GPU</th>
            <th>VRAM</th>
            <th>Hourly</th>
            <th>Monthly</th>
            <th>Best For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>RTX PRO 6000 Blackwell</strong></td>
            <td>96 GB GDDR7</td>
            <td>$0.66/hr</td>
            <td>$299/mo</td>
            <td>Inference, LoRA fine-tuning, Stable Diffusion, open-source models</td>
          </tr>
          <tr>
            <td><strong>NVIDIA B200</strong></td>
            <td>180 GB HBM3e</td>
            <td>$3.75/hr</td>
            <td>&mdash;</td>
            <td>Large model training, 70B+ inference, production serving</td>
          </tr>
        </tbody>
      </table>
      <p>
        Every instance includes full root access, SSH, persistent storage options,
        and no bandwidth charges. Prices are final &mdash; no hidden fees.
      </p>

      {/* ── How the Wallet Works ───────────────────────────────── */}

      <h2 id="how-wallet-works">How the Wallet Works</h2>
      <p>
        Your wallet is a prepaid balance managed through Stripe. It powers all
        hourly GPU usage and persistent storage charges.
      </p>

      <h3>Adding Funds</h3>
      <p>Top up from your dashboard. Available amounts:</p>
      <table>
        <thead>
          <tr>
            <th>Amount</th>
            <th>GPU Time (RTX PRO 6000)</th>
            <th>GPU Time (B200)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>$25</strong></td>
            <td>~37 hours</td>
            <td>~11 hours</td>
          </tr>
          <tr>
            <td><strong>$50</strong></td>
            <td>~75 hours</td>
            <td>~22 hours</td>
          </tr>
          <tr>
            <td><strong>$100</strong></td>
            <td>~151 hours</td>
            <td>~44 hours</td>
          </tr>
          <tr>
            <td><strong>$250</strong></td>
            <td>~378 hours</td>
            <td>~111 hours</td>
          </tr>
          <tr>
            <td><strong>$500</strong></td>
            <td>~757 hours</td>
            <td>~222 hours</td>
          </tr>
        </tbody>
      </table>
      <p>Funds are available immediately after payment.</p>

      <h3>Voucher Codes</h3>
      <p>
        Promotional vouchers add bonus credits to your wallet. Redeem them
        from the billing section of your dashboard.
      </p>

      <h3>Balance Warnings</h3>
      <p>Keep your balance healthy to avoid interruptions:</p>
      <ul>
        <li><strong>$10 remaining</strong> &mdash; consider adding funds soon</li>
        <li><strong>$5 remaining</strong> &mdash; add funds to avoid interruption</li>
        <li><strong>$0 balance</strong> &mdash; running instances may be paused</li>
      </ul>

      {/* ── Storage Pricing ────────────────────────────────────── */}

      <h2 id="storage-pricing">Storage Pricing</h2>
      <table>
        <thead>
          <tr>
            <th>Storage Type</th>
            <th>Price</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Local Storage (NVMe)</strong></td>
            <td>Free</td>
            <td>Included with every GPU, cleared on terminate</td>
          </tr>
          <tr>
            <td><strong>Persistent (NFS)</strong></td>
            <td>$0.10/GB/month</td>
            <td>Survives restarts, billed from wallet</td>
          </tr>
        </tbody>
      </table>
      <p>
        Persistent storage is billed continuously while the volume exists, even if
        the GPU is stopped. Delete the volume to stop storage charges.
      </p>

      {/* ── Cost Management ────────────────────────────────────── */}

      <h2 id="cost-management">Cost Management Tips</h2>

      <h3>1. Terminate When Not in Use</h3>
      <table>
        <thead>
          <tr>
            <th>Instance State</th>
            <th>GPU Billing</th>
            <th>Storage Billing</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Running</strong></td>
            <td>Active</td>
            <td>Active</td>
          </tr>
          <tr>
            <td><strong>Stopped</strong></td>
            <td>Paused</td>
            <td>Active (if persistent)</td>
          </tr>
          <tr>
            <td><strong>Terminated</strong></td>
            <td>Stopped</td>
            <td>Stopped</td>
          </tr>
        </tbody>
      </table>

      <h3>2. Use Local Storage When Possible</h3>
      <p>
        Only use persistent storage for data you need to keep across restarts
        (checkpoints, datasets, model weights).
      </p>

      <h3>3. Consider Monthly for Long-Running Workloads</h3>
      <p>
        If you&apos;ll run an RTX PRO 6000 for more than ~19 days in a month, the
        $299/mo subscription is cheaper than hourly.
      </p>

      <div className="docs-callout docs-callout-danger">
        <h4>Warning</h4>
        <p>
          Terminating an instance deletes all local storage data permanently.
          Save important files to persistent storage or download them first.
        </p>
      </div>

      {/* ── FAQ ────────────────────────────────────────────────── */}

      <h2 id="faq">FAQ</h2>

      <h3>What&apos;s the difference between hourly and monthly?</h3>
      <p>
        <strong>Hourly</strong> is pay-as-you-go from your wallet &mdash; you pay only for the time you use.
        <strong>Monthly</strong> is a flat $299/mo subscription billed to your credit card,
        giving you a dedicated GPU for the entire month. The two are completely independent.
      </p>

      <h3>Do I get charged for a full hour if I stop early?</h3>
      <p>
        No. Billing is in 30-minute intervals. If you terminate before a 30-minute
        window ends, the unused portion is credited back to your wallet automatically.
      </p>

      <h3>Is the monthly subscription tied to my wallet?</h3>
      <p>
        No. The monthly subscription is billed directly to your credit card via Stripe.
        Your wallet balance is not affected. You can have both a monthly GPU and
        hourly GPUs running at the same time.
      </p>

      <h3>What happens if my wallet runs out?</h3>
      <p>
        Running hourly instances may be paused. Add funds to resume immediately.
        Monthly subscriptions are not affected by your wallet balance.
      </p>

      <h3>Can I switch between hourly and monthly?</h3>
      <p>
        Yes. You can subscribe to a monthly GPU and also deploy hourly GPUs from
        your wallet. To switch an existing GPU from hourly to monthly, terminate the
        hourly instance and subscribe to the monthly plan.
      </p>

      <h3>Can I get a refund on wallet funds?</h3>
      <p>
        Unused prepaid credits can be refunded within 30 days of purchase.
        Contact support for refund requests.
      </p>

      <h3>Do you offer enterprise pricing?</h3>
      <p>
        Yes. Contact us for volume discounts, reserved capacity, and custom SLAs.
      </p>

      <h2>Need Help?</h2>
      <p>
        For billing questions, contact our support team.
      </p>
    </div>
  );
}
