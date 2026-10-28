// @vitest-environment jsdom
//
// PA-288: LaunchGPUModal (src/app/dashboard/components/LaunchGPUModal.tsx) —
// the 3-step GPU launch wizard. On open it GETs `/api/instances/launch-options`
// (categories, products, sshKeys, walletBalanceCents). Step 1 picks a GPU
// category (fires `/api/instances/category-check?categoryId=`), step 2 picks a
// compatible product + region, step 3 names the instance and launches via
// POST `/api/instances` (or a deployContext.onDeploy handler). A wallet-balance
// gate intercepts launch when the balance is below the 30-minute minimum.
//
// fetch is routed per-URL so the three endpoints can return tailored payloads.
// The dynamic `@/lib/plerdy` import is mocked so the analytics side-effect is a
// no-op. window.location.host is provided by jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/plerdy", () => ({
  trackPlerdy: vi.fn(),
  PLERDY_EVENTS: { GPU_DEPLOYED: "gpu_deployed" },
}));

import { LaunchGPUModal } from "@/app/dashboard/components/LaunchGPUModal";

// ── Fixtures ────────────────────────────────────────────────────────────────

const REGION = { id: 1, region_name: "us-nyc-1", city: "New York", country: "USA", country_code: "us" };

const PRODUCT = {
  id: "prod-a100",
  name: "A100",
  description: "Ampere",
  pricePerHourCents: 200,
  pricePerMonthCents: null,
  billingType: "hourly",
  stripePriceId: null,
  serviceId: "svc-a100",
  displayOrder: 0,
  active: true,
  featured: true,
  badgeText: null,
  vramGb: 80,
  cudaCores: null,
  categoryIds: ["cat-data"],
  gpuFamily: "Data Center",
  available: null,
};

const CATEGORY = {
  id: "cat-data",
  name: "Data Center",
  slug: "data-center",
  description: "Datacenter GPUs",
  displayOrder: 0,
  icon: null,
  scenarioConfigured: true,
  products: [PRODUCT],
};

function launchOptions(over: Record<string, unknown> = {}) {
  return {
    categories: [CATEGORY],
    products: [PRODUCT],
    existingSharedVolumes: [],
    sshKeys: [],
    teamId: "team-1",
    walletBalanceCents: 100000, // plenty
    ...over,
  };
}

/** Route fetch by URL substring; default 200 {}. */
function routeFetch(handlers: Record<string, () => unknown>, opts: { launchOk?: boolean; launchBody?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/api/instances/launch-options")) {
      return Promise.resolve({ ok: true, json: async () => (handlers.launchOptions?.() ?? launchOptions()) });
    }
    if (url.includes("/api/instances/category-check")) {
      return Promise.resolve({ ok: true, json: async () => (handlers.categoryCheck?.() ?? { categoryId: "cat-data", compatibleServiceIds: ["svc-a100"], serviceRegions: { "svc-a100": [REGION] } }) });
    }
    if (url.includes("/api/instances/shared-volumes/storage-blocks")) {
      return Promise.resolve({ ok: true, json: async () => (handlers.storageBlocks?.() ?? { blocks: [] }) });
    }
    if (url.includes("/api/instances") && init?.method === "POST") {
      return Promise.resolve({ ok: opts.launchOk ?? true, json: async () => (opts.launchBody ?? {}) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Open modal, wait for options load, pick the category, wait for the product. */
async function openToProductStep(fetchMock: ReturnType<typeof routeFetch>, props: Record<string, unknown> = {}) {
  render(
    <LaunchGPUModal
      isOpen
      onClose={props.onClose as () => void ?? (() => {})}
      token="tok"
      onSuccess={(props.onSuccess as never) ?? (() => {})}
      onError={props.onError as never}
      {...props}
    />,
  );
  await waitFor(() => expect(screen.getByText("Select GPU Type")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
  await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("category-check"))).toBe(true));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("LaunchGPUModal — visibility + load", () => {
  it("renders nothing when closed", () => {
    routeFetch({});
    const { container } = render(
      <LaunchGPUModal isOpen={false} onClose={() => {}} token="t" onSuccess={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fetches launch-options on open and lands on step 1 (GPU Type)", async () => {
    const fetchMock = routeFetch({});
    render(<LaunchGPUModal isOpen onClose={() => {}} token="tok" onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByText("Select GPU Type")).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/instances/launch-options");
    expect(screen.getByText("New GPU")).toBeInTheDocument();
  });

  it("shows a custom deploy-context title when provided", async () => {
    routeFetch({});
    render(
      <LaunchGPUModal
        isOpen
        onClose={() => {}}
        token="t"
        onSuccess={() => {}}
        deployContext={{ type: "huggingface", title: "Deploy Mistral 7B", modelId: "mistralai/Mistral-7B", onDeploy: async () => {} }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Deploy Mistral 7B")).toBeInTheDocument());
  });

  it("renders an inline error when launch-options fails", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("launch-options")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "boom loading" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LaunchGPUModal isOpen onClose={() => {}} token="t" onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByText("boom loading")).toBeInTheDocument());
  });
});

describe("LaunchGPUModal — wizard navigation", () => {
  it("advances category → product (with region) and exposes the Continue button", async () => {
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock);
    await waitFor(() => expect(screen.getByText("Select a GPU")).toBeInTheDocument());
    // Region auto-selected → "Continue to Configuration" appears.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Continue to Configuration/ })).toBeInTheDocument(),
    );
  });

  it("reaches step 3 and renders the instance Name field", async () => {
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock);
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));
    expect(await screen.findByPlaceholderText("e.g. my-gpu-workspace")).toBeInTheDocument();
  });

  it("Back from step 2 returns to step 1 (GPU Type)", async () => {
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock);
    await waitFor(() => screen.getByText("Select a GPU"));
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    await waitFor(() => expect(screen.getByText("Select GPU Type")).toBeInTheDocument());
  });
});

