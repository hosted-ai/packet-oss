// PA-688 Step 5: the investor-facing bare-metal section.
//
// Pinned contracts:
//   - renders NOTHING for undefined (pre-PA-688 cache payload — the key doesn't
//     exist for up to an hour after deploy) and for null (no regions assigned)
//   - a failed HAI inventory read renders an explicit "unavailable" message, never
//     a confident zero (PA-643's degrade-quietly failure mode)
//   - both revenue bases are labelled (PA-736: accrual is the default view,
//     collected/cash shown alongside)
//   - usage is sortable by customer / duration / paid (ticket AC)
//   - under-contract and hardware power state are shown as SEPARATE facts
//   - unattributed revenue is surfaced, not silently dropped
//   - no real customer identifier reaches the DOM
//   - PA-736: a month series drives a period picker; every figure and the customer
//     list follow the selection, and a payload WITHOUT the series behaves exactly
//     as it did before (pre-PA-736 caches live for an hour after deploy)

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BareMetalSection } from "@/app/investors/components/BareMetalSection";
import type { BareMetalMonth, InvestorBareMetal } from "@/app/investors/types";

/** A month row; cents default to a distinguishable, non-round value. */
function month(over: Partial<BareMetalMonth> & { month: string }): BareMetalMonth {
  return {
    accruedCents: 0,
    investorAccruedCents: 0,
    collectedCents: 0,
    investorCollectedCents: 0,
    potentialCents: null,
    investorPotentialCents: null,
    utilizationPercent: null,
    activeServers: 0,
    customers: 0,
    ...over,
  };
}

function server(over: Partial<InvestorBareMetal["servers"][number]> = {}) {
  return {
    haiNodeId: 1,
    name: "bm-node-1",
    regionId: 75,
    regionName: "ind-k8s-2",
    ipAddress: "10.0.0.1",
    gpuModel: "B200",
    gpuCount: 8,
    cpuCores: 224,
    ramGb: 2048,
    storageGb: 8192,
    osType: "Ubuntu 22.04",
    hardwareStatus: "Online",
    serviceStatus: "In service",
    underContract: true,
    firstLiveAt: "2026-06-01T00:00:00.000Z",
    totalLiveHours: 1488,
    timeline: [
      {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-15T00:00:00.000Z",
        live: true,
        customerIds: ["customer-1"],
      },
      {
        from: "2026-06-15T00:00:00.000Z",
        to: "2026-06-30T00:00:00.000Z",
        live: false,
        customerIds: [],
      },
      { from: "2026-06-30T00:00:00.000Z", to: null, live: true, customerIds: ["customer-2"] },
    ],
    usage: [
      {
        customerId: "customer-1",
        startedAt: "2026-06-01T00:00:00.000Z",
        endedAt: "2026-06-15T00:00:00.000Z",
        durationHours: 336,
        paidCents: 3_000_000,
        windowCents: 0,
        status: "terminated",
        contractMonths: 1,
      },
      {
        customerId: "customer-2",
        startedAt: "2026-06-30T00:00:00.000Z",
        endedAt: null,
        durationHours: 1152,
        paidCents: 6_000_000,
        windowCents: 1_000_000,
        status: "active",
        contractMonths: 3,
      },
    ],
    revenue: {
      accruedWindowCents: 1_000_000,
      investorAccruedWindowCents: 700_000,
      collectedAllTimeCents: 9_000_000,
      investorCollectedAllTimeCents: 6_300_000,
    },
    ...over,
  };
}

