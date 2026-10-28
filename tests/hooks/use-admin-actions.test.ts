// @vitest-environment jsdom
//
// PA-320 coverage deepening for useAdminActions (src/app/admin/hooks/useAdminActions.ts).
//
// This hook is a bag of admin mutation handlers — each fires a fetch to an
// /api/admin/* endpoint and reflects success/failure via window.confirm/alert/
// prompt/open (which jsdom doesn't implement, so we stub them). We drive a
// mocked fetch + a loadData spy and pin, per action: the exact URL + method +
// body, the confirm-gate short-circuit, and the success vs error UX
// (loadData called / alert shown). Validation paths (NaN credit amount,
// out-of-range pricing) are pinned too.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAdminActions } from "@/app/admin/hooks/useAdminActions";

const loadData = vi.fn().mockResolvedValue(undefined);

let confirmSpy: ReturnType<typeof vi.fn>;
let alertSpy: ReturnType<typeof vi.fn>;
let promptSpy: ReturnType<typeof vi.fn>;
let openSpy: ReturnType<typeof vi.fn>;

function okFetch(body: unknown = { success: true, message: "done" }, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

/** A FormEvent-ish stub with a spyable preventDefault. */
function formEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  confirmSpy = vi.fn().mockReturnValue(true);
  alertSpy = vi.fn();
  promptSpy = vi.fn();
  openSpy = vi.fn();
  vi.stubGlobal("confirm", confirmSpy);
  vi.stubGlobal("alert", alertSpy);
  vi.stubGlobal("prompt", promptSpy);
  // window.open
  vi.stubGlobal("open", openSpy);
});

describe("useAdminActions — handleCustomerAction", () => {
  it("does nothing when the confirm dialog is dismissed", async () => {
    confirmSpy.mockReturnValue(false);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleCustomerAction("cust-1", "suspend");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadData).not.toHaveBeenCalled();
  });

  it("POSTs the action and reloads data on success", async () => {
    const fetchMock = okFetch({ message: "Suspended" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleCustomerAction("cust-1", "suspend");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/customers/cust-1",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "suspend" }) })
    );
    expect(alertSpy).toHaveBeenCalledWith("Suspended");
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it("alerts the error and does NOT reload when the action fails", async () => {
    const fetchMock = okFetch({ error: "nope" }, false, 400);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleCustomerAction("cust-1", "suspend");
    });

    expect(alertSpy).toHaveBeenCalledWith("nope");
    expect(loadData).not.toHaveBeenCalled();
  });
});

