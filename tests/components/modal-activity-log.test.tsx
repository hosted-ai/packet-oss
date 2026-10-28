// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. ActivityLogModal mirrors TransactionsModal — a
// pure prop-driven modal that renders null when closed, a table of activity
// events when open (with the event type underscores replaced by spaces), and
// an empty state otherwise.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ActivityLogModal } from "@/app/dashboard/components/modals/ActivityLogModal";

const fmt = (ts: number) => `DT(${ts})`;

const events = [
  { id: "e1", type: "gpu_launched", description: "Launched A100", created: 10 },
  { id: "e2", type: "wallet_charged", description: "Charged $5", created: 20 },
];

describe("ActivityLogModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <ActivityLogModal
        isOpen={false}
        onClose={vi.fn()}
        events={events}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading and a row per event when open", () => {
    render(
      <ActivityLogModal
        isOpen
        onClose={vi.fn()}
        events={events}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /activity log/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Launched A100")).toBeInTheDocument();
    expect(screen.getByText("Charged $5")).toBeInTheDocument();
  });

  it("humanises the event type by replacing underscores with spaces", () => {
    render(
      <ActivityLogModal
        isOpen
        onClose={vi.fn()}
        events={events}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("gpu launched")).toBeInTheDocument();
    expect(screen.getByText("wallet charged")).toBeInTheDocument();
  });

  it("pluralises the count and uses the supplied formatter", () => {
    render(
      <ActivityLogModal
        isOpen
        onClose={vi.fn()}
        events={events}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("2 events total")).toBeInTheDocument();
    expect(screen.getByText("DT(10)")).toBeInTheDocument();
  });

  it("uses the singular noun for exactly one event", () => {
    render(
      <ActivityLogModal
        isOpen
        onClose={vi.fn()}
        events={[events[0]]}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("1 event total")).toBeInTheDocument();
  });

  it("shows the empty state and no table when there are no events", () => {
    render(
      <ActivityLogModal
        isOpen
        onClose={vi.fn()}
        events={[]}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("No activity events yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("fires onDownloadCSV and onClose from the header buttons", () => {
    const onClose = vi.fn();
    const onDownloadCSV = vi.fn();
    render(
      <ActivityLogModal
        isOpen
        onClose={onClose}
        events={events}
        formatDateTime={fmt}
        onDownloadCSV={onDownloadCSV}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    expect(onDownloadCSV).toHaveBeenCalledTimes(1);

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
