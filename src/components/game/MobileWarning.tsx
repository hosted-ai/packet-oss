/**
 * Mobile Warning Component
 *
 * Displays a warning message for mobile users.
 *
 * @module components/game/MobileWarning
 */

"use client";

export function MobileWarning() {
  return (
    <div className="mobile-warning">
      <div className="mobile-gpu">fire</div>
      <h2>THERMAL THROTTLING DETECTED</h2>
      <p>
        Sorry, but these enterprise GPU workloads require a bigger screen to
        handle the heat.
      </p>
      <p>
        Your phone would literally melt trying to run 5 RTX PRO 6000s (96GB
        each!) at 80% utilization.
      </p>
      <div className="joke">
        Pro tip: Even NVIDIA doesn&apos;t try to fit a data center in your pocket.
        Please switch to a computer or tablet!
      </div>
      <div className="specs">
        <div>
          Required: <span>Desktop/Laptop/Tablet</span>
        </div>
        <div>
          Detected: <span>Pocket-sized heat source</span>
        </div>
        <div>
          GPU VRAM: <span>Insufficient (need 240GB)</span>
        </div>
        <div>
          Status: <span>OVERHEATED</span>
        </div>
      </div>
    </div>
  );
}
