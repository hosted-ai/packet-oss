# B6000 GPU Sharing Validation Plan

## Overview

Before launching to customers, we need to validate HAIShare's GPU sharing behavior on the NVIDIA RTX PRO 6000 Blackwell Server Edition (96GB VRAM per GPU, 8 GPUs total = 768GB VRAM).

**Test Environment:**
- Cluster 18 (us-west-1 / Santa Clara)
- Node: Bluesky001 (node_id: 44)
- 8x NVIDIA RTX PRO 6000 Blackwell (96GB VRAM each)
- 4 pools configured with sharing_ratio: 2

---

## Test Scenarios

### Test 1: Single Team Full VRAM Utilization

**Objective:** Validate a single team can consistently use close to full 96GB VRAM

**Setup:**
- 1 team, 1 pod on a dedicated pool
- vGPU count: 1 (full GPU access)

**Test Steps:**
1. Deploy a pod with PyTorch/CUDA workload
2. Run VRAM stress test script that allocates incrementally:
   - 25GB, 50GB, 75GB, 90GB, 95GB
3. Monitor stability at each level for 10+ minutes
4. Run actual ML workload (large model inference) near capacity

**Success Criteria:**
- [ ] Can allocate 90GB+ VRAM without errors
- [ ] Workload runs stable for 30+ minutes at high utilization
- [ ] No OOM kills or pod restarts
- [ ] GPU metrics accurately reflect usage

**Measurements:**
- Max stable VRAM allocation
- Time to OOM (if any)
- Performance consistency (TFLOPs)

---

### Test 2: Spatial Mode - Two Teams < 96GB Combined

**Objective:** Validate 2 teams sharing 1 GPU spatially when combined VRAM < 96GB

**Setup:**
- 2 teams on same pool (sharing_ratio: 2)
- Pool type: Spatial mode
- Each team requests ~40GB VRAM (80GB total < 96GB)

**Test Steps:**
1. Deploy Team A pod, allocate 40GB VRAM
2. Deploy Team B pod, allocate 40GB VRAM
3. Both run concurrent workloads for 30+ minutes
4. Monitor:
   - Memory isolation between pods
   - Performance impact on each pod
   - GPU utilization metrics

**Success Criteria:**
- [ ] Both pods coexist without memory conflicts
- [ ] Each pod maintains stable VRAM allocation
- [ ] Performance degradation < 50% vs single-tenant
- [ ] No cross-pod memory leaks

**Measurements:**
- Individual pod VRAM usage
- Combined GPU memory utilization
- TFLOPs per pod vs baseline
- Latency variance

---

### Test 3: Spatial-to-Temporal Auto-Switch (>96GB Combined)

**Objective:** Validate HAIShare auto-switches to temporal mode when combined VRAM > 96GB

**Setup:**
- 2 teams on spatial pool (sharing_ratio: 2)
- Each team requests 60GB VRAM (120GB total > 96GB)

**Test Steps:**
1. Deploy Team A pod, allocate 60GB VRAM
2. Confirm spatial mode active
3. Deploy Team B pod, allocate 60GB VRAM
4. Observe mode switch to temporal
5. Monitor time-slicing behavior:
   - Context switch frequency
   - Memory swapping to system RAM
   - Performance characteristics

**Success Criteria:**
- [ ] Mode switches automatically without manual intervention
- [ ] Both pods continue functioning after switch
- [ ] Time slicing occurs at configured quantum (90 seconds)
- [ ] No data corruption during context switches

**Measurements:**
- Time to detect overcommit
- Mode switch latency
- Context switch overhead
- System RAM usage for swap

---

### Test 4: Temporal Pool - Variable VRAM (up to 96GB each)

**Objective:** Validate dedicated temporal pool with 2 teams using up to 96GB each

**Setup:**
- 2 teams on temporal-only pool
- time_quantum_in_sec: 90
- Each team allocated full 96GB potential

**Test Steps:**
1. Deploy Team A pod, allocate 96GB VRAM
2. Deploy Team B pod, allocate 96GB VRAM
3. Both run workloads requiring full memory
4. Monitor time-slicing:
   - Swap-out/swap-in cycles
   - System RAM consumption
   - Performance during active slice

**Success Criteria:**
- [ ] Both pods function with 96GB allocation each
- [ ] Time slicing works at 90-second quantum
- [ ] Active pod gets full GPU performance during slice
- [ ] Inactive pod memory properly swapped out

**Measurements:**
- System RAM usage per pod (swap space)
- Time slice accuracy (90s target)
- Performance during active window
- Swap latency (time to context switch)

---

### Test 5: Stress Test - 16 Pods Ramping VRAM

**Objective:** Find thresholds and failure modes when scaling to 16 active pods

**Setup:**
- 8 GPUs x sharing_ratio 2 = 16 potential pods
- Temporal mode on all pools
- System RAM baseline: TBD (check node specs)

**Test Phases:**

#### Phase 5a: Baseline (16 pods, minimal VRAM)
1. Deploy 16 pods across 8 GPUs
2. Each pod uses 10GB VRAM
3. Verify all pods stable

