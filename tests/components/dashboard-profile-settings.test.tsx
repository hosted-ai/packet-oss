// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): ProfileSettings — account profile form. Loads
// from GET /api/account/profile, saves via PUT, keeps email read-only, and
// fires the plerdy PROFILE_UPDATED event on success (mocked here).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const trackPlerdy = vi.fn();
vi.mock("@/lib/plerdy", () => ({
  trackPlerdy,
  PLERDY_EVENTS: { PROFILE_UPDATED: "profile_updated" },
}));

import { ProfileSettings } from "@/app/dashboard/components/ProfileSettings";

const PROFILE = {
  name: "Jordan",
  email: "jordan@example.com",
  company: "Acme",
  phone: "",
  jobTitle: "",
  website: "",
  timezone: "",
  useCase: "",
};

function stubFetch(handlers: { get?: unknown; put?: unknown; putOk?: boolean }) {
  const fetchMock = vi.fn((_url: string, opts?: { method?: string }) => {
    if (opts?.method === "PUT") {
      return Promise.resolve({ ok: handlers.putOk ?? true, json: async () => handlers.put });
    }
    return Promise.resolve({ ok: true, json: async () => handlers.get });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileSettings", () => {
  it("fetches the profile on mount and populates fields", async () => {
    const fetchMock = stubFetch({ get: { success: true, profile: PROFILE } });
    render(<ProfileSettings token="test-token" />);

    await waitFor(() => expect(screen.getByDisplayValue("Jordan")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } })
    );
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
  });

  it("renders the email field as disabled (read-only)", async () => {
    stubFetch({ get: { success: true, profile: PROFILE } });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("jordan@example.com"));
    expect(screen.getByDisplayValue("jordan@example.com")).toBeDisabled();
    expect(screen.getByText(/contact support to change your email/i)).toBeInTheDocument();
  });

  it("PUTs the edited profile on save", async () => {
    const fetchMock = stubFetch({
      get: { success: true, profile: PROFILE },
      put: { success: true, profile: { ...PROFILE, name: "Jordan B" } },
    });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    fireEvent.change(screen.getByDisplayValue("Jordan"), { target: { value: "Jordan B" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
    });
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(putCall![0]).toBe("/api/account/profile");
    const sent = JSON.parse(putCall![1].body);
    expect(sent.name).toBe("Jordan B");
  });

  it("shows a success message and fires the plerdy event on success", async () => {
    stubFetch({
      get: { success: true, profile: PROFILE },
      put: { success: true, profile: PROFILE },
    });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText(/profile updated successfully/i)).toBeInTheDocument());
    await waitFor(() => expect(trackPlerdy).toHaveBeenCalledWith("profile_updated"));
  });

  it("shows the server error when the save returns success:false", async () => {
    stubFetch({
      get: { success: true, profile: PROFILE },
      put: { success: false, error: "invalid website" },
    });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText("invalid website")).toBeInTheDocument());
  });

  it("shows a generic error when the save throws", async () => {
    const fetchMock = vi.fn((_url: string, opts?: { method?: string }) => {
      if (opts?.method === "PUT") return Promise.reject(new Error("network"));
      return Promise.resolve({ ok: true, json: async () => ({ success: true, profile: PROFILE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText(/failed to update profile/i)).toBeInTheDocument());
  });

  it("lets the user edit the use-case dropdown", async () => {
    stubFetch({ get: { success: true, profile: PROFILE } });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    // The use-case <select> is the one currently showing its placeholder
    // option ("Select your primary use case"); both selects start empty.
    const useCase = screen.getByDisplayValue("Select your primary use case");
    fireEvent.change(useCase, { target: { value: "inference" } });
    expect((useCase as HTMLSelectElement).value).toBe("inference");
  });

  it("keeps the ZIP-code label in English when the country is Germany (PA-312)", async () => {
    // UI is English-only: selecting Germany (DE) must not localise the label
    // to "Postleitzahl" — it stays "Postal / ZIP Code".
    stubFetch({ get: { success: true, profile: { ...PROFILE, country: "DE", companyCountry: "DE" } } });
    render(<ProfileSettings token="test-token" />);
    await waitFor(() => screen.getByDisplayValue("Jordan"));

    expect(screen.queryByText(/Postleitzahl/)).toBeNull();
    expect(screen.getAllByText(/Postal \/ ZIP Code/).length).toBeGreaterThan(0);
  });
});