function payload(over: Partial<InvestorBareMetal> = {}): InvestorBareMetal {
  return {
    servers: [server()],
    summary: {
      totalServers: 1,
      serversUnderContract: 1,
      serversOnline: 1,
      inServiceServers: 1,
      totalGpus: 8,
      regions: [{ id: 75, name: "ind-k8s-2", serverCount: 1 }],
    },
    revenue: {
      accruedWindowCents: 1_000_000,
      investorAccruedWindowCents: 700_000,
      collectedAllTimeCents: 9_000_000,
      investorCollectedAllTimeCents: 6_300_000,
      revenueSharePercent: 70,
    },
    revenueByRegion: [
      {
        regionId: 75,
        regionName: "ind-k8s-2",
        accruedWindowCents: 1_000_000,
        investorAccruedWindowCents: 700_000,
        collectedAllTimeCents: 9_000_000,
        investorCollectedAllTimeCents: 6_300_000,
      },
    ],
    unattributed: {
      count: 0,
      accruedWindowCents: 0,
      investorAccruedWindowCents: 0,
      collectedAllTimeCents: 0,
      investorCollectedAllTimeCents: 0,
      usage: [],
    },
    inventoryUnavailable: false,
    ...over,
  };
}

describe("BareMetalSection — absent cases", () => {
  it("renders nothing when the key is undefined (pre-PA-688 cache)", () => {
    const { container } = render(<BareMetalSection bareMetal={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when null (investor has no regions assigned)", () => {
    const { container } = render(<BareMetalSection bareMetal={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no inventory and no history", () => {
    const { container } = render(
      <BareMetalSection bareMetal={payload({ servers: [], revenueByRegion: [] })} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BareMetalSection — inventory unavailable", () => {
  it("says unavailable instead of showing zero servers", () => {
    render(
      <BareMetalSection
        bareMetal={payload({ servers: [], inventoryUnavailable: true, revenueByRegion: [] })}
      />
    );
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    // The dangerous failure mode: a confident "0 servers".
    expect(screen.queryByText(/0 servers/)).not.toBeInTheDocument();
  });
});

describe("BareMetalSection — revenue", () => {
  it("labels both bases and shows the investor's share of each (PA-736)", () => {
    render(<BareMetalSection bareMetal={payload()} periodLabel="August 2026" />);

    expect(screen.getByText("Earned August 2026")).toBeInTheDocument();
    expect(screen.getByText("Your share August 2026")).toBeInTheDocument();
    expect(screen.getByText("Collected all time")).toBeInTheDocument();
    expect(screen.getByText("Your share all time")).toBeInTheDocument();
    // Basis is stated, not implied.
    expect(screen.getByText("accrual basis")).toBeInTheDocument();
    expect(screen.getByText("cash received up front")).toBeInTheDocument();
    // Share values
    expect(screen.getAllByText("$7,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$63,000").length).toBeGreaterThan(0);
  });

  it("shows potential revenue and the realised percentage (AC 5)", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          revenue: {
            accruedWindowCents: 1_000_000,
            investorAccruedWindowCents: 700_000,
            collectedAllTimeCents: 9_000_000,
            investorCollectedAllTimeCents: 6_300_000,
            potentialWindowCents: 4_000_000,
            investorPotentialWindowCents: 2_800_000,
            utilizationPercent: 25,
            revenueSharePercent: 70,
          },
        })}
        periodLabel="August 2026"
      />
    );
    expect(screen.getByText("Potential August 2026")).toBeInTheDocument();
    expect(screen.getByText("$40,000")).toBeInTheDocument();
    expect(screen.getByText("25% realised")).toBeInTheDocument();
  });

  it("renders an em dash, NOT $0, when no catalogue rate exists", () => {
    // "No price on file" must never read as "this machine could earn nothing".
    render(
      <BareMetalSection
        bareMetal={payload({
          revenue: {
            accruedWindowCents: 0,
            investorAccruedWindowCents: 0,
            collectedAllTimeCents: 0,
            investorCollectedAllTimeCents: 0,
            potentialWindowCents: null,
            investorPotentialWindowCents: null,
            utilizationPercent: null,
            revenueSharePercent: 70,
          },
        })}
      />
    );
    // Em dashes now also appear in the Paid-on column, so the count alone proves
    // little. The load-bearing assertion is the hint: it renders ONLY when
    // potential is null, i.e. the tile above it is a dash rather than a $0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("no catalogue rate")).toBeInTheDocument();
  });

  it("explains each figure via an accessible ? tooltip", () => {
    // Prepaid bare metal makes "earned $61" and "collected $1,000" both true for
    // the same order, which reads as a bug without an explanation. The text lives
    // on the button's aria-label so it reaches screen readers, not just hover.
    render(<BareMetalSection bareMetal={payload()} periodLabel="August 2026" />);

    const tips = screen.getAllByRole("button", { name: /./ }).map((b) => b.getAttribute("aria-label") || "");
    const joined = tips.join(" ");

    // The accrual explanation must say the payment is spread across the term.
    expect(joined).toMatch(/prepaid for a fixed term/i);
    // The cash explanation must say why it's larger than earned.
    expect(joined).toMatch(/pay for the whole term up front/i);
    // Potential must explain it excludes days before a server joined the fleet.
    expect(joined).toMatch(/rented the whole time/i);
    // Power state vs rented must be disambiguated.
    expect(joined).toMatch(/separate from whether it's rented/i);
  });

  // The bubble must stay a popover: as a positioned child it was clipped away by
  // ServerCard's overflow-hidden and by every table's overflow-x-auto, so half the
  // tips never appeared. aria-hidden on it keeps the text from being read twice —
  // the trigger's aria-label is what screen readers get.
  it("renders each explanation in the top layer, announced once", () => {
    const { container } = render(<BareMetalSection bareMetal={payload()} />);
    const bubbles = Array.from(container.querySelectorAll("[popover]"));
    expect(bubbles.length).toBeGreaterThan(0);
    for (const bubble of bubbles) {
      // Phrasing content, because these tips sit inside <p> labels and table
      // cells. A <div> there is invalid HTML that the parser reshuffles, which
      // React reports as a hydration mismatch — and jsdom won't catch it for us.
      expect(bubble.tagName).toBe("SPAN");
      expect(bubble.getAttribute("aria-hidden")).toBe("true");
      const trigger = bubble.parentElement?.querySelector("button");
      expect(trigger?.getAttribute("aria-label")).toBe(bubble.textContent);
    }
  });

  it("defaults the period label rather than hardcoding a month", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    expect(screen.getByText("Earned this month")).toBeInTheDocument();
  });

  it("surfaces unattributed revenue instead of dropping it", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          unattributed: {
            count: 2,
            accruedWindowCents: 0,
            investorAccruedWindowCents: 0,
            collectedAllTimeCents: 4_000_000,
            investorCollectedAllTimeCents: 2_800_000,
            usage: [],
          },
        })}
      />
    );
    expect(screen.getByText(/2 earlier contracts/)).toBeInTheDocument();
    expect(screen.getByText(/no longer part of the live inventory/i)).toBeInTheDocument();
  });
});

