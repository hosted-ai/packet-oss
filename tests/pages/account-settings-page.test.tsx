// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /account/settings page is a
// 5-line server-side redirect stub — it calls next/navigation's redirect()
// straight to /account (legacy path consolidation). There is no UI to render;
// redirect() throws internally in Next, so the only observable behaviour is
// the redirect target. We mock redirect() and assert it is invoked with
// "/account".

import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import AccountSettingsRedirect from "@/app/account/settings/page";

beforeEach(() => {
  redirectMock.mockClear();
});

describe("AccountSettingsRedirect page (PA-289)", () => {
  it("redirects to /account", () => {
    AccountSettingsRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it("redirects exactly once", () => {
    AccountSettingsRedirect();
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it("does not redirect anywhere other than /account", () => {
    AccountSettingsRedirect();
    expect(redirectMock).not.toHaveBeenCalledWith("/account/settings");
    expect(redirectMock).not.toHaveBeenCalledWith("/dashboard");
  });
});
