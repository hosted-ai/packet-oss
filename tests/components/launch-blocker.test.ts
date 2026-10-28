// Pure blocker-reason logic behind LaunchGPUModal's launch/deploy button
// (src/app/dashboard/components/launch-blocker.ts). Five conditions gate one
// button; each has to name itself, actionable ones first, and capacity must
// not read as the user's mistake.

import { describe, it, expect } from "vitest";
import { launchBlocker } from "@/app/dashboard/components/launch-blocker";

const READY = {
  hasProduct: true,
  hasRegion: true,
  name: "my-box",
  productAvailable: true,
  launching: false,
};

describe("launchBlocker", () => {
  it("returns nothing when every condition is satisfied", () => {
    expect(launchBlocker(READY)).toBeNull();
  });

  it("names an empty name, including whitespace-only", () => {
    expect(launchBlocker({ ...READY, name: "" })).toEqual({
      tone: "action",
      message: "Name this GPU to continue — the Name field above is empty.",
    });
    expect(launchBlocker({ ...READY, name: "   " })?.tone).toBe("action");
  });

  it("names a missing GPU", () => {
    expect(launchBlocker({ ...READY, hasProduct: false })).toEqual({
      tone: "action",
      message: "Go back and choose a GPU to continue.",
    });
  });

  it("names a missing region", () => {
    expect(launchBlocker({ ...READY, hasRegion: false })).toEqual({
      tone: "action",
      message: "Go back and choose a region to continue.",
    });
  });

  it("reports no capacity as a fact about the fleet, not a validation error", () => {
    const blocker = launchBlocker({ ...READY, productAvailable: false });
    expect(blocker?.tone).toBe("capacity");
    expect(blocker?.message).toBe(
      "This GPU has no capacity right now. Try another GPU or region — nothing is wrong with your settings.",
    );
  });

  it("treats an in-flight launch as progress, never as an error", () => {
    expect(launchBlocker({ ...READY, launching: true })).toEqual({
      tone: "progress",
      message: "Starting your GPU…",
    });
  });

  it("puts the two-second fix ahead of the one the user cannot make", () => {
    // Both unmet: the user can name the instance, they cannot conjure capacity.
    const blocker = launchBlocker({ ...READY, name: "", productAvailable: false });
    expect(blocker?.message).toMatch(/Name field above is empty/);
  });

  it("reports the live launch ahead of any stale unmet condition", () => {
    expect(launchBlocker({ ...READY, name: "", launching: true })?.tone).toBe("progress");
  });
});