describe("BareMetalSection — server detail", () => {
  it("shows specs, region, IP and total live time", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    expect(screen.getByText("bm-node-1")).toBeInTheDocument();
    expect(screen.getByText(/8 × B200/)).toBeInTheDocument();
    expect(screen.getByText(/224 cores/)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText(/62d live total/)).toBeInTheDocument();
  });

  it("shows under-contract and hardware power state as separate facts", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          servers: [server({ underContract: true, hardwareStatus: "Rebooting" })],
        })}
      />
    );
    // Earning while the box is mid-reboot — both true at once.
    expect(screen.getByText("Under contract")).toBeInTheDocument();
    expect(screen.getByText("Rebooting")).toBeInTheDocument();
  });

  it("marks an idle powered-on server as Idle, not live", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          servers: [
            server({ underContract: false, hardwareStatus: "Online", usage: [], timeline: [] }),
          ],
        })}
      />
    );
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByText("Under contract")).not.toBeInTheDocument();
  });

  it("lists each customer stint with period, duration and amount paid", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    expect(screen.getByText("customer-1")).toBeInTheDocument();
    expect(screen.getByText("customer-2")).toBeInTheDocument();
    expect(screen.getByText(/Jun 30, 2026 → ongoing/)).toBeInTheDocument();
    expect(screen.getByText("$30,000")).toBeInTheDocument();
  });

  it("shows the basis each customer bought on (AC: 'and on what basis')", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    expect(screen.getByText("1 mo prepaid")).toBeInTheDocument();
    expect(screen.getByText("3 mo prepaid")).toBeInTheDocument();
  });

  it("renders a dash for the basis on a pre-PA-688 cached usage row", () => {
    const p = payload();
    delete p.servers[0].usage[0].contractMonths;
    render(<BareMetalSection bareMetal={p} />);
    // Scoped to the table: an em dash also renders in the potential-revenue tile.
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(0);
    expect(screen.getByText("3 mo prepaid")).toBeInTheDocument();
  });

  it("sorts usage by customer, duration and paid (ticket AC)", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    const names = () => screen.getAllByText(/^customer-\d$/).map((el) => el.textContent);

    // Default is most-recent-first → customer-2 started later.
    expect(names()).toEqual(["customer-2", "customer-1"]);

    // Role-scoped: "Customer"/"Duration"/"Paid" are also table headers.
    fireEvent.click(screen.getByRole("button", { name: "Customer" }));
    expect(names()).toEqual(["customer-1", "customer-2"]);

    fireEvent.click(screen.getByRole("button", { name: "Duration" }));
    expect(names()).toEqual(["customer-2", "customer-1"]); // 1152h > 336h

    fireEvent.click(screen.getByRole("button", { name: "Paid" }));
    expect(names()).toEqual(["customer-2", "customer-1"]); // $60k > $30k
  });

  it("renders the live/offline history on the History tab", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    fireEvent.click(screen.getByText("Live history"));
    expect(screen.getAllByText("Live")).toHaveLength(2);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    // PA-746 §2: live history is to the minute, not date-only.
    expect(screen.getByText(/Jun 1, 2026.*→.*Jun 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Jun 1, 2026, \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("explains a never-sold server rather than showing an empty history", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          servers: [server({ usage: [], timeline: [], firstLiveAt: null, underContract: false })],
        })}
      />
    );
    expect(screen.getByText(/never sold/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Live history"));
    expect(screen.getByText(/has not been under contract yet/i)).toBeInTheDocument();
  });

  it("leaks no real customer identifier into the DOM", () => {
    const { container } = render(<BareMetalSection bareMetal={payload()} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/cus_/);
    expect(html).not.toMatch(/INV-BM/);
    expect(html).not.toMatch(/@/); // no emails
  });
});