#### Phase 5b: Moderate Load (16 pods, 50% VRAM)
1. Increase each pod to 48GB VRAM
2. Total: 768GB across 768GB physical
3. Monitor time-slicing overhead

#### Phase 5c: Overcommit (16 pods, 75% VRAM)
1. Increase each pod to 72GB VRAM
2. Total: 1,152GB vs 768GB physical (1.5x overcommit)
3. Monitor system RAM swap usage

#### Phase 5d: Heavy Overcommit (16 pods, 96GB VRAM)
1. Increase each pod to 96GB VRAM
2. Total: 1,536GB vs 768GB physical (2x overcommit)
3. Find failure threshold

**Key Questions to Answer:**
- [ ] What is the system RAM requirement per GB of VRAM overcommit?
- [ ] At what overcommit ratio does HAIShare fail?
- [ ] What is the failure mode (OOM, pod eviction, corruption)?
- [ ] Does HAIShare degrade gracefully or catastrophically?
- [ ] What are the performance characteristics at various overcommit levels?

**Success Criteria:**
- [ ] Document exact failure threshold
- [ ] Understand failure mode and recovery
- [ ] Identify safe operational limits
- [ ] Confirm monitoring/alerts detect issues

**Measurements:**
- System RAM total and per-pod swap
- GPU memory pressure
- Pod health status
- Time slice delays/backlogs
- Error logs and failure modes

---

## Test Infrastructure

### VRAM Stress Test Script

```python
#!/usr/bin/env python3
"""
GPU VRAM stress test for HAIShare validation.
Allocates incrementing VRAM and monitors stability.
"""
import torch
import time
import argparse

def allocate_vram(gb: float) -> torch.Tensor:
    """Allocate specified GB of VRAM"""
    elements = int(gb * 1024 * 1024 * 1024 / 4)  # float32 = 4 bytes
    return torch.zeros(elements, dtype=torch.float32, device='cuda')

def stress_test(target_gb: float, duration_minutes: int = 10):
    print(f"Allocating {target_gb}GB VRAM...")
    tensor = allocate_vram(target_gb)

    # Verify allocation
    allocated = torch.cuda.memory_allocated() / (1024**3)
    print(f"Allocated: {allocated:.2f}GB")

    # Keep alive and monitor
    start = time.time()
    while (time.time() - start) < (duration_minutes * 60):
        # Do some work to keep memory active
        tensor += 0.0001
        torch.cuda.synchronize()

        elapsed = (time.time() - start) / 60
        print(f"Running... {elapsed:.1f}/{duration_minutes} minutes", end='\r')
        time.sleep(1)

    print(f"\nCompleted {duration_minutes} minutes stable")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--gb", type=float, required=True, help="GB to allocate")
    parser.add_argument("--minutes", type=int, default=10, help="Duration")
    args = parser.parse_args()

    stress_test(args.gb, args.minutes)
```

### Monitoring Commands

```bash
# Watch GPU memory usage
watch -n 1 nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv

# Watch system RAM
watch -n 1 free -h

# Monitor pod status (from admin)
curl -s https://YOUR_DOMAIN/api/admin/pods | jq '.pods[] | {name: .podName, status: .status, vgpu: .vgpuCount}'
```

---

## Execution Checklist

### Pre-Testing
- [ ] Document node system RAM (for swap capacity)
- [ ] Verify all 4 pools configured correctly
- [ ] Confirm sharing_ratio and time_quantum settings
- [ ] Prepare test teams/accounts
- [ ] Set up monitoring dashboards

### Test Execution
- [ ] Test 1: Single team full VRAM
- [ ] Test 2: Spatial mode (2 teams < 96GB)
- [ ] Test 3: Spatial-to-temporal switch
- [ ] Test 4: Temporal mode (2 teams @ 96GB each)
- [ ] Test 5a: 16 pods baseline
- [ ] Test 5b: 16 pods moderate
- [ ] Test 5c: 16 pods overcommit
- [ ] Test 5d: 16 pods max (find threshold)

### Post-Testing
- [ ] Document all measurements
- [ ] Identify operational limits
- [ ] Define monitoring thresholds
- [ ] Create customer-facing guidelines
- [ ] Update pool configurations if needed

---

## Results Template

| Test | Status | Max Stable VRAM | Failure Mode | Notes |
|------|--------|-----------------|--------------|-------|
| 1    |        |                 |              |       |
| 2    |        |                 |              |       |
| 3    |        |                 |              |       |
| 4    |        |                 |              |       |
| 5a   |        |                 |              |       |
| 5b   |        |                 |              |       |
| 5c   |        |                 |              |       |
| 5d   |        |                 |              |       |

---

## Questions for HAIShare/GPUaaS Team

1. What is the recommended system RAM per GB of VRAM overcommit?
2. Is there a hard limit on overcommit ratio?
3. How does HAIShare handle OOM conditions?
4. Can we configure swap priority between pods?
5. What metrics indicate impending failure?