describe("LaunchGPUModal — launch", () => {
  it("POSTs /api/instances with the assembled payload and calls onSuccess + onClose", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock, { onSuccess, onClose });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "my-run" } });

    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/instances") && (c[1] as RequestInit)?.method === "POST");
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/instances") && (c[1] as RequestInit)?.method === "POST")!;
    const sent = JSON.parse((post[1] as RequestInit).body as string);
    expect(sent.name).toBe("my-run");
    expect(sent.product_id).toBe("prod-a100");
    expect(sent.region_id).toBe(1);

    // Optimistic close + success callback.
    expect(onSuccess).toHaveBeenCalledWith({ name: "my-run", poolName: "A100" });
    expect(onClose).toHaveBeenCalled();
  });

  it("routes the launch through a deployContext.onDeploy handler instead of POST /api/instances", async () => {
    const onDeploy = vi.fn().mockResolvedValue(undefined);
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock, {
      deployContext: { type: "huggingface", title: "Deploy X", modelId: "org/model-x", onDeploy },
    });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    // deployContext pre-fills the instance name from the modelId.
    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    expect((nameInput as HTMLInputElement).value).toBe("model-x");

    fireEvent.click(screen.getByRole("button", { name: /Deploy/ }));
    await waitFor(() => expect(onDeploy).toHaveBeenCalled());
    expect(onDeploy.mock.calls[0][0]).toMatchObject({ product_id: "prod-a100", region_id: 1, name: "model-x" });
    // No direct POST /api/instances when a deploy handler is supplied.
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/instances") && (c[1] as RequestInit)?.method === "POST");
    expect(post).toBeUndefined();
  });

  it("opens the Fund-Your-Wallet gate instead of launching when the balance is below the minimum", async () => {
    const onSuccess = vi.fn();
    const fetchMock = routeFetch({ launchOptions: () => launchOptions({ walletBalanceCents: 0 }) });
    await openToProductStep(fetchMock, { onSuccess });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "broke-run" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() => expect(screen.getByText("Fund Your Wallet")).toBeInTheDocument());
    // Launch was gated — onSuccess never fired.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("reports launch failures via onError when POST /api/instances is not ok", async () => {
    const onError = vi.fn();
    const fetchMock = routeFetch({}, { launchOk: false, launchBody: { error: "no capacity" } });
    await openToProductStep(fetchMock, { onError });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));
    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "run" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("no capacity"));
  });
});