describe("BareMetalSection — period filter (PA-736)", () => {
  // Two months with deliberately distinct figures, so a mis-wired selection
  // shows the wrong number rather than coincidentally matching.
  const JUL = month({
    month: "2026-07",
    accruedCents: 400_000,
    investorAccruedCents: 280_000,
    collectedCents: 9_000_000, // the whole prepaid term landed in July
    investorCollectedCents: 6_300_000,
    potentialCents: 800_000,
    investorPotentialCents: 560_000,
    utilizationPercent: 50,
    activeServers: 1,
    customers: 2,
  });
  const AUG = month({
    month: "2026-08",
    accruedCents: 100_000,
    investorAccruedCents: 70_000,
    collectedCents: 0, // …so August collects nothing while still earning
    investorCollectedCents: 0,
    potentialCents: 500_000,
    investorPotentialCents: 350_000,
    utilizationPercent: 20,
    activeServers: 1,
    customers: 1,
  });

  const withMonths = (over: Partial<InvestorBareMetal> = {}) =>
    payload({
      monthly: [JUL, AUG],
      servers: [server({ monthly: [JUL, AUG] })],
      ...over,
    });

  it("defaults to the most recent month, not all-time", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    expect(screen.getByLabelText("Period")).toHaveValue("2026-08");
    expect(screen.getByText("Earned Aug 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$1,000").length).toBeGreaterThan(0); // Aug accrued
  });

  it("re-reports every revenue figure when the period changes", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-07" } });

    expect(screen.getByText("Earned Jul 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$4,000").length).toBeGreaterThan(0); // Jul accrued
    expect(screen.getAllByText("$2,800").length).toBeGreaterThan(0); // Jul share
    expect(screen.getByText("50% realised")).toBeInTheDocument();
  });

  it("shows cash landing in one month and revenue earned in another", () => {
    // The whole point of two bases: July collected $90k and earned $4k; August
    // collected nothing yet still earned $1k.
    render(<BareMetalSection bareMetal={withMonths()} />);
    expect(screen.getByText("Collected Aug 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-07" } });
    expect(screen.getByText("Collected Jul 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$90,000").length).toBeGreaterThan(0);
  });

  it("keeps the lifetime total visible while a period is selected", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    // "lifetime", not "all time" — see the collision test below.
    expect(screen.getByText("Collected lifetime")).toBeInTheDocument();
    expect(screen.getByText(/your share \$63,000/)).toBeInTheDocument();
  });

  it("sums every month for the all-time selection", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "all" } });
    expect(screen.getByText("Earned all time")).toBeInTheDocument();
    expect(screen.getAllByText("$5,000").length).toBeGreaterThan(0); // 400k + 100k
    // Utilisation is recomputed from totals (500k/1.3M), not averaged across months.
    expect(screen.getByText("38.5% realised")).toBeInTheDocument();
  });

  // Selecting All time makes `label` the string "all time", so a static tile
  // labelled "Collected all time" collides with `Collected ${label}` — one heading
  // over two different figures, and a duplicate React key that orphans a fiber, so
  // a stale tile survives the next period change. React only warns, and nothing
  // here asserted on tile identity, so it passed 43/43 while visibly broken.
  it("keeps the lifetime tile distinct from the all-time period tile", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "all" } });

    expect(screen.getAllByText("Collected all time")).toHaveLength(1);
    expect(screen.getAllByText("Collected lifetime")).toHaveLength(1);

    // Switching away must not leave the orphaned tile behind.
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-07" } });
    expect(screen.queryAllByText("Collected all time")).toHaveLength(0);
    expect(screen.getAllByText("Collected lifetime")).toHaveLength(1);
    expect(screen.getAllByText("Collected Jul 2026")).toHaveLength(1);
  });

  it("renders the month-by-month table (PA-736 §2)", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    expect(screen.getByText(/Month by month/)).toBeInTheDocument();
    // Scoped to cells: the labels also appear as <option>s in the picker.
    expect(screen.getByRole("cell", { name: "Jul 2026" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Aug 2026" })).toBeInTheDocument();
  });

  it("filters to a month when its table row is clicked", () => {
    render(<BareMetalSection bareMetal={withMonths()} />);
    fireEvent.click(screen.getByRole("cell", { name: "Jul 2026" }));
    expect(screen.getByLabelText("Period")).toHaveValue("2026-07");
  });

  it("limits the customer list to stints overlapping the selected month", () => {
    // customer-1 ran 1–15 Jun only; customer-2 from 30 Jun and is still on.
    render(
      <BareMetalSection
        bareMetal={payload({
          monthly: [month({ month: "2026-06" }), JUL],
          servers: [server({ monthly: [month({ month: "2026-06" }), JUL] })],
        })}
      />
    );
    // July: only the open stint.
    expect(screen.queryByText("customer-1")).not.toBeInTheDocument();
    expect(screen.getByText("customer-2")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-06" } });
    expect(screen.getByText("customer-1")).toBeInTheDocument();
    expect(screen.getByText("customer-2")).toBeInTheDocument();
  });

  it("says which month had no customers rather than implying never", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          monthly: [month({ month: "2026-09" })],
          servers: [server({ monthly: [month({ month: "2026-09" })], usage: [] })],
        })}
      />
    );
    expect(screen.getByText(/No customer was on this server in Sep 2026/)).toBeInTheDocument();
  });

  it("makes region earnings follow the period, not stay on the current month", () => {
    render(
      <BareMetalSection
        bareMetal={withMonths({
          revenueByRegion: [
            {
              regionId: 75,
              regionName: "ind-k8s-2",
              accruedWindowCents: 1_000_000,
              investorAccruedWindowCents: 700_000,
              collectedAllTimeCents: 9_000_000,
              investorCollectedAllTimeCents: 6_300_000,
            },
            {
              regionId: 76,
              regionName: "usa-k8s-1",
              accruedWindowCents: 0,
              investorAccruedWindowCents: 0,
              collectedAllTimeCents: 0,
              investorCollectedAllTimeCents: 0,
            },
          ],
        })}
      />
    );
    // Region table only renders with >1 region; its Earned header tracks the label.
    expect(screen.getByText("Earned Aug 2026", { selector: "th" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-07" } });
    expect(screen.getByText("Earned Jul 2026", { selector: "th" })).toBeInTheDocument();
  });

  it("groups a customer's several stints into one row on request", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          monthly: [JUL],
          servers: [
            server({
              monthly: [JUL],
              usage: [
                {
                  customerId: "customer-1",
                  startedAt: "2026-07-01T00:00:00.000Z",
                  endedAt: "2026-07-10T00:00:00.000Z",
                  durationHours: 216,
                  paidCents: 1_000_000,
                  windowCents: 0,
                  status: "terminated",
                  contractMonths: 1,
                },
                {
                  customerId: "customer-1",
                  startedAt: "2026-07-20T00:00:00.000Z",
                  endedAt: "2026-07-25T00:00:00.000Z",
                  durationHours: 120,
                  paidCents: 500_000,
                  windowCents: 0,
                  status: "terminated",
                  contractMonths: 1,
                },
              ],
            }),
          ],
        })}
      />
    );
    // Ungrouped: two rows for the same customer.
    expect(screen.getAllByText("customer-1")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Group by customer"));
    expect(screen.getAllByText("customer-1")).toHaveLength(1);
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("$15,000")).toBeInTheDocument(); // 1M + 500k summed
    expect(screen.getByText(/Jul 1, 2026 → Jul 25, 2026/)).toBeInTheDocument();
  });

  it("hides the picker entirely for a pre-PA-736 payload", () => {
    render(<BareMetalSection bareMetal={payload()} periodLabel="August 2026" />);
    expect(screen.queryByLabelText("Period")).not.toBeInTheDocument();
    expect(screen.getByText("Earned August 2026")).toBeInTheDocument();
  });
});

