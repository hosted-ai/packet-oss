// @vitest-environment jsdom
//
// PA-287: unit coverage for DeployModal
// (src/components/huggingface-tab/DeployModal.tsx). The deploy dialog: item
// header, existing-vs-new GPU mode toggle, wallet + prepaid pricing summary,
// gated-model HF token input, chat-model Open WebUI option, deploying/polling
// states, error/success panels, and the Cancel/Deploy actions with their
// disabled logic. GPUPicker is stubbed so we exercise DeployModal's own render.

import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// GPUPicker manages its own product/region selection; stub it out.
vi.mock("@/components/GPUPicker", () => ({
  GPUPicker: () => <div data-testid="gpu-picker" />,
}));

import { DeployModal } from "@/components/huggingface-tab/DeployModal";
import type {
  SearchResult,
  LaunchOptions,
  ExistingSubscription,
} from "@/components/huggingface-tab/types";

function makeItem(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B Instruct",
    description: "An instruction-tuned model.",
    author: "meta-llama",
    downloads: 1000,
    likes: 10,
    gated: false,
    tags: ["text-generation"],
    estimatedVramGb: 16,
    estimatedDiskSizeGb: 30,
    type: "model",
    source: "huggingface",
    ...overrides,
  };
}

const launchOptions: LaunchOptions = {
  products: [
    {
      id: "prod-1",
      name: "RTX 4090",
      description: null,
      pricePerHourCents: 200, // $2.00/hr
      vramGb: 24,
      available: true,
    },
  ],
  categories: [],
  walletBalanceCents: 5000, // $50.00
};

function setup(
  overrides: Partial<ComponentProps<typeof DeployModal>> = {},
): ComponentProps<typeof DeployModal> {
  const props: ComponentProps<typeof DeployModal> = {
    token: "tok",
    selectedItem: makeItem(),
    launchOptions,
    existingSubscriptions: [],
    deployMode: "new",
    setDeployMode: vi.fn(),
    selectedSubscription: "",
    setSelectedSubscription: vi.fn(),
    selectedProduct: "",
    setSelectedProduct: vi.fn(),
    selectedRegion: null,
    setSelectedRegion: vi.fn(),
    gpuCount: 1,
    setGpuCount: vi.fn(),
    hfToken: "",
    setHfToken: vi.fn(),
    addOpenWebUI: false,
    setAddOpenWebUI: vi.fn(),
    deploying: false,
    deployError: null,
    deploySuccess: null,
    deployLogs: null,
    showLogs: false,
    setShowLogs: vi.fn(),
    deployResult: null,
    isPolling: false,
    deploymentStatus: "not_started",
    deploymentMessage: "",
    onClose: vi.fn(),
    onDeploy: vi.fn(),
    ...overrides,
  };
  render(<DeployModal {...props} />);
  return props;
}

describe("DeployModal — header", () => {
  it("renders the title, item name, and description", () => {
    setup();
    expect(screen.getByText("Deploy to GPU")).toBeInTheDocument();
    expect(screen.getByText("Llama 3.1 8B Instruct")).toBeInTheDocument();
    expect(screen.getByText("An instruction-tuned model.")).toBeInTheDocument();
  });

  it("renders the GPU picker for new deployments", () => {
    setup();
    expect(screen.getByTestId("gpu-picker")).toBeInTheDocument();
  });
});

describe("DeployModal — deploy mode toggle", () => {
  const subs: ExistingSubscription[] = [
    {
      id: "sub-1",
      pool_name: "pool-a",
      pool_label: "Pool A",
      gpu_model: "RTX 4090",
      vgpus: 2,
      status: "running",
    },
  ];

  it("shows the Existing/New toggle when there are existing subscriptions", () => {
    setup({ existingSubscriptions: subs });
    expect(screen.getByRole("button", { name: /existing gpu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new gpu/i })).toBeInTheDocument();
  });

  it("hides the toggle when there are no existing subscriptions", () => {
    setup();
    expect(screen.queryByRole("button", { name: /existing gpu/i })).not.toBeInTheDocument();
  });

  it("switches mode when the toggle buttons are pressed", () => {
    const props = setup({ existingSubscriptions: subs });
    fireEvent.click(screen.getByRole("button", { name: /existing gpu/i }));
    expect(props.setDeployMode).toHaveBeenCalledWith("existing");
  });

  it("renders the existing-GPU select in 'existing' mode", () => {
    setup({ existingSubscriptions: subs, deployMode: "existing" });
    expect(screen.getByText(/Pool A.*RTX 4090.*2 GPUs/)).toBeInTheDocument();
  });
});

