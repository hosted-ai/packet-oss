/**
 * GPU Apps - Type definitions
 *
 * Shared types for GPU application definitions.
 *
 * @module lib/gpu-apps/apps/types
 */

export interface GpuAppDefinition {
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: "development" | "inference" | "training" | "creative";

  // Resource requirements
  minVramGb: number;
  recommendedVramGb: number;
  typicalVramUsageGb?: number;

  // Installation
  estimatedInstallMin: number;
  installScript: string; // The actual bash script

  // Service info
  defaultPort?: number;
  webUiPort?: number;
  serviceType?: "http" | "tcp";

  // Display
  icon: string;
  badgeText?: string;
  displayOrder: number;
  tags: string[];

  // Docs
  docsUrl?: string;
  version?: string;
}

/**
 * Common preamble for all install scripts to handle haishare/vllm-wrapper python interception
 */
export const SCRIPT_PREAMBLE = `#!/bin/bash
set -e

# Helper: Get real python path (avoid haishare/vllm-wrapper interception)
get_real_python() {
  if [ -f /usr/bin/python.real.3.12 ]; then
    echo "/usr/bin/python.real.3.12"
  elif [ -f /usr/bin/python3.12 ] && [ ! -L /usr/bin/python3.12 ]; then
    echo "/usr/bin/python3.12"
  else
    echo "python3"
  fi
}
REAL_PYTHON=$(get_real_python)

# Helper: Create venv and fix symlinks to use real python
create_venv() {
  local venv_path="$1"
  $REAL_PYTHON -m venv "$venv_path"
  # Fix symlinks to point to real python (avoids vllm-wrapper issues)
  if [ -f /usr/bin/python.real.3.12 ]; then
    rm -f "$venv_path/bin/python" "$venv_path/bin/python3" "$venv_path/bin/python3.12" 2>/dev/null || true
    ln -sf /usr/bin/python.real.3.12 "$venv_path/bin/python"
    ln -sf /usr/bin/python.real.3.12 "$venv_path/bin/python3"
    ln -sf /usr/bin/python.real.3.12 "$venv_path/bin/python3.12"
  fi
}

`;
