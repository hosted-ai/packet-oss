// @vitest-environment jsdom
//
// PA-456: B200Banner (src/app/dashboard/components/B200Banner.tsx) used to
// render a dismiss ("X") button in the corner. It's been removed — the
// banner has no dismiss affordance and always renders once its parent
// mounts it. This guards the regression.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
     
    <img src={src} alt={alt} />
  ),
}));

import { B200Banner } from "@/app/dashboard/components/B200Banner";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) }),
  );
});

describe("B200Banner", () => {
  it("renders with no dismiss button", () => {
    render(<B200Banner token="tok" onDeploy={() => {}} />);
    expect(screen.getByText("Deploy B200")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("calls onDeploy when the Deploy B200 button is clicked", () => {
    const onDeploy = vi.fn();
    render(<B200Banner token="tok" onDeploy={onDeploy} />);
    fireEvent.click(screen.getByRole("button", { name: /Deploy B200/ }));
    expect(onDeploy).toHaveBeenCalledTimes(1);
  });
});