describe("LaunchGPUModal — cancel", () => {
  it("calls onClose from the step-1 Cancel button", async () => {
    const onClose = vi.fn();
    routeFetch({});
    render(<LaunchGPUModal isOpen onClose={onClose} token="t" onSuccess={() => {}} />);
    await waitFor(() => screen.getByText("Select GPU Type"));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LaunchGPUModal — PA-358 monthly-product auto-select regression", () => {
  // Monthly-billed products never get a visible card in the on-demand list
  // (filteredProducts excludes billingType === "monthly" — they're only
  // reachable via the locked "Deploy GPU" flow off a subscription). If the
  // category's first compatible product by displayOrder happens to be a
  // monthly one, auto-selecting it left selectedProduct pointing at a
  // product with no rendered card, so its own (possibly HAI-incompatible)
  // regions rendered with nothing shown as selected.
  const REGION_MONTHLY = { id: 10, region_name: "eu-ams-1", city: "Amsterdam", country: "Netherlands", country_code: "nl" };
  const REGION_HOURLY = { id: 20, region_name: "us-nyc-1", city: "New York", country: "USA", country_code: "us" };

  const MONTHLY_PRODUCT = {
    ...PRODUCT,
    id: "prod-monthly",
    name: "A100 Monthly",
    billingType: "monthly",
    serviceId: "svc-monthly",
    displayOrder: 0,
  };
  const HOURLY_PRODUCT = {
    ...PRODUCT,
    id: "prod-hourly",
    name: "A100 Hourly",
    billingType: "hourly",
    serviceId: "svc-hourly",
    displayOrder: 1,
  };
  const MIXED_CATEGORY = { ...CATEGORY, products: [MONTHLY_PRODUCT, HOURLY_PRODUCT] };

  it("never auto-selects an invisible monthly product ahead of the visible hourly one", async () => {
    const fetchMock = routeFetch({
      launchOptions: () => launchOptions({ categories: [MIXED_CATEGORY], products: [MONTHLY_PRODUCT, HOURLY_PRODUCT] }),
      categoryCheck: () => ({
        categoryId: "cat-data",
        compatibleServiceIds: ["svc-monthly", "svc-hourly"],
        serviceRegions: { "svc-monthly": [REGION_MONTHLY], "svc-hourly": [REGION_HOURLY] },
      }),
    });
    await openToProductStep(fetchMock);
    await waitFor(() => expect(screen.getByText("Select a GPU")).toBeInTheDocument());

    // Monthly product is never shown as a card; the hourly one is.
    expect(screen.queryByText("A100 Monthly")).not.toBeInTheDocument();
    expect(screen.getByText("A100 Hourly")).toBeInTheDocument();

    // The auto-selected product (and therefore the rendered region list)
    // must be the visible hourly product — never the invisible monthly
    // product's own, differently-compatible regions.
    await waitFor(() => expect(screen.getByText(REGION_HOURLY.city)).toBeInTheDocument());
    expect(screen.queryByText(REGION_MONTHLY.city)).not.toBeInTheDocument();
  });
});

describe("LaunchGPUModal — PA-456 initialCategorySlug case-insensitive match", () => {
  // A CTA (e.g. the dashboard B200 banner) passes a hardcoded lowercase slug.
  // If the category's slug in the DB differs only in case/whitespace (an
  // admin typo, or a manually-edited slug field), the exact-match lookup used
  // to silently fail and fall through to the step-1 category picker — the
  // exact "must select the GPU type again" bug this regression guards.
  it("skips step 1 and lands on the product step even when the slug casing differs", async () => {
    routeFetch({});
    render(
      <LaunchGPUModal
        isOpen
        onClose={() => {}}
        token="tok"
        onSuccess={() => {}}
        initialCategorySlug="DATA-CENTER"
      />,
    );
    await waitFor(() => expect(screen.getByText("Select a GPU")).toBeInTheDocument());
    expect(screen.queryByText("Select GPU Type")).not.toBeInTheDocument();
  });
});

describe("LaunchGPUModal — PA-356 shared storage step", () => {
  // Rootfs persistence is on for every provision (createInstance), and a shared
  // volume is billed on top of the GPU — the configure step has to say both.
  // Block cost arrives as $/hr already derived from our own storage rate
  // (getSharedStorageBlocks), so the estimate is GPU + block.
  const BLOCKS = { blocks: [{ id: "blk-50", name: "Block-50", size: 50, cost: 0.01 }] };

  async function toConfigureStep(handlers: Record<string, () => unknown> = {}) {
    const fetchMock = routeFetch(handlers);
    await openToProductStep(fetchMock);
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));
    await screen.findByPlaceholderText("e.g. my-gpu-workspace");
  }

  it("tells the user the root disk is persistent across reboots", async () => {
    await toConfigureStep();
    expect(screen.getByText(/Your root disk is persistent/)).toBeInTheDocument();
    expect(screen.getByText(/survives a reboot/)).toBeInTheDocument();
  });

  it("adds the shared volume's hourly price to the estimate once one is created", async () => {
    await toConfigureStep({ storageBlocks: () => BLOCKS });

    // Default is "None" — GPU only ($2.00/hr), no storage line.
    expect(screen.getByText(/^\$2\.00\/hr$/)).toBeInTheDocument();
    expect(screen.queryByText(/\+ storage/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Create new volume/ }));

    // 50GB block at $0.01/hr on top of the $2.00/hr GPU, broken out.
    await waitFor(() => expect(screen.getByText(/^\$2\.01\/hr$/)).toBeInTheDocument());
    expect(screen.getByText("GPU $2.00 + storage $0.01")).toBeInTheDocument();
  });
});

