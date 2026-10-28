/**
 * Why the launch/deploy button in LaunchGPUModal is disabled.
 *
 * Five separate conditions gate that one button, and a greyed-out button with
 * no explanation is indistinguishable between them — an empty Name field looks
 * identical to a region that has run out of capacity. This turns the state the
 * modal already has into one short line the user (or a support agent reading a
 * screenshot) can act on.
 *
 * Order is by what the user can fix fastest: naming the instance takes two
 * seconds, capacity is not theirs to fix at all and is worded as a fact rather
 * than a validation error. `launching` is progress, never a fault.
 */

export type LaunchBlockerTone = "action" | "capacity" | "progress";

export interface LaunchBlockerInput {
  hasProduct: boolean;
  hasRegion: boolean;
  name: string;
  productAvailable: boolean;
  launching: boolean;
}

export interface LaunchBlocker {
  tone: LaunchBlockerTone;
  message: string;
}

/** The one blocker to show, or null when the button is genuinely ready. */
export function launchBlocker({
  hasProduct,
  hasRegion,
  name,
  productAvailable,
  launching,
}: LaunchBlockerInput): LaunchBlocker | null {
  if (launching) return { tone: "progress", message: "Starting your GPU…" };
  if (!name.trim()) return { tone: "action", message: "Name this GPU to continue — the Name field above is empty." };
  if (!hasProduct) return { tone: "action", message: "Go back and choose a GPU to continue." };
  if (!hasRegion) return { tone: "action", message: "Go back and choose a region to continue." };
  if (!productAvailable) {
    return { tone: "capacity", message: "This GPU has no capacity right now. Try another GPU or region — nothing is wrong with your settings." };
  }
  return null;
}