describe("BareMetalSection — grouped status (workflow audit 2026-08-06)", () => {
  it("shows the LATEST stint's status for a returning customer", () => {
    // groupByCustomer merged duration, spend and span but not status, so a customer
    // whose old term ended and who is currently active read "terminated" beside an
    // open span.
    const JUL = month({ month: "2026-07", accruedCents: 1, investorAccruedCents: 1 });
    render(
      <BareMetalSection
        bareMetal={payload({
          monthly: [JUL],
          servers: [
            server({
              monthly: [JUL],
              usage: [
                {
                  customerId: "customer-1",
                  startedAt: "2026-07-01T00:00:00.000Z",
                  endedAt: "2026-07-10T00:00:00.000Z",
                  durationHours: 216,
                  paidCents: 1_000_000,
                  windowCents: 0,
                  status: "terminated",
                  contractMonths: 1,
                },
                {
                  customerId: "customer-1",
                  startedAt: "2026-07-20T00:00:00.000Z",
                  endedAt: null, // came back, still on
                  durationHours: 300,
                  paidCents: 500_000,
                  windowCents: 500_000,
                  status: "active",
                  contractMonths: 1,
                },
              ],
            }),
          ],
        })}
      />
    );
    fireEvent.click(screen.getByLabelText("Group by customer"));
    expect(screen.getByText(/Jul 1, 2026 → ongoing/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "active" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "terminated" })).not.toBeInTheDocument();
  });
});

