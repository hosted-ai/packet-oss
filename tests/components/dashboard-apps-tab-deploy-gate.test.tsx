// @vitest-environment jsdom
//
// AppsTab "Deploy on New GPU" runs through the real LaunchGPUModal, so the
// 30-minute prepaid minimum gates the app deploy exactly as it gates a plain
// GPU launch. These specs drive the tab end to end with the modal unmocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/plerdy", () => ({
  trackPlerdy: vi.fn(),
  PLERDY_EVENTS: { GPU_DEPLOYED: "gpu_deployed" },
}));

import { AppsTab } from "@/app/dashboard/components/AppsTab";

const REGION = { id: 1, region_name: "us-nyc-1", city: "New York", country: "USA", country_code: "us" };

// $2.00/hr, so the 30-minute minimum is $1.00.
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

const APP = {
  slug: "jupyter",
  id: "app-jupyter",
  name: "Jupyter Lab",
  description: "Notebook IDE",
  category: "development",
  minVramGb: 8,
  recommendedVramGb: 16,
  estimatedInstallMin: 3,
  icon: "N",
  tags: [],
  deployable: true,
  canDeploy: true,
  serviceId: "svc-a100",
};

function stubFetch(walletBalanceCents: number) {
  const fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("/api/instances/launch-options")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          categories: [CATEGORY],
          products: [PRODUCT],
          existingSharedVolumes: [],
          sshKeys: [],
          teamId: "team-1",
          walletBalanceCents,
        }),
      });
    }
    if (u.includes("/api/instances/category-check")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          categoryId: "cat-data",
          compatibleServiceIds: ["svc-a100"],
          serviceRegions: { "svc-a100": [REGION] },
        }),
      });
    }
    if (u.includes("/api/apps/deploy")) {
      return Promise.resolve({ ok: true, json: async () => ({ name: "pod-1" }) });
    }
    if (u.startsWith("/api/apps/status")) {
      return Promise.resolve({ ok: true, text: async () => JSON.stringify({ apps: [] }), json: async () => ({ apps: [] }) });
    }
    if (u === "/api/apps") {
      return Promise.resolve({ ok: true, json: async () => ({ apps: [APP] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Open the deploy modal, pick the GPU, and land on the naming step. */
async function openToDeployStep(fetchMock: ReturnType<typeof stubFetch>) {
  render(<AppsTab token="tok" subscriptions={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Deploy on New GPU/ }));
  await waitFor(() => expect(screen.getByText("Select GPU Type")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("category-check"))).toBe(true),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Continue to Configuration/ }));
  const nameInput = await screen.findByPlaceholderText("e.g. my-gpu-workspace");
  fireEvent.change(nameInput, { target: { value: "jupyter-box" } });
}

function deployCall(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.find(
    (c) => String(c[0]).includes("/api/apps/deploy") && (c[1] as RequestInit)?.method === "POST",
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("AppsTab deploy — wallet gate", () => {
  it("blocks the deploy and shows the real minimum when the balance is below it", async () => {
    const fetchMock = stubFetch(50);
    await openToDeployStep(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /^Deploy$/ }));

    await waitFor(() => expect(screen.getByText("Fund Your Wallet")).toBeInTheDocument());
    expect(screen.getByText("$1.00")).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(deployCall(fetchMock)).toBeUndefined();
  });

  it("sends the deploy when the balance covers the minimum", async () => {
    const fetchMock = stubFetch(100000);
    await openToDeployStep(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /^Deploy$/ }));

    await waitFor(() => expect(deployCall(fetchMock)).toBeTruthy());
    expect(screen.queryByText("Fund Your Wallet")).not.toBeInTheDocument();
    expect(JSON.parse(String((deployCall(fetchMock)![1] as RequestInit).body))).toMatchObject({
      appId: "app-jupyter",
      product_id: "prod-a100",
      region_id: 1,
    });
  });
});