// The reported defect: a customer topped up while this modal was open, the
// dashboard behind it showed the new balance, and the modal kept showing the
// pre-payment figure — so its own funding gate still blocked the launch.
describe("LaunchGPUModal — wallet balance freshness", () => {
  it("re-reads the balance when the tab regains focus", async () => {
    let balance = 27;
    const fetchMock = routeFetch({ launchOptions: () => launchOptions({ walletBalanceCents: balance }) });
    render(<LaunchGPUModal isOpen onClose={() => {}} token="tok" onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByText("Select GPU Type")).toBeInTheDocument());

    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes("launch-options")).length;
    balance = 2527; // the top-up lands in Stripe while the modal sits open
    fireEvent.focus(window);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes("launch-options")).length,
      ).toBeGreaterThan(before),
    );
  });

  it("re-reads the balance at the gate, so a credit applied mid-session launches", async () => {
    let balance = 0;
    const onSuccess = vi.fn();
    const fetchMock = routeFetch({ launchOptions: () => launchOptions({ walletBalanceCents: balance }) });
    await openToProductStep(fetchMock, { onSuccess });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "voucher-run" } });

    // The voucher credit lands in Stripe with the modal open and this tab in
    // the foreground — no visibilitychange, so nothing else refreshes it.
    balance = 10000;
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByText("Fund Your Wallet")).not.toBeInTheDocument();
  });

  it("still gates when the re-read confirms the wallet is short", async () => {
    const onSuccess = vi.fn();
    const fetchMock = routeFetch({ launchOptions: () => launchOptions({ walletBalanceCents: 0 }) });
    await openToProductStep(fetchMock, { onSuccess });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "broke-run" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() => expect(screen.getByText("Fund Your Wallet")).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not re-read while the modal is closed", async () => {
    const fetchMock = routeFetch({});
    render(<LaunchGPUModal isOpen={false} onClose={() => {}} token="tok" onSuccess={() => {}} />);
    fireEvent.focus(window);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("launch-options"))).toHaveLength(0);
  });
});

/* A monthly subscription pays for its own deploy, so a wallet with nothing in
   it must never stop one — and a subscription whose product row cannot be
   found is a linking fault, not a billing one. */
describe("LaunchGPUModal — a subscription-funded deploy", () => {
  const MONTHLY = {
    ...PRODUCT,
    id: "prod-blackwell-monthly",
    name: "RTX PRO 6000 Blackwell",
    billingType: "monthly",
    pricePerMonthCents: 190000,
    stripePriceId: "price_live_blackwell",
  };

  it("launches on an overdrawn wallet when the subscription is the funder", async () => {
    const onSuccess = vi.fn();
    const fetchMock = routeFetch({
      launchOptions: () => launchOptions({ products: [MONTHLY], walletBalanceCents: -19 }),
    });
    render(
      <LaunchGPUModal
        isOpen
        onClose={() => {}}
        token="tok"
        onSuccess={onSuccess}
        lockedProductId="prod-blackwell-monthly"
        stripeSubscriptionId="sub_live_123"
      />,
    );

    // A locked product skips the type step and preselects product + region.
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "blackwell-run" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(
        (c) => String(c[0]).includes("/api/instances") && (c[1] as RequestInit)?.method === "POST",
      )).toBe(true),
    );
    // The wallet gate never intercepted: no top-up screen, and the deploy went out.
    expect(screen.queryByText("Fund Your Wallet")).not.toBeInTheDocument();
  });

  it("says the subscription is unmatched rather than asking for money", async () => {
    routeFetch({
      // The product row's Stripe link is broken, so launch-options omits it.
      launchOptions: () => launchOptions({ products: [PRODUCT], walletBalanceCents: -19 }),
    });
    render(
      <LaunchGPUModal
        isOpen
        onClose={() => {}}
        token="tok"
        onSuccess={() => {}}
        stripeSubscriptionId="sub_live_123"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/can.t match your subscription to a GPU/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/not a\s+billing problem/i)).toBeInTheDocument();
    expect(screen.getByText("sub_live_123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Funds/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deploy|Launch/i })).not.toBeInTheDocument();
  });

  /* A mislinked row can point a subscription at an hourly product. The pass
     still paid, so the wallet must not be consulted for it either. */
  it("launches when the subscription's linked product is an hourly row", async () => {
    const fetchMock = routeFetch({
      launchOptions: () => launchOptions({ walletBalanceCents: -19 }),
    });
    render(
      <LaunchGPUModal
        isOpen
        onClose={() => {}}
        token="tok"
        onSuccess={() => {}}
        lockedProductId="prod-a100"
        stripeSubscriptionId="sub_live_123"
      />,
    );

    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));
    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "mislinked-run" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(
        (c) => String(c[0]).includes("/api/instances") && (c[1] as RequestInit)?.method === "POST",
      )).toBe(true),
    );
    expect(screen.queryByText("Fund Your Wallet")).not.toBeInTheDocument();
  });

  it("still gates an on-demand launch with no subscription behind it", async () => {
    const fetchMock = routeFetch({
      launchOptions: () => launchOptions({ walletBalanceCents: -19 }),
    });
    await openToProductStep(fetchMock);

    expect(screen.queryByText(/can.t match your subscription/i)).not.toBeInTheDocument();
  });
});

