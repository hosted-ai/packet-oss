import { describe, it, expect } from "vitest";
import { generateDeployScript } from "@/lib/huggingface-deploy-scripts";

// PA-280: on drivers that can't run the newest cu128/torch-2.7 wheels the
// generated install script must fall back to a coherent, pinned cu124 stack
// (installing torch first so pip can't upgrade it), and reserve the unpinned
// "latest vLLM" path for driver >= 575.
describe("generateDeployScript — vLLM install (PA-280 driver gate)", () => {
  const script = generateDeployScript("vllm", {
    modelId: "Qwen/Qwen2.5-Coder-14B-Instruct-AWQ",
  });

  it("gates the wheel choice on driver >= 575", () => {
    expect(script).toContain('[ "$DRIVER_VER" -ge 575 ]');
    // The stale <560 / vllm 0.8.x heuristic must be gone.
    expect(script).not.toContain("vllm>=0.8,<0.9");
    expect(script).not.toContain("-lt 560");
  });

  it("installs the pinned cu124 torch stack before vLLM on older drivers", () => {
    const torchIdx = script.indexOf("torch==2.5.1");
    const vllmIdx = script.indexOf("vllm==0.6.6");
    expect(torchIdx).toBeGreaterThan(-1);
    expect(vllmIdx).toBeGreaterThan(-1);
    // torch (cu124) must be installed ahead of vLLM so it isn't upgraded.
    expect(torchIdx).toBeLessThan(vllmIdx);
    expect(script).toContain("download.pytorch.org/whl/cu124");
    // transformers must be pinned too, else pip pulls 5.x (needs torch 2.7).
    expect(script).toContain("transformers==4.47.1");
    expect(script).toContain("tokenizers==0.21.0");
  });

  it("still allows the latest vLLM on driver >= 575", () => {
    expect(script).toContain("installing latest vLLM");
    expect(script).toContain("pip install vllm >>");
  });
});
