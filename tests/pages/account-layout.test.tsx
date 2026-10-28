// @vitest-environment jsdom
//
// PA-416: /account (the sign-up/login page) sat outside the (marketing)
// route group and had no layout mounting <PageTracker />, so a direct visit
// never recorded a pageView. This pins that AccountLayout mounts it (and
// still renders its children), covering /account and /account/settings.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const pageTrackerRender = vi.fn();
vi.mock("@/components/PageTracker", () => ({
  __esModule: true,
  default: () => {
    pageTrackerRender();
    return null;
  },
}));

import AccountLayout from "@/app/account/layout";

describe("AccountLayout", () => {
  it("mounts PageTracker", () => {
    render(
      <AccountLayout>
        <div>content</div>
      </AccountLayout>
    );
    expect(pageTrackerRender).toHaveBeenCalledTimes(1);
  });

  it("still renders its children", () => {
    render(
      <AccountLayout>
        <div>account form</div>
      </AccountLayout>
    );
    expect(screen.getByText("account form")).toBeInTheDocument();
  });
});
