import { describe, it, expect } from 'vitest';
import {
  GPU_SPECS,
  getPoolVRAM,
  getGPUSpec,
  checkVRAMCompatibility,
  getCompatibilityMessage,
  type GPUSpec,
} from '@/lib/gpu-specs';

describe('GPU Specs Module', () => {
  describe('GPU_SPECS constant', () => {
    it('should contain H100 specification', () => {
      expect(GPU_SPECS['H100']).toBeDefined();
      expect(GPU_SPECS['H100'].vramGb).toBe(80);
      expect(GPU_SPECS['H100'].architecture).toBe('Hopper');
      expect(GPU_SPECS['H100'].tensorCores).toBe(true);
    });

    it('should contain A100 40GB specification', () => {
      expect(GPU_SPECS['A100 40GB']).toBeDefined();
      expect(GPU_SPECS['A100 40GB'].vramGb).toBe(40);
      expect(GPU_SPECS['A100 40GB'].architecture).toBe('Ampere');
      expect(GPU_SPECS['A100 40GB'].tensorCores).toBe(true);
    });

    it('should contain A100 80GB specification', () => {
      expect(GPU_SPECS['A100 80GB']).toBeDefined();
      expect(GPU_SPECS['A100 80GB'].vramGb).toBe(80);
      expect(GPU_SPECS['A100 80GB'].architecture).toBe('Ampere');
      expect(GPU_SPECS['A100 80GB'].tensorCores).toBe(true);
    });

    it('should contain H200 specification', () => {
      expect(GPU_SPECS['H200']).toBeDefined();
      expect(GPU_SPECS['H200'].vramGb).toBe(141);
      expect(GPU_SPECS['H200'].architecture).toBe('Hopper');
      expect(GPU_SPECS['H200'].tensorCores).toBe(true);
    });

    it('should contain B200 specification', () => {
      expect(GPU_SPECS['B200']).toBeDefined();
      expect(GPU_SPECS['B200'].vramGb).toBe(192);
      expect(GPU_SPECS['B200'].architecture).toBe('Blackwell');
      expect(GPU_SPECS['B200'].tensorCores).toBe(true);
    });

    it('should contain RTX 4090 specification', () => {
      expect(GPU_SPECS['RTX 4090']).toBeDefined();
      expect(GPU_SPECS['RTX 4090'].vramGb).toBe(24);
      expect(GPU_SPECS['RTX 4090'].architecture).toBe('Ada Lovelace');
      expect(GPU_SPECS['RTX 4090'].tensorCores).toBe(true);
    });

    it('should have all GPUs with tensor cores enabled', () => {
      Object.values(GPU_SPECS).forEach((spec) => {
        expect(spec.tensorCores).toBe(true);
      });
    });
  });

  describe('getPoolVRAM', () => {
    it('should extract VRAM from H100 pool name', () => {
      expect(getPoolVRAM('H100 Pool')).toBe(80);
      expect(getPoolVRAM('NVIDIA H100')).toBe(80);
      expect(getPoolVRAM('h100-pool-1')).toBe(80);
    });

    it('should extract VRAM from H100 SXM pool name', () => {
      expect(getPoolVRAM('H100 SXM Pool')).toBe(80);
      expect(getPoolVRAM('H100 SXM')).toBe(80);
    });

    it('should extract VRAM from H100 PCIe pool name', () => {
      expect(getPoolVRAM('H100 PCIe Pool')).toBe(80);
      expect(getPoolVRAM('H100 PCIe')).toBe(80);
    });

    it('should extract VRAM from A100 80GB pool name', () => {
      expect(getPoolVRAM('A100 80GB Pool')).toBe(80);
      expect(getPoolVRAM('NVIDIA A100 80GB')).toBe(80);
    });

    it('should extract VRAM from A100 40GB pool name', () => {
      expect(getPoolVRAM('A100 40GB Pool')).toBe(40);
      expect(getPoolVRAM('NVIDIA A100 40GB')).toBe(40);
    });

    it('should extract VRAM from B200 pool name', () => {
      expect(getPoolVRAM('B200 Pool')).toBe(192);
      expect(getPoolVRAM('NVIDIA B200')).toBe(192);
    });

    it('should extract VRAM from H200 pool name', () => {
      expect(getPoolVRAM('H200 Pool')).toBe(141);
      expect(getPoolVRAM('NVIDIA H200')).toBe(141);
    });

    it('should extract VRAM from RTX 4090 pool name', () => {
      expect(getPoolVRAM('RTX 4090 Pool')).toBe(24);
      expect(getPoolVRAM('NVIDIA RTX 4090')).toBe(24);
    });

    it('should extract VRAM from RTX 3090 pool name', () => {
      expect(getPoolVRAM('RTX 3090 Pool')).toBe(24);
      expect(getPoolVRAM('NVIDIA RTX 3090')).toBe(24);
    });

    it('should return default 80GB for unknown pool names', () => {
      expect(getPoolVRAM('Unknown GPU Pool')).toBe(80);
      expect(getPoolVRAM('Generic Pool')).toBe(80);
      expect(getPoolVRAM('Mystery GPU')).toBe(80);
    });

    it('should be case insensitive', () => {
      expect(getPoolVRAM('h100 pool')).toBe(80);
      expect(getPoolVRAM('H100 POOL')).toBe(80);
      expect(getPoolVRAM('HoO pOoL')).toBe(80);
    });
  });

  describe('getGPUSpec', () => {
    it('should return H100 spec for matching name', () => {
      const spec = getGPUSpec('H100');
      expect(spec).not.toBeNull();
      expect(spec!.vramGb).toBe(80);
      expect(spec!.name).toBe('H100');
      expect(spec!.architecture).toBe('Hopper');
      expect(spec!.tensorCores).toBe(true);
    });

    it('should return A100 spec for matching name', () => {
      const spec = getGPUSpec('A100');
      expect(spec).not.toBeNull();
      expect(spec!.vramGb).toBe(80); // Default A100 is 80GB
      expect(spec!.architecture).toBe('Ampere');
    });

    it('should return RTX 4090 spec for matching name', () => {
      const spec = getGPUSpec('RTX 4090');
      expect(spec).not.toBeNull();
      expect(spec!.vramGb).toBe(24);
      expect(spec!.architecture).toBe('Ada Lovelace');
    });

    it('should return B200 spec for matching name', () => {
      const spec = getGPUSpec('B200');
      expect(spec).not.toBeNull();
      expect(spec!.vramGb).toBe(192);
      expect(spec!.architecture).toBe('Blackwell');
    });

    it('should return H200 spec for matching name', () => {
      const spec = getGPUSpec('H200');
      expect(spec).not.toBeNull();
      expect(spec!.vramGb).toBe(141);
      expect(spec!.architecture).toBe('Hopper');
    });

    it('should match GPU name with extra text', () => {
      expect(getGPUSpec('NVIDIA H100 SXM')).not.toBeNull();
      expect(getGPUSpec('H100 Pool Server 1')).not.toBeNull();
      expect(getGPUSpec('Enterprise A100 40GB')).not.toBeNull();
    });

    it('should return null for unknown GPU name', () => {
      expect(getGPUSpec('Unknown GPU')).toBeNull();
      expect(getGPUSpec('Generic Card')).toBeNull();
      expect(getGPUSpec('CPU')).toBeNull();
    });

    it('should be case insensitive', () => {
      expect(getGPUSpec('h100')).not.toBeNull();
      expect(getGPUSpec('H100')).not.toBeNull();
      expect(getGPUSpec('H100')).not.toBeNull(); // Changed from 'HoOo' which isn't valid
    });
  });

  describe('checkVRAMCompatibility', () => {
    it('should return compatible for model within single GPU VRAM', () => {
      const result = checkVRAMCompatibility(70, 'H100 Pool', 1);

      expect(result.compatible).toBe(true);
      expect(result.poolVram).toBe(80);
      expect(result.totalVram).toBe(80);
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should return incompatible when model exceeds single GPU VRAM', () => {
      const result = checkVRAMCompatibility(100, 'H100 Pool', 1);

      expect(result.compatible).toBe(false);
      expect(result.poolVram).toBe(80);
      expect(result.totalVram).toBe(80);
      expect(result.minGpusNeeded).toBe(2);
    });

    it('should return compatible with multiple GPUs', () => {
      const result = checkVRAMCompatibility(150, 'H100 Pool', 2);

      expect(result.compatible).toBe(true);
      expect(result.poolVram).toBe(80);
      expect(result.totalVram).toBe(160);
      expect(result.minGpusNeeded).toBe(2);
    });

    it('should calculate minimum GPUs needed correctly', () => {
      const result = checkVRAMCompatibility(200, 'H100 Pool', 1);

      expect(result.minGpusNeeded).toBe(3); // 200 / 80 = 2.5 -> 3
    });

    it('should handle exact VRAM requirement', () => {
      const result = checkVRAMCompatibility(80, 'H100 Pool', 1);

      expect(result.compatible).toBe(true);
      expect(result.totalVram).toBe(80);
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle A100 40GB pool', () => {
      const result = checkVRAMCompatibility(35, 'A100 40GB Pool', 1);

      expect(result.compatible).toBe(true);
      expect(result.poolVram).toBe(40);
      expect(result.totalVram).toBe(40);
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle B200 pool with high VRAM', () => {
      const result = checkVRAMCompatibility(180, 'B200 Pool', 1);

      expect(result.compatible).toBe(true);
      expect(result.poolVram).toBe(192);
      expect(result.totalVram).toBe(192);
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle default GPU count of 1', () => {
      const result = checkVRAMCompatibility(70, 'H100 Pool');

      expect(result.totalVram).toBe(80);
      expect(result.compatible).toBe(true);
    });

    it('should handle large GPU counts', () => {
      const result = checkVRAMCompatibility(500, 'H100 Pool', 8);

      expect(result.compatible).toBe(true);
      expect(result.totalVram).toBe(640); // 80 * 8
      expect(result.minGpusNeeded).toBe(7); // 500 / 80 = 6.25 -> 7
    });

    it('should handle zero VRAM requirement', () => {
      const result = checkVRAMCompatibility(0, 'H100 Pool', 1);

      expect(result.compatible).toBe(true);
      expect(result.minGpusNeeded).toBe(0);
    });
  });

  describe('getCompatibilityMessage', () => {
    it('should return compatible status for model within single GPU', () => {
      const result = getCompatibilityMessage(70, 'H100 Pool');

      expect(result.status).toBe('compatible');
      expect(result.message).toBe('Compatible with H100 Pool');
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should return needs_multi_gpu status when multiple GPUs needed', () => {
      const result = getCompatibilityMessage(150, 'H100 Pool');

      expect(result.status).toBe('needs_multi_gpu');
      expect(result.message).toContain('Requires 2x H100 Pool');
      expect(result.message).toContain('160GB VRAM');
      expect(result.minGpusNeeded).toBe(2);
    });

    it('should return incompatible when exceeding max GPU count', () => {
      const result = getCompatibilityMessage(800, 'H100 Pool', 8);

      expect(result.status).toBe('incompatible');
      expect(result.message).toContain('Requires 800GB VRAM');
      expect(result.message).toContain('exceeds available capacity');
      expect(result.minGpusNeeded).toBe(10); // 800 / 80
    });

    it('should handle exact VRAM match', () => {
      const result = getCompatibilityMessage(80, 'H100 Pool');

      expect(result.status).toBe('compatible');
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should calculate multi-GPU message correctly for A100 40GB', () => {
      const result = getCompatibilityMessage(100, 'A100 40GB Pool');

      expect(result.status).toBe('needs_multi_gpu');
      expect(result.message).toContain('Requires 3x A100 40GB Pool');
      expect(result.message).toContain('120GB VRAM');
      expect(result.minGpusNeeded).toBe(3); // 100 / 40 = 2.5 -> 3
    });

    it('should handle B200 with large VRAM', () => {
      const result = getCompatibilityMessage(180, 'B200 Pool');

      expect(result.status).toBe('compatible');
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle custom max GPU count', () => {
      const result = getCompatibilityMessage(500, 'H100 Pool', 4);

      expect(result.status).toBe('incompatible');
      expect(result.minGpusNeeded).toBe(7); // 500 / 80 = 6.25 -> 7
    });

    it('should handle H200 with 141GB VRAM', () => {
      const result = getCompatibilityMessage(140, 'H200 Pool');

      expect(result.status).toBe('compatible');
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle RTX 3090 with 24GB VRAM', () => {
      const result = getCompatibilityMessage(20, 'RTX 3090 Pool');

      expect(result.status).toBe('compatible');
      expect(result.minGpusNeeded).toBe(1);
    });

    it('should handle multi-GPU for consumer cards', () => {
      const result = getCompatibilityMessage(50, 'RTX 4090 Pool');

      expect(result.status).toBe('needs_multi_gpu');
      expect(result.message).toContain('Requires 3x RTX 4090 Pool');
      expect(result.minGpusNeeded).toBe(3); // 50 / 24 = 2.08 -> 3
    });
  });

  describe('Memory Calculations', () => {
    it('should calculate total VRAM for multi-GPU setup', () => {
      const gpuVram = 80;
      const gpuCount = 4;
      const totalVram = gpuVram * gpuCount;

      expect(totalVram).toBe(320);
    });

    it('should calculate minimum GPUs needed rounding up', () => {
      expect(Math.ceil(100 / 80)).toBe(2);
      expect(Math.ceil(80 / 80)).toBe(1);
      expect(Math.ceil(79 / 80)).toBe(1);
      expect(Math.ceil(161 / 80)).toBe(3);
    });

    it('should handle fractional VRAM requirements', () => {
      const requiredVram = 75.5;
      const poolVram = 80;
      const minGpus = Math.ceil(requiredVram / poolVram);

      expect(minGpus).toBe(1);
    });
  });

  describe('GPU Comparisons', () => {
    it('should compare VRAM between GPU models', () => {
      const h100Vram = GPU_SPECS['H100'].vramGb;
      const a100Vram = GPU_SPECS['A100 40GB'].vramGb;

      expect(h100Vram).toBeGreaterThan(a100Vram);
      expect(h100Vram).toBe(80);
      expect(a100Vram).toBe(40);
    });

    it('should identify Blackwell generation as having most VRAM', () => {
      const b200Vram = GPU_SPECS['B200'].vramGb;
      const h100Vram = GPU_SPECS['H100'].vramGb;
      const a100Vram = GPU_SPECS['A100 80GB'].vramGb;

      expect(b200Vram).toBeGreaterThan(h100Vram);
      expect(b200Vram).toBeGreaterThan(a100Vram);
      expect(b200Vram).toBe(192);
    });

    it('should identify H200 as having more VRAM than H100', () => {
      const h200Vram = GPU_SPECS['H200'].vramGb;
      const h100Vram = GPU_SPECS['H100'].vramGb;

      expect(h200Vram).toBeGreaterThan(h100Vram);
      expect(h200Vram).toBe(141);
      expect(h100Vram).toBe(80);
    });

    it('should compare consumer vs datacenter VRAM', () => {
      const rtx4090Vram = GPU_SPECS['RTX 4090'].vramGb;
      const a100Vram = GPU_SPECS['A100 40GB'].vramGb;

      expect(a100Vram).toBeGreaterThan(rtx4090Vram);
    });
  });

  describe('Architecture Information', () => {
    it('should identify Hopper architecture GPUs', () => {
      expect(GPU_SPECS['H100'].architecture).toBe('Hopper');
      expect(GPU_SPECS['H100 SXM'].architecture).toBe('Hopper');
      expect(GPU_SPECS['H100 PCIe'].architecture).toBe('Hopper');
      expect(GPU_SPECS['H200'].architecture).toBe('Hopper');
    });

    it('should identify Ampere architecture GPUs', () => {
      expect(GPU_SPECS['A100 40GB'].architecture).toBe('Ampere');
      expect(GPU_SPECS['A100 80GB'].architecture).toBe('Ampere');
      expect(GPU_SPECS['RTX 3090'].architecture).toBe('Ampere');
    });

    it('should identify Blackwell architecture GPUs', () => {
      expect(GPU_SPECS['B200'].architecture).toBe('Blackwell');
      expect(GPU_SPECS['B100'].architecture).toBe('Blackwell');
    });

    it('should identify Ada Lovelace architecture GPUs', () => {
      expect(GPU_SPECS['RTX 4090'].architecture).toBe('Ada Lovelace');
    });
  });
});
