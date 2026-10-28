// @vitest-environment jsdom
//
// PA-287: unit coverage for FilterPanel
// (src/components/huggingface-tab/FilterPanel.tsx). Three <select> dropdowns
// (task/library/param-size) that fall back to hardcoded options when no
// server-provided filterOptions are given, fire the matching setters onChange,
// and render an active-filters chip row with individual + "Clear all" clearers.

import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { FilterPanel } from "@/components/huggingface-tab/FilterPanel";

function setup(overrides: Partial<ComponentProps<typeof FilterPanel>> = {}) {
  const props = {
    selectedTask: "",
    setSelectedTask: vi.fn(),
    selectedLibrary: "",
    setSelectedLibrary: vi.fn(),
    selectedParamSize: "",
    setSelectedParamSize: vi.fn(),
    filterOptions: null,
    ...overrides,
  };
  render(<FilterPanel {...props} />);
  return props;
}

describe("FilterPanel — rendering", () => {
  it("renders the three filter labels", () => {
    setup();
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Model Size")).toBeInTheDocument();
  });

  it("falls back to default options when filterOptions is null", () => {
    setup();
    expect(screen.getByRole("option", { name: "Text Generation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Transformers" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All Tasks" })).toBeInTheDocument();
  });

  it("renders server-provided options when filterOptions is supplied", () => {
    setup({
      filterOptions: {
        tasks: [{ value: "custom-task", label: "Custom Task" }],
        libraries: [{ value: "custom-lib", label: "Custom Lib" }],
        paramSizes: [{ value: "xl", label: "Extra Large" }],
      },
    });
    expect(screen.getByRole("option", { name: "Custom Task" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Custom Lib" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Extra Large" })).toBeInTheDocument();
    // The hardcoded fallbacks should NOT appear.
    expect(
      screen.queryByRole("option", { name: "Text Generation" }),
    ).not.toBeInTheDocument();
  });
});

describe("FilterPanel — change handlers", () => {
  it("calls setSelectedTask when the task select changes", () => {
    const props = setup();
    const select = screen.getByText("Task").parentElement!.querySelector("select")!;
    fireEvent.change(select, { target: { value: "text-generation" } });
    expect(props.setSelectedTask).toHaveBeenCalledWith("text-generation");
  });

  it("calls setSelectedLibrary when the library select changes", () => {
    const props = setup();
    const select = screen.getByText("Library").parentElement!.querySelector("select")!;
    fireEvent.change(select, { target: { value: "transformers" } });
    expect(props.setSelectedLibrary).toHaveBeenCalledWith("transformers");
  });

  it("calls setSelectedParamSize when the size select changes", () => {
    const props = setup();
    const select = screen.getByText("Model Size").parentElement!.querySelector("select")!;
    fireEvent.change(select, { target: { value: "7-14" } });
    expect(props.setSelectedParamSize).toHaveBeenCalledWith("7-14");
  });
});

describe("FilterPanel — active filters", () => {
  it("hides the active-filters row when nothing is selected", () => {
    setup();
    expect(screen.queryByText("Active:")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear all filters/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the active-filters row when a filter is selected", () => {
    setup({ selectedTask: "text-generation" });
    expect(screen.getByText("Active:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear all filters/i }),
    ).toBeInTheDocument();
  });

  it("'Clear all filters' resets all three setters", () => {
    const props = setup({
      selectedTask: "text-generation",
      selectedLibrary: "transformers",
      selectedParamSize: "7-14",
    });
    fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    expect(props.setSelectedTask).toHaveBeenCalledWith("");
    expect(props.setSelectedLibrary).toHaveBeenCalledWith("");
    expect(props.setSelectedParamSize).toHaveBeenCalledWith("");
  });
});
