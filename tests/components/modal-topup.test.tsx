// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. TopupModal lets the user add wallet funds and/or
// apply a voucher. Top-up tiles fire onTopup(cents, voucherCode?). The voucher
// flow validates against /api/account/voucher/validate; a free voucher (no
// minTopupCents) swaps the tiles for a Redeem button hitting
// /api/account/voucher/redeem and then shows a success state. A voucher with a
// minTopupCents disables tiles below the minimum.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TopupModal } from "@/app/dashboard/components/modals/TopupModal";

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseProps = {
  token: "tok",
  topupLoading: false,
  onTopup: vi.fn(),
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("TopupModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch();
    const { container } = render(
      <TopupModal {...baseProps} isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the top-up tiles and heading when open", () => {
    stubFetch();
    render(<TopupModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /top up wallet/i })).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
  });

  it("fires onTopup with the tile value and no voucher code by default", () => {
    stubFetch();
    const onTopup = vi.fn();
    render(<TopupModal {...baseProps} onTopup={onTopup} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("$100").closest("button")!);
    expect(onTopup).toHaveBeenCalledWith(10000, undefined);
  });

  it("validates a voucher and passes its code to onTopup", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        voucher: { code: "BONUS", name: "Bonus", creditCents: 2000, minTopupCents: 2500 },
      }),
    });

    const onTopup = vi.fn();
    render(<TopupModal {...baseProps} onTopup={onTopup} isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/enter voucher code/i), {
      target: { value: "bonus" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(await screen.findByText("Bonus")).toBeInTheDocument();
    fireEvent.click(screen.getByText("$50").closest("button")!);
    expect(onTopup).toHaveBeenCalledWith(5000, "BONUS");
  });

  // PA-205 — a voucher name longer than ~50 chars used to overflow the
  // modal's `max-w-md` boundary because the preview row is a flex layout and
  // the name span had neither `truncate` nor `min-w-0` (a flex item defaults
  // to min-width:auto and won't shrink below its content). Guard the DOM
  // contract that clamps it in-boundary; jsdom has no layout engine, so this
  // pins the mechanism rather than measuring pixels.
  it("truncates a long voucher name inside the preview with a title tooltip", async () => {
    const longName =
      "Super Amazing Mega Ultra Welcome Bonus Promotional Voucher For New Customers";
    expect(longName.length).toBeGreaterThan(50);

    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        voucher: { code: "LONGNAME", name: longName, creditCents: 2000, minTopupCents: 2500 },
      }),
    });

    render(<TopupModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/enter voucher code/i), {
      target: { value: "longname" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    const nameEl = await screen.findByText(longName);
    expect(nameEl).toHaveClass("truncate");
    expect(nameEl).toHaveClass("min-w-0");
    expect(nameEl).toHaveAttribute("title", longName);
  });

  it("disables tiles below a voucher's minimum top-up", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        voucher: { code: "MIN50", name: "Min Fifty", creditCents: 1000, minTopupCents: 5000 },
      }),
    });

    render(<TopupModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/enter voucher code/i), {
      target: { value: "min50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await screen.findByText("Min Fifty");
    // $25 is below the $50 minimum -> disabled; $50 is allowed.
    expect(screen.getByText("$25").closest("button")).toBeDisabled();
    expect(screen.getByText("$50").closest("button")).not.toBeDisabled();
  });

  it("shows a voucher validation error", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: "Invalid voucher code" }),
    });

    render(<TopupModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/enter voucher code/i), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(await screen.findByText("Invalid voucher code")).toBeInTheDocument();
  });

  it("redeems a free voucher and shows the success state", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        voucher: { code: "FREE", name: "Free", creditCents: 3000, minTopupCents: null },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, creditCents: 3000 }),
    });

    const onVoucherRedeemed = vi.fn();
    render(
      <TopupModal
        {...baseProps}
        isOpen
        onClose={vi.fn()}
        onVoucherRedeemed={onVoucherRedeemed}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/enter voucher code/i), {
      target: { value: "free" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    const redeem = await screen.findByRole("button", { name: /Redeem \$30 Credit/i });
    // Free voucher hides the amount tiles.
    expect(screen.queryByText("$25")).not.toBeInTheDocument();

    fireEvent.click(redeem);

    expect(await screen.findByText("$30 added to your wallet")).toBeInTheDocument();
    expect(onVoucherRedeemed).toHaveBeenCalledTimes(1);
  });

  it("fires onClose from the close button", () => {
    stubFetch();
    const onClose = vi.fn();
    render(<TopupModal {...baseProps} isOpen onClose={onClose} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
