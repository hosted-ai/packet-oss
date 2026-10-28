// @vitest-environment jsdom
//
// PA-287: unit coverage for ImpersonationBanner
// (src/app/dashboard/components/ImpersonationBanner.tsx). A sticky warning bar
// shown only during an admin "Login as" session. Shows the impersonated
// customer's email, optionally the admin's email, and an Exit button that
// closes the tab / navigates to /admin.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ImpersonationBanner } from "@/app/dashboard/components/ImpersonationBanner";

describe("ImpersonationBanner", () => {
  it("shows the impersonated customer email", () => {
    render(<ImpersonationBanner customerEmail="customer@example.com" />);
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(screen.getByText(/logged in as/i)).toBeInTheDocument();
  });

  it("shows the admin email when provided", () => {
    render(
      <ImpersonationBanner
        customerEmail="customer@example.com"
        adminEmail="admin@example.com"
      />,
    );
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText(/from/i)).toBeInTheDocument();
  });

  it("omits the admin-account clause when no admin email is given", () => {
    render(<ImpersonationBanner customerEmail="customer@example.com" />);
    // The "from <adminEmail>'s account" clause only renders when adminEmail
    // is provided; the generic customer warning text always renders.
    expect(screen.queryByText("admin@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText(/from/i)).not.toBeInTheDocument();
  });

  it("renders an Exit button", () => {
    render(<ImpersonationBanner customerEmail="customer@example.com" />);
    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  it("navigates to /admin when Exit is clicked", () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    // window.location.href assignment — capture via a setter spy.
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return "";
        },
        set href(v: string) {
          hrefSetter(v);
        },
      },
    });

    render(<ImpersonationBanner customerEmail="customer@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));

    expect(closeSpy).toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledWith("/admin");

    closeSpy.mockRestore();
  });
});

beforeEach(() => {
  // Reset any location override from a prior test.
  // (jsdom recreates window per file, so this is belt-and-suspenders.)
});
