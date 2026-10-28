// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): BudgetSettings — spending-limit form. Loads
// current budget from GET /api/account/budget, saves via PUT, validates
// non-negative limits, and reveals the auto-shutdown threshold + warning when
// the toggle is on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BudgetSettings } from "@/app/dashboard/components/BudgetSettings";

const DEFAULT_BUDGET = {
  monthlyLimitCents: null,
  dailyLimitCents: null,
  alertAt50Percent: true,
  alertAt80Percent: true,
  alertAt100Percent: true,
  autoShutdownEnabled: false,
  autoShutdownThreshold: 100,
};

function stubFetch(handlers: { get?: unknown; put?: unknown; putOk?: boolean }) {
  const fetchMock = vi.fn((_url: string, opts?: { method?: string }) => {
    if (opts?.method === "PUT") {
      return Promise.resolve({ ok: handlers.putOk ?? true, json: async () => handlers.put });
    }
    return Promise.resolve({ ok: true, json: async () => handlers.get ?? DEFAULT_BUDGET });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("BudgetSettings", () => {
  it("fetches the budget on mount and shows the form", async () => {
    const fetchMock = stubFetch({ get: { ...DEFAULT_BUDGET, monthlyLimitCents: 50000 } });
    render(<BudgetSettings token="test-token" />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /budget controls/i })).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/budget",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } })
    );
    // monthlyLimitCents 50000 -> "$500" formatted as cents/100
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
  });

  it("renders the three alert checkboxes from the fetched state", async () => {
    stubFetch({ get: { ...DEFAULT_BUDGET, alertAt80Percent: false } });
    render(<BudgetSettings token="test-token" />);

    await waitFor(() => screen.getByText(/alert at 50%/i));
    const checkboxes = screen.getAllByRole("checkbox");
    // 50, 80, 100 alert checkboxes + auto-shutdown toggle = 4
    expect(checkboxes.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("checkbox", { name: /alert at 80%/i })).not.toBeChecked();
  });

  it("reveals the threshold select + warning when auto-shutdown is toggled on", async () => {
    stubFetch({ get: DEFAULT_BUDGET });
    render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByText(/auto-shutdown/i));

    expect(screen.queryByText(/shutdown at percentage/i)).not.toBeInTheDocument();
    // The auto-shutdown toggle is the only unlabelled checkbox (its wrapping
    // <label> has no text); the three alert checkboxes carry visible labels.
    const toggle = screen
      .getAllByRole("checkbox")
      .find((cb) => !cb.getAttribute("aria-label") && cb.classList.contains("peer"))!;
    fireEvent.click(toggle);

    expect(screen.getByText(/shutdown at percentage/i)).toBeInTheDocument();
    expect(screen.getByText(/auto-shutdown is enabled/i)).toBeInTheDocument();
  });

  it("PUTs the entered limits (converted to cents) on save", async () => {
    const fetchMock = stubFetch({ get: DEFAULT_BUDGET, put: { success: true, settings: DEFAULT_BUDGET } });
    render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /save budget settings/i }));

    const [monthly, daily] = screen.getAllByPlaceholderText(/no limit/i);
    fireEvent.change(monthly, { target: { value: "200" } });
    fireEvent.change(daily, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save budget settings/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    const sent = JSON.parse(putCall![1].body);
    expect(sent.monthlyLimitCents).toBe(20000);
    expect(sent.dailyLimitCents).toBe(1000);
  });

  it("sends null limits when the inputs are blank", async () => {
    const fetchMock = stubFetch({ get: DEFAULT_BUDGET, put: { success: true, settings: DEFAULT_BUDGET } });
    render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /save budget settings/i }));

    fireEvent.click(screen.getByRole("button", { name: /save budget settings/i }));
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
    });
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    const sent = JSON.parse(putCall![1].body);
    expect(sent.monthlyLimitCents).toBeNull();
    expect(sent.dailyLimitCents).toBeNull();
  });

  it("shows a success message after a successful save", async () => {
    stubFetch({ get: DEFAULT_BUDGET, put: { success: true, settings: DEFAULT_BUDGET } });
    render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /save budget settings/i }));

    fireEvent.click(screen.getByRole("button", { name: /save budget settings/i }));
    await waitFor(() => expect(screen.getByText(/budget settings saved/i)).toBeInTheDocument());
  });

  it("shows the server error when the save fails", async () => {
    stubFetch({ get: DEFAULT_BUDGET, put: { success: false, error: "limit too low" } });
    render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /save budget settings/i }));

    fireEvent.click(screen.getByRole("button", { name: /save budget settings/i }));
    await waitFor(() => expect(screen.getByText("limit too low")).toBeInTheDocument());
  });

  it("rejects a negative monthly limit client-side without PUTting", async () => {
    const fetchMock = stubFetch({ get: DEFAULT_BUDGET, put: { success: true, settings: DEFAULT_BUDGET } });
    const { container } = render(<BudgetSettings token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /save budget settings/i }));

    const [monthly] = screen.getAllByPlaceholderText(/no limit/i);
    fireEvent.change(monthly, { target: { value: "-5" } });
    // Submit the form directly: the negative value is a controlled-state edge
    // case the client-side guard rejects before any PUT.
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument());
    // only the initial GET happened; no PUT
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
  });
});
