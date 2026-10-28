// @vitest-environment jsdom
//
// PA-287: unit coverage for ItemCard (src/components/huggingface-tab/ItemCard.tsx).
// Renders a HuggingFace model/space card: name, id, description, tags, a VRAM
// badge with a "details" link (onOpenMemoryModal), a gated badge, an over-storage
// warning, and a Deploy button (onDeploy) that disables when the model exceeds
// the standard pod ephemeral storage limit (150GB).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ItemCard } from "@/components/huggingface-tab/ItemCard";
import type { SearchResult } from "@/components/huggingface-tab/types";

function makeItem(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B Instruct",
    description: "A capable instruction-tuned model.",
    author: "meta-llama",
    downloads: 1000,
    likes: 50,
    gated: false,
    tags: ["text-generation", "transformers", "llama"],
    estimatedVramGb: 16,
    estimatedDiskSizeGb: 30,
    type: "model",
    source: "huggingface",
    ...overrides,
  };
}

const noop = () => {};

describe("ItemCard — display", () => {
  it("renders the model name and id", () => {
    render(
      <ItemCard item={makeItem()} onDeploy={noop} onOpenMemoryModal={noop} />,
    );
    expect(screen.getByText("Llama 3.1 8B Instruct")).toBeInTheDocument();
    expect(
      screen.getByText("meta-llama/Llama-3.1-8B-Instruct"),
    ).toBeInTheDocument();
  });

  it("renders the description", () => {
    render(
      <ItemCard item={makeItem()} onDeploy={noop} onOpenMemoryModal={noop} />,
    );
    expect(
      screen.getByText("A capable instruction-tuned model."),
    ).toBeInTheDocument();
  });

  it("renders up to 3 tags", () => {
    render(
      <ItemCard
        item={makeItem({ tags: ["a", "b", "c", "d", "e"] })}
        onDeploy={noop}
        onOpenMemoryModal={noop}
      />,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.queryByText("d")).not.toBeInTheDocument();
  });

  it("renders the VRAM badge from estimatedVramGb", () => {
    render(
      <ItemCard
        item={makeItem({ estimatedVramGb: 24 })}
        onDeploy={noop}
        onOpenMemoryModal={noop}
      />,
    );
    expect(screen.getByText(/24GB VRAM/)).toBeInTheDocument();
  });

  it("shows a 'Requires Token' badge for gated models", () => {
    render(
      <ItemCard
        item={makeItem({ gated: true })}
        onDeploy={noop}
        onOpenMemoryModal={noop}
      />,
    );
    expect(screen.getByText("Requires Token")).toBeInTheDocument();
  });

  it("shows the HF Hub badge for huggingface-sourced items", () => {
    render(
      <ItemCard item={makeItem()} onDeploy={noop} onOpenMemoryModal={noop} />,
    );
    expect(screen.getByText("HF Hub")).toBeInTheDocument();
  });
});

describe("ItemCard — interactions", () => {
  it("calls onDeploy with the item when Deploy is clicked", () => {
    const onDeploy = vi.fn();
    const item = makeItem();
    render(
      <ItemCard item={item} onDeploy={onDeploy} onOpenMemoryModal={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /deploy to gpu/i }));
    expect(onDeploy).toHaveBeenCalledWith(item);
  });

  it("calls onOpenMemoryModal with the model id from the details link", () => {
    const onOpenMemoryModal = vi.fn();
    render(
      <ItemCard
        item={makeItem()}
        onDeploy={noop}
        onOpenMemoryModal={onOpenMemoryModal}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(onOpenMemoryModal).toHaveBeenCalledWith(
      "meta-llama/Llama-3.1-8B-Instruct",
    );
  });
});

describe("ItemCard — storage limit", () => {
  it("disables Deploy and shows a warning when disk exceeds the pod limit", () => {
    render(
      <ItemCard
        item={makeItem({ estimatedDiskSizeGb: 500 })}
        onDeploy={noop}
        onOpenMemoryModal={noop}
      />,
    );
    const deploy = screen.getByRole("button", { name: /deploy to gpu/i });
    expect(deploy).toBeDisabled();
    expect(screen.getByText(/exceeds 150GB pod limit/i)).toBeInTheDocument();
  });

  it("keeps Deploy enabled when disk is within the limit", () => {
    render(
      <ItemCard
        item={makeItem({ estimatedDiskSizeGb: 30 })}
        onDeploy={noop}
        onOpenMemoryModal={noop}
      />,
    );
    expect(
      screen.getByRole("button", { name: /deploy to gpu/i }),
    ).not.toBeDisabled();
  });
});
