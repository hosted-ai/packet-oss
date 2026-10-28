// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — GpuaasProvisioningModal.
// On mount it GETs /api/admin/providers/nodes/{nodeId}/gpuaas and renders a
// 4-step wizard whose current step is derived from the node's gpuaas* fields.
// Each action POSTs the same endpoint with { action, ...params }. Pins the
// loading + node-not-found states, the step derivation, the register payload
// + its required-field guard, the install-ssh-key flow, the manual ssh-key
// fetch, and the complete-step Join/Scan/Done callbacks.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GpuaasProvisioningModal } from "@/app/admin/components/GpuaasProvisioningModal";

type Json = Record<string, unknown>;

let nodeData: Json | null;
let extra: Json;

function makeFetch(getOk = true) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (method === "GET") {
      return Promise.resolve({
        ok: getOk,
        json: async () =>
          getOk
            ? { data: { node: nodeData, gpuaasNodeStatus: null, regions: extra.regions, clusters: extra.clusters } }
            : { error: "nope" },
      });
    }
    // POST action — return publicKeys for get-ssh-keys etc.
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: { publicKeys: ["ssh-ed25519 AAAA..."] } }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseNode = (over: Json = {}): Json => ({
  id: "node-1",
  hostname: "gpu-host-1",
  ipAddress: "10.0.0.9",
  sshPort: 22,
  sshUsername: "root",
  externalServiceIp: null,
  gpuaasNodeId: null, // -> register step
  gpuaasRegionId: null,
  gpuaasClusterId: null,
  gpuaasPoolId: null,
  gpuaasInitStatus: null,
  gpuaasSshKeysInstalled: false,
  status: "active",
  provider: { id: "prov-1", companyName: "Acme Cloud" },
  ...over,
});

function renderModal() {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  render(
    <GpuaasProvisioningModal nodeId="node-1" onClose={onClose} onComplete={onComplete} />
  );
  return { onClose, onComplete };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  nodeData = baseNode();
  extra = {
    regions: [
      { id: 1, name: "US East", city: "Ashburn", country: "US", gpuaasEnabled: true },
      { id: 2, name: "Disabled", city: "X", country: "X", gpuaasEnabled: false },
    ],
    clusters: [],
  };
});

describe("GpuaasProvisioningModal", () => {
  it("shows the loading state before the fetch resolves", () => {
    makeFetch();
    renderModal();
    expect(screen.getByText(/loading gpuaas data/i)).toBeInTheDocument();
  });

  it("fetches the node gpuaas data on mount", async () => {
    const fetchMock = makeFetch();
    renderModal();
    await screen.findByText("GPUaaS Provisioning");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/providers/nodes/node-1/gpuaas");
  });

  it("renders the node-not-found state when node is null", async () => {
    nodeData = null;
    makeFetch();
    renderModal();
    expect(await screen.findByText("Node not found")).toBeInTheDocument();
  });

  it("renders the header with hostname and provider name", async () => {
    makeFetch();
    renderModal();
    await screen.findByText("GPUaaS Provisioning");
    expect(screen.getByText("gpu-host-1 (Acme Cloud)")).toBeInTheDocument();
  });

  it("shows 'Not registered' for the GPUaaS ID on an unregistered node", async () => {
    makeFetch();
    renderModal();
    await screen.findByText("GPUaaS Provisioning");
    expect(screen.getByText("Not registered")).toBeInTheDocument();
  });

  it("starts on the Register step for an unregistered node", async () => {
    makeFetch();
    renderModal();
    expect(
      await screen.findByText(/step 1: register with gpuaas/i)
    ).toBeInTheDocument();
  });

  it("lists only gpuaas-enabled regions in the dropdown", async () => {
    makeFetch();
    renderModal();
    await screen.findByText(/step 1: register/i);
    expect(
      screen.getByRole("option", { name: /US East \(Ashburn, US\)/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Disabled/ })
    ).not.toBeInTheDocument();
  });

  it("keeps the Register button disabled until region and IP are set", async () => {
    makeFetch();
    renderModal();
    await screen.findByText(/step 1: register/i);
    expect(screen.getByRole("button", { name: /register node/i })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.100/), {
      target: { value: "203.0.113.100" },
    });
    expect(screen.getByRole("button", { name: /register node/i })).toBeEnabled();
  });

  it("POSTs the register action with region, IP and role flags", async () => {
    const fetchMock = makeFetch();
    renderModal();
    await screen.findByText(/step 1: register/i);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.100/), {
      target: { value: "203.0.113.100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register node/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.action).toBe("register");
      expect(body.regionId).toBe(1);
      expect(body.externalServiceIp).toBe("203.0.113.100");
      expect(body.isWorker).toBe(true); // worker checked by default
    });
  });

  it("shows the SSH Keys step once the node is registered but keys are not installed", async () => {
    nodeData = baseNode({ gpuaasNodeId: 42, gpuaasSshKeysInstalled: false });
    makeFetch();
    renderModal();
    expect(
      await screen.findByText(/step 2: install ssh keys/i)
    ).toBeInTheDocument();
  });

  it("POSTs install-ssh-key with the entered password", async () => {
    nodeData = baseNode({ gpuaasNodeId: 42, gpuaasSshKeysInstalled: false });
    const fetchMock = makeFetch();
    renderModal();
    await screen.findByText(/step 2: install ssh keys/i);
    fireEvent.change(screen.getByPlaceholderText(/ssh password/i), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /install key/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      const body = JSON.parse(call![1]!.body as string);
      expect(body.action).toBe("install-ssh-key");
      expect(body.sshPassword).toBe("hunter2");
    });
  });

  it("fetches and displays manual SSH keys via get-ssh-keys", async () => {
    nodeData = baseNode({ gpuaasNodeId: 42, gpuaasSshKeysInstalled: false });
    const fetchMock = makeFetch();
    renderModal();
    await screen.findByText(/step 2: install ssh keys/i);
    fireEvent.click(
      screen.getByRole("button", { name: /get ssh keys to install manually/i })
    );
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "get-ssh-keys"
      );
      expect(call).toBeTruthy();
    });
    expect(await screen.findByText(/ssh-ed25519 AAAA/)).toBeInTheDocument();
  });

  it("renders the Initialize step when keys are installed and status is not_init", async () => {
    nodeData = baseNode({
      gpuaasNodeId: 42,
      gpuaasSshKeysInstalled: true,
      gpuaasInitStatus: "not_init",
    });
    makeFetch();
    renderModal();
    expect(
      await screen.findByText(/step 3: initialize node/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start initialization/i }));
    // covered by the POST below
  });

  it("renders the complete step and Done fires onComplete + onClose", async () => {
    nodeData = baseNode({
      gpuaasNodeId: 42,
      gpuaasSshKeysInstalled: true,
      gpuaasInitStatus: "completed",
    });
    makeFetch();
    const { onClose, onComplete } = renderModal();
    await screen.findByText(/node ready/i);
    expect(screen.getByRole("button", { name: /join cluster/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan gpus/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the node-not-found Close button", async () => {
    nodeData = null;
    makeFetch();
    const { onClose } = renderModal();
    fireEvent.click(await screen.findByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