describe("useAdminActions — login-as / hosted.ai login", () => {
  it("opens the login-as URL in a new tab on success", async () => {
    const fetchMock = okFetch({ url: "https://login/as" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleLoginAs("cust-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/customers/cust-1",
      expect.objectContaining({ body: JSON.stringify({ action: "login-as" }) })
    );
    expect(openSpy).toHaveBeenCalledWith("https://login/as", "_blank");
  });

  it("alerts when the hosted.ai login link cannot be generated", async () => {
    const fetchMock = okFetch({ error: "no link" }, false, 500);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleHostedAiLogin("cust-1");
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("no link");
  });
});

describe("useAdminActions — handleDeleteCustomer", () => {
  const customer = { id: "cust-1", email: "del@x.com" } as never;

  it("aborts when the typed confirmation email does not match", async () => {
    promptSpy.mockReturnValue("wrong@x.com");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleDeleteCustomer(customer);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Email did not match. Deletion cancelled.");
  });

  it("DELETEs the customer when both confirmations pass", async () => {
    promptSpy.mockReturnValue("del@x.com");
    const fetchMock = okFetch({ message: "Deleted" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleDeleteCustomer(customer);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/customers/cust-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(loadData).toHaveBeenCalledTimes(1);
  });
});

describe("useAdminActions — admin management", () => {
  it("handleAddAdmin POSTs the new email and clears the field on success", async () => {
    const fetchMock = okFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() => result.current.setNewAdminEmail("new@x.com"));
    await act(async () => {
      await result.current.handleAddAdmin(formEvent());
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/admins",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@x.com" }) })
    );
    expect(result.current.newAdminEmail).toBe("");
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it("handleAddAdmin no-ops when the email field is empty", async () => {
    const fetchMock = okFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleAddAdmin(formEvent());
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleRemoveAdmin DELETEs the admin after confirmation", async () => {
    const fetchMock = okFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleRemoveAdmin("gone@x.com");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/admins",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ email: "gone@x.com" }) })
    );
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it("handleResendInvite PATCHes the admin endpoint", async () => {
    const fetchMock = okFetch({ message: "sent" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleResendInvite("inv@x.com");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/admins",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ email: "inv@x.com" }) })
    );
    expect(alertSpy).toHaveBeenCalledWith("sent");
  });

  it("handleResetPin PUTs the admin endpoint after confirmation", async () => {
    const fetchMock = okFetch({ message: "reset" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleResetPin("pin@x.com");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/admins",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ email: "pin@x.com" }) })
    );
  });
});

describe("useAdminActions — credits & pricing", () => {
  it("initPricingForm derives dollar strings from the cents config", () => {
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() =>
      result.current.initPricingForm({
        hourlyRateCents: 250,
        autoRefillThresholdCents: 1000,
        autoRefillAmountCents: 5000,
        stoppedInstanceRatePercent: 30,
      } as never)
    );

    expect(result.current.pricingForm).toEqual({
      hourlyRate: "2.50",
      refillThreshold: "10.00",
      refillAmount: "50.00",
      stoppedInstanceRate: "30",
    });
  });

  it("handleAdjustCredits alerts on a non-numeric amount and does not fetch", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() => {
      result.current.setCreditModalCustomer({ id: "c1", email: "c@x.com" } as never);
      result.current.setCreditAmount("not-a-number");
    });
    await act(async () => {
      await result.current.handleAdjustCredits(formEvent(), "goodwill");
    });

    expect(alertSpy).toHaveBeenCalledWith("Invalid amount");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleAdjustCredits requires a reason before fetching", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() => {
      result.current.setCreditModalCustomer({ id: "c1", email: "c@x.com" } as never);
      result.current.setCreditAmount("10");
    });
    await act(async () => {
      await result.current.handleAdjustCredits(formEvent());
    });

    expect(alertSpy).toHaveBeenCalledWith("Please select a reason for this adjustment");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleAdjustCredits POSTs the adjust-credits action on a valid amount + reason", async () => {
    const fetchMock = okFetch({ message: "Adjusted" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() => {
      result.current.setCreditModalCustomer({ id: "c1", email: "c@x.com" } as never);
      result.current.setCreditAmount("12.5");
    });
    await act(async () => {
      await result.current.handleAdjustCredits(formEvent(), "goodwill", "note");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/customers/c1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "adjust-credits", amount: 12.5, reason: "goodwill", reasonNote: "note" }),
      })
    );
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it("handleSavePricing rejects an out-of-range stopped-instance rate", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const setPricing = vi.fn();
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() =>
      result.current.setPricingForm({
        hourlyRate: "1",
        refillThreshold: "10",
        refillAmount: "20",
        stoppedInstanceRate: "150", // > 100 → invalid
      })
    );
    await act(async () => {
      await result.current.handleSavePricing(formEvent(), setPricing);
    });

    expect(alertSpy).toHaveBeenCalledWith("Invalid stopped instance rate (must be 0-100%)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleSavePricing PUTs the cents-converted payload and updates pricing on success", async () => {
    const fetchMock = okFetch({ pricing: { hourlyRateCents: 100 } });
    vi.stubGlobal("fetch", fetchMock);
    const setPricing = vi.fn();
    const { result } = renderHook(() => useAdminActions(loadData));

    act(() =>
      result.current.setPricingForm({
        hourlyRate: "1.00",
        refillThreshold: "10.00",
        refillAmount: "20.00",
        stoppedInstanceRate: "25",
      })
    );
    await act(async () => {
      await result.current.handleSavePricing(formEvent(), setPricing);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/pricing",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          hourlyRateCents: 100,
          autoRefillThresholdCents: 1000,
          autoRefillAmountCents: 2000,
          stoppedInstanceRatePercent: 25,
        }),
      })
    );
    expect(setPricing).toHaveBeenCalledWith({ hourlyRateCents: 100 });
  });
});

describe("useAdminActions — handleLogout", () => {
  it("DELETEs the auth session and routes to the admin login", async () => {
    const fetchMock = okFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const router = { push: vi.fn() };
    const { result } = renderHook(() => useAdminActions(loadData));

    await act(async () => {
      await result.current.handleLogout(router);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/auth", { method: "DELETE" });
    expect(router.push).toHaveBeenCalledWith("/admin/login");
  });
});
