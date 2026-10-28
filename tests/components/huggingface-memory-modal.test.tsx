// @vitest-environment jsdom
//
// PA-287: unit coverage for MemoryModal
// (src/components/huggingface-tab/MemoryModal.tsx). Shows detailed model memory
// requirements: a loading spinner, a populated breakdown (total params, est.
// VRAM, dtype rows, optional components for multi-component models), or an
// error/empty state. Close button fires onClose in every state.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MemoryModal } from "@/components/huggingface-tab/MemoryModal";
import type { HfMemResult } from "@/components/huggingface-tab/types";

function makeMem(overrides: Partial<HfMemResult> = {}): HfMemResult {
  return {
    modelId: "meta-llama/Llama-3.1-8B",
    components: [
      { name: "model", dtypes: [], paramCount: 8_000_000_000, bytesCount: 16_000_000_000 },
    ],
    totalParams: 8_000_000_000,
    totalBytes: 16_000_000_000,
    estimatedVramGb: 19,
    dtypeSummary: [
      { dtype: "BF16", paramCount: 8_000_000_000, bytesCount: 16_000_000_000 },
    ],
    ...overrides,
  };
}

const noop = () => {};

describe("MemoryModal — loading state", () => {
  it("shows the analyzing message while loading", () => {
    render(<MemoryModal memoryData={null} loading={true} onClose={noop} />);
    expect(
      screen.getByText(/analyzing safetensors metadata/i),
    ).toBeInTheDocument();
  });

  it("does not show the data breakdown while loading", () => {
    render(<MemoryModal memoryData={makeMem()} loading={true} onClose={noop} />);
    expect(screen.queryByText("Total Parameters")).not.toBeInTheDocument();
  });
});

describe("MemoryModal — populated state", () => {
  it("renders the model id and est. VRAM", () => {
    render(
      <MemoryModal memoryData={makeMem()} loading={false} onClose={noop} />,
    );
    expect(screen.getByText("meta-llama/Llama-3.1-8B")).toBeInTheDocument();
    expect(screen.getByText("19 GB")).toBeInTheDocument();
  });

  it("formats the total parameter count", () => {
    render(
      <MemoryModal memoryData={makeMem()} loading={false} onClose={noop} />,
    );
    // formatParams(8e9) => "8.00B"
    expect(screen.getByText("8.00B")).toBeInTheDocument();
  });

  it("renders the dtype display name for each dtype row", () => {
    render(
      <MemoryModal memoryData={makeMem()} loading={false} onClose={noop} />,
    );
    // getDtypeDisplayName("BF16") => "bfloat16"
    expect(screen.getByText("bfloat16")).toBeInTheDocument();
  });

  it("renders the components section only for multi-component models", () => {
    const single = makeMem();
    const { rerender } = render(
      <MemoryModal memoryData={single} loading={false} onClose={noop} />,
    );
    expect(screen.queryByText("Model Components")).not.toBeInTheDocument();

    const multi = makeMem({
      components: [
        { name: "text_encoder", dtypes: [], paramCount: 1e9, bytesCount: 2e9 },
        { name: "unet", dtypes: [], paramCount: 3e9, bytesCount: 6e9 },
      ],
    });
    rerender(<MemoryModal memoryData={multi} loading={false} onClose={noop} />);
    expect(screen.getByText("Model Components")).toBeInTheDocument();
    expect(screen.getByText("text_encoder")).toBeInTheDocument();
    expect(screen.getByText("unet")).toBeInTheDocument();
  });
});

describe("MemoryModal — empty / error state", () => {
  it("shows the could-not-fetch message when not loading and no data", () => {
    render(<MemoryModal memoryData={null} loading={false} onClose={noop} />);
    expect(
      screen.getByText(/could not fetch memory information/i),
    ).toBeInTheDocument();
  });
});

describe("MemoryModal — close", () => {
  it("fires onClose from the footer Close button", () => {
    const onClose = vi.fn();
    render(<MemoryModal memoryData={makeMem()} loading={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