// A disabled launch button used to say nothing about why. The most common
// cause is an empty Name, whose placeholder reads as a filled-in value.
describe("LaunchGPUModal — the disabled launch button says why", () => {
  async function toConfigureStep() {
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock);
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));
    return { fetchMock, nameInput: await screen.findByPlaceholderText("e.g. my-gpu-workspace") };
  }

  it("names the empty Name field and keeps the button disabled", async () => {
    await toConfigureStep();

    const launch = screen.getByRole("button", { name: /Launch GPU/ });
    expect(launch).toBeDisabled();
    expect(screen.getByTestId("launch-blocker")).toHaveTextContent(
      "Name this GPU to continue — the Name field above is empty.",
    );
    expect(launch).toHaveAttribute("aria-describedby", "launch-blocker");
  });

  it("marks the Name field required and stops the placeholder reading as a value", async () => {
    const { nameInput } = await toConfigureStep();
    expect(nameInput).toBeRequired();
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it("clears the message and enables the button once a name is typed", async () => {
    const { nameInput } = await toConfigureStep();
    fireEvent.change(nameInput, { target: { value: "my-box" } });

    await waitFor(() => expect(screen.queryByTestId("launch-blocker")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Launch GPU/ })).toBeEnabled();
  });

  it("shows the in-flight launch as progress, not as an error", async () => {
    const { fetchMock, nameInput } = await toConfigureStep();
    fireEvent.change(nameInput, { target: { value: "my-box" } });
    await waitFor(() => expect(screen.queryByTestId("launch-blocker")).not.toBeInTheDocument());

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Promise(() => {}) : fetchMock(url, init),
    ));
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));

    await waitFor(() =>
      expect(screen.getByTestId("launch-blocker")).toHaveTextContent("Starting your GPU…"),
    );
    expect(screen.getByTestId("launch-blocker").className).not.toMatch(/red/);
  });

  it("says nothing about the launch button while still on an earlier step", async () => {
    const fetchMock = routeFetch({});
    await openToProductStep(fetchMock);
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    expect(screen.queryByTestId("launch-blocker")).not.toBeInTheDocument();
  });
});

describe("LaunchGPUModal — wallet gate", () => {
  async function toFundWallet(onTopup: ReturnType<typeof vi.fn>) {
    const fetchMock = routeFetch({ launchOptions: () => launchOptions({ walletBalanceCents: 10 }) });
    await openToProductStep(fetchMock, { onTopup });
    await waitFor(() => screen.getByRole("button", { name: /Continue to Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to Configuration/ }));

    const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
    fireEvent.change(nameInput, { target: { value: "my-box" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch GPU/ }));
    await waitFor(() => expect(screen.getByText("Fund Your Wallet")).toBeInTheDocument());
  }

  it("invokes the top-up handler with the tile amount in cents", async () => {
    const onTopup = vi.fn().mockResolvedValue(true);
    await toFundWallet(onTopup);

    fireEvent.click(screen.getByRole("button", { name: "$100" }));

    await waitFor(() => expect(onTopup).toHaveBeenCalledWith(10000, undefined, "prod-a100"));
  });

  it("holds the checkout-started event back until a session is created", async () => {
    const onTopup = vi.fn().mockResolvedValue(false);
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    await toFundWallet(onTopup);

    fireEvent.click(screen.getByRole("button", { name: "$50" }));

    await waitFor(() => expect(onTopup).toHaveBeenCalledWith(5000, undefined, "prod-a100"));
    expect(gtag.mock.calls.some((c) => c[1] === "on_demand_checkout_started")).toBe(false);
  });
});