describe("DeployModal — pricing summary", () => {
  it("shows wallet balance and prepaid/hourly pricing when a product is selected", () => {
    setup({ selectedProduct: "prod-1" });
    // Wallet $50.00
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    // First 30 min prepaid: round(0.5 * 200)=100 cents => $1.00
    expect(screen.getByText("$1.00")).toBeInTheDocument();
    // Hourly: $2.00
    expect(screen.getByText(/\$2\.00/)).toBeInTheDocument();
  });

  it("hides the pricing summary when no product is selected", () => {
    setup({ selectedProduct: "" });
    expect(screen.queryByText(/First 30 min prepaid/i)).not.toBeInTheDocument();
  });
});

describe("DeployModal — gated token", () => {
  it("shows the HF token input for gated models", () => {
    setup({ selectedItem: makeItem({ gated: true }) });
    expect(screen.getByPlaceholderText(/hf_/i)).toBeInTheDocument();
  });

  it("calls setHfToken on input", () => {
    const props = setup({ selectedItem: makeItem({ gated: true }) });
    fireEvent.change(screen.getByPlaceholderText(/hf_/i), {
      target: { value: "hf_secret" },
    });
    expect(props.setHfToken).toHaveBeenCalledWith("hf_secret");
  });

  it("does not show the token input for ungated models", () => {
    setup({ selectedItem: makeItem({ gated: false }) });
    expect(screen.queryByPlaceholderText(/hf_/i)).not.toBeInTheDocument();
  });
});

describe("DeployModal — chat models", () => {
  it("shows the Open WebUI option for an instruct (chat) model", () => {
    setup({ selectedItem: makeItem({ id: "x/Model-Instruct", name: "Model Instruct" }) });
    expect(screen.getByText(/Add Chat UI/i)).toBeInTheDocument();
  });

  it("hides the Open WebUI option for a non-chat model", () => {
    setup({ selectedItem: makeItem({ id: "x/base-model", name: "Base Model", tags: [] }) });
    expect(screen.queryByText(/Add Chat UI/i)).not.toBeInTheDocument();
  });
});

describe("DeployModal — status panels", () => {
  it("shows the deploying state", () => {
    setup({ deploying: true });
    expect(screen.getByText(/Deploying\.\.\./)).toBeInTheDocument();
  });

  it("shows an error message", () => {
    setup({ deployError: "Insufficient balance" });
    expect(screen.getByText("Insufficient balance")).toBeInTheDocument();
  });

  it("shows the success panel with the API endpoint", () => {
    setup({
      deploySuccess: "Model deployed!",
      deployResult: { serviceHost: "10.0.0.1", servicePort: 8000 },
    });
    expect(screen.getByText("Model deployed!")).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
  });
});

describe("DeployModal — actions", () => {
  it("Cancel fires onClose", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Deploy is disabled in 'new' mode with no product selected", () => {
    setup({ selectedProduct: "" });
    expect(screen.getByRole("button", { name: /^deploy$/i })).toBeDisabled();
  });

  it("Deploy is enabled in 'new' mode once a product is selected", () => {
    setup({ selectedProduct: "prod-1" });
    expect(screen.getByRole("button", { name: /^deploy$/i })).not.toBeDisabled();
  });

  it("Deploy fires onDeploy when enabled", () => {
    const props = setup({ selectedProduct: "prod-1" });
    fireEvent.click(screen.getByRole("button", { name: /^deploy$/i }));
    expect(props.onDeploy).toHaveBeenCalledTimes(1);
  });

  it("hides the Deploy button after success (only Close remains)", () => {
    setup({ deploySuccess: "Done!" });
    expect(screen.queryByRole("button", { name: /^deploy$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });
});