describe("BareMetalSection — timeline pseudonyms (PA-746 §4)", () => {
  it("names the customer on each live stretch of the history", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    fireEvent.click(screen.getByText("Live history"));
    // Scoped to the history list: the same pseudonyms appear in the usage table.
    expect(screen.getAllByText("customer-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("customer-2").length).toBeGreaterThan(0);
  });

  it("shows no customer against an offline stretch", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          servers: [
            server({
              usage: [],
              timeline: [
                {
                  from: "2026-06-15T00:00:00.000Z",
                  to: null,
                  live: false,
                  customerIds: [],
                },
              ],
            }),
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText("Live history"));
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.queryByText(/^customer-/)).not.toBeInTheDocument();
  });

  it("survives a pre-PA-746 cached span with no customerIds", () => {
    render(
      <BareMetalSection
        bareMetal={payload({
          servers: [
            server({
              usage: [],
              timeline: [{ from: "2026-06-01T00:00:00.000Z", to: null, live: true }],
            }),
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText("Live history"));
    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});

describe("BareMetalSection — status filter", () => {
  /** Two servers with different statuses, one of them retired. */
  const mixed = () =>
    payload({
      servers: [
        server({ haiNodeId: 1, name: "bm-live", serviceStatus: "In service" }),
        server({
          haiNodeId: 2,
          name: "bm-old",
          serviceStatus: "In service",
          retired: true,
        }),
      ],
      summary: {
        totalServers: 2,
        serversUnderContract: 2,
        serversOnline: 2,
        inServiceServers: 1,
        totalGpus: 16,
        regions: [{ id: 75, name: "ind-k8s-2", serverCount: 2 }],
      },
    });

  it("is absent when every server shares one status", () => {
    render(<BareMetalSection bareMetal={payload()} />);
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("shows every server until a status is picked", () => {
    render(<BareMetalSection bareMetal={mixed()} />);
    expect(screen.getByLabelText("Status")).toHaveValue("__all");
    expect(screen.getByText("bm-live")).toBeInTheDocument();
    expect(screen.getByText("bm-old")).toBeInTheDocument();
  });

  it("isolates retired servers, which service_status alone could not", () => {
    render(<BareMetalSection bareMetal={mixed()} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "__retired" } });
    expect(screen.getByText("bm-old")).toBeInTheDocument();
    expect(screen.queryByText("bm-live")).not.toBeInTheDocument();
  });

  it("excludes a retired server from its own service_status bucket", () => {
    render(<BareMetalSection bareMetal={mixed()} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "In service" } });
    expect(screen.getByText("bm-live")).toBeInTheDocument();
    expect(screen.queryByText("bm-old")).not.toBeInTheDocument();
  });

  it("leaves the revenue figures portfolio-wide while filtered", () => {
    render(<BareMetalSection bareMetal={mixed()} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "__retired" } });
    // Filtering the card list must not restate the investor's money.
    expect(screen.getAllByText("$63,000").length).toBeGreaterThan(0);
    expect(screen.getByText(/Revenue above covers all of them/)).toBeInTheDocument();
  });
});

describe("BareMetalSection — live-total formatting", () => {
  it("rolls a rounded-up remainder into the day count", () => {
    // 215.6h: rounding the remainder alone gave "8d 24h" — a day that never
    // reached the day count.
    render(
      <BareMetalSection bareMetal={payload({ servers: [server({ totalLiveHours: 215.6 })] })} />
    );
    expect(screen.getByText(/9d live total/)).toBeInTheDocument();
    expect(screen.queryByText(/24h/)).not.toBeInTheDocument();
  });
});
