// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — DripTab.
// Self-fetches /api/admin/drip, renders sequences with steps + stats, and POSTs
// {action: seed|toggle|update-step}.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DripTab } from "@/app/admin/components/DripTab";

type Json = Record<string, unknown>;

let sequences: Json[] = [];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/drip" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: sequences }) });
    }
    // POST mutations (seed returns a message)
    return Promise.resolve({ ok: true, json: async () => ({ success: true, message: "Seeded default sequence" }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleSequence = (over: Json = {}): Json => ({
  id: "seq-1",
  slug: "free-signup",
  name: "Free Signup Onboarding",
  description: "4 emails over 14 days",
  trigger: "signup",
  active: true,
  steps: [
    { id: "step-1", stepOrder: 1, delayHours: 24, templateSlug: "drip-day1-api", active: true },
    { id: "step-2", stepOrder: 2, delayHours: 72, templateSlug: "drip-day3-explore", active: false },
  ],
  stats: { active: 5, completed: 10, cancelled: 2, total: 17 },
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  sequences = [];
});

describe("DripTab", () => {
  it("shows a loading spinner before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<DripTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the empty state when there are no sequences", async () => {
    makeFetch();
    render(<DripTab />);
    expect(await screen.findByText(/no drip sequences yet/i)).toBeInTheDocument();
  });

  it("fetches sequences on mount", async () => {
    const fetchMock = makeFetch();
    render(<DripTab />);
    await screen.findByText(/no drip sequences yet/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/drip");
  });

  it("renders a sequence with its name, trigger, and stats", async () => {
    sequences = [sampleSequence()];
    makeFetch();
    render(<DripTab />);
    expect(await screen.findByText("Free Signup Onboarding")).toBeInTheDocument();
    expect(screen.getByText(/trigger: signup/i)).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument(); // total enrolled
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders each step with its template slug and formatted delay", async () => {
    sequences = [sampleSequence()];
    makeFetch();
    render(<DripTab />);
    await screen.findByText("Free Signup Onboarding");
    expect(screen.getByText("drip-day1-api")).toBeInTheDocument();
    expect(screen.getByText("drip-day3-explore")).toBeInTheDocument();
    // The delay label sits in a <p> alongside a Clock icon, so the text is
    // broken across nodes; assert via the document's normalized text content.
    // formatDelay(24) => "1d" (24 is not < 24); formatDelay(72) => "3d".
    const normalizedBody = (document.body.textContent || "").replace(/\s+/g, " ");
    expect(normalizedBody).toMatch(/1d after signup/i);
    expect(normalizedBody).toMatch(/3d after step 1/i);
  });

  it("formats sub-day delays in hours (formatDelay < 24)", async () => {
    sequences = [
      sampleSequence({
        steps: [{ id: "s0", stepOrder: 1, delayHours: 6, templateSlug: "instant-ping", active: true }],
      }),
    ];
    makeFetch();
    render(<DripTab />);
    await screen.findByText("Free Signup Onboarding");
    const normalizedBody = (document.body.textContent || "").replace(/\s+/g, " ");
    expect(normalizedBody).toMatch(/6h after signup/i);
  });

  it("POSTs action=seed when the empty-state create button is clicked", async () => {
    const fetchMock = makeFetch();
    render(<DripTab />);
    await screen.findByText(/no drip sequences yet/i);

    // Two "Create Default Sequence" buttons exist (header + empty state); click the first.
    fireEvent.click(screen.getAllByRole("button", { name: /create default sequence/i })[0]);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "seed"
      );
      expect(call).toBeTruthy();
    });
  });

  it("shows the seed result message after a successful seed", async () => {
    const fetchMock = makeFetch();
    render(<DripTab />);
    await screen.findByText(/no drip sequences yet/i);
    fireEvent.click(screen.getAllByRole("button", { name: /create default sequence/i })[0]);
    expect(await screen.findByText(/seeded default sequence/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("POSTs action=toggle with inverted active when pausing a sequence", async () => {
    sequences = [sampleSequence({ active: true })];
    const fetchMock = makeFetch();
    render(<DripTab />);
    await screen.findByText("Free Signup Onboarding");

    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "toggle"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.sequenceId).toBe("seq-1");
      expect(body.active).toBe(false);
    });
  });

  it("POSTs action=update-step when toggling a step", async () => {
    sequences = [sampleSequence()];
    const fetchMock = makeFetch();
    render(<DripTab />);
    await screen.findByText("Free Signup Onboarding");

    // step-1 active => "Disable"; step-2 inactive => "Enable"
    fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "update-step"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.stepId).toBe("step-1");
      expect(body.active).toBe(false);
    });
  });

  it("renders a paused sequence with an Activate action", async () => {
    sequences = [sampleSequence({ active: false })];
    makeFetch();
    render(<DripTab />);
    await screen.findByText("Free Signup Onboarding");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument();
  });
});
