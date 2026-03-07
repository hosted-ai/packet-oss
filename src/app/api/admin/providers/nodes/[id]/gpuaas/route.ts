/**
 * GPUaaS Node Provisioning API
 *
 * Admin endpoints for managing provider nodes in the GPUaaS Admin system.
 * Handles node registration, SSH key generation, initialization, and pool assignment.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  gpuaasAdmin,
  type Region,
  type GPUaaSCluster,
} from "@/lib/gpuaas-admin";

const execAsync = promisify(exec);

const registerNodeSchema = z.object({
  action: z.enum([
    "validate",       // SSH in, detect GPUs and system specs
    "register",       // Register node with GPUaaS Admin API
    "get-ssh-keys",   // Get SSH keys to install on node
    "install-ssh-key", // Auto-install SSH key using password
    "mark-ssh-done",  // Mark SSH keys as installed
    "initialize",     // Start node initialization
    "check-status",   // Check initialization status
    "join-cluster",   // Join node to cluster (for workers)
    "scan-gpus",      // Scan for GPUs on node
    "scan-resources", // Scan for CPU/RAM/Storage resources
    "assign-pool",    // Assign node to a pool
  ]),
  regionId: z.number().optional(),
  externalServiceIp: z.string().optional(),
  poolId: z.number().optional(),
  isController: z.boolean().optional(),
  isWorker: z.boolean().optional(),
  isGateway: z.boolean().optional(),
  isStorage: z.boolean().optional(),
  sshPassword: z.string().optional(), // For install-ssh-key action
});

// GPUaaS Admin public key that needs to be installed on provider nodes
const GPUAAS_PUBLIC_KEY = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0DbUfXcq06kU6O+xAKW/BhRyrAQfUmLWHHNMTKLzWfHhko15sMK7sYHeNTc1gwQHTpJiPsIVR34E3Vd4mRvBQMeEviJJjoH4Kh/QDlnFNpzE4KGN5RR5vgLvxp6CCMNxqcsNOk4x4oE34Lwf2qHmoTvbBGjWhXkMB7FHtmisHWEy+QOc6fAyMQf3wL4tEL9YfoCHaqJIrUA1+aGKk12zj+/sQS0Nqp6uGUh5b1j8dM8XzOUifFg403R0maSyq+VCfMa/3xdaOuI4F5VO7f1dP+vEXdZMBJSXtSg6YJMOeinbEpEn6CrWXz6zqsx4/8itqzbto+B//rrfTv7lTSZpJ";

/**
 * GET /api/admin/providers/nodes/[id]/gpuaas
 * Get GPUaaS status and available regions/clusters
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get node from database
    const node = await prisma.providerNode.findUnique({
      where: { id },
      include: {
        provider: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    // Get available regions and clusters from GPUaaS Admin API
    let regions: Region[] = [];
    let clusters: GPUaaSCluster[] = [];
    let gpuaasError: string | null = null;

    try {
      regions = await gpuaasAdmin.listRegions();
      clusters = await gpuaasAdmin.listClusters();
    } catch (err) {
      console.error("GPUaaS Admin API error:", err);
      gpuaasError = err instanceof Error ? err.message : "Failed to fetch GPUaaS data";
    }

    // Get node status from GPUaaS if registered
    let gpuaasNodeStatus = null;
    if (node.gpuaasNodeId) {
      try {
        const gpuaasNode = await gpuaasAdmin.getNode(node.gpuaasNodeId);
        gpuaasNodeStatus = {
          id: gpuaasNode.Id,
          name: gpuaasNode.name,
          initStatus: gpuaasNode.initialize_state_status_code,
          initStatusLabel: getInitStatusLabel(gpuaasNode.initialize_state_status_code),
          role: gpuaasNode.role,
        };
      } catch {
        // Node might not exist in GPUaaS anymore
        gpuaasNodeStatus = { error: "Node not found in GPUaaS" };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        node: {
          id: node.id,
          hostname: node.hostname,
          ipAddress: node.ipAddress,
          sshPort: node.sshPort,
          sshUsername: node.sshUsername,
          externalServiceIp: node.externalServiceIp,
          gpuaasNodeId: node.gpuaasNodeId,
          gpuaasRegionId: node.gpuaasRegionId,
          gpuaasClusterId: node.gpuaasClusterId,
          gpuaasPoolId: node.gpuaasPoolId,
          gpuaasInitStatus: node.gpuaasInitStatus,
          gpuaasSshKeysInstalled: node.gpuaasSshKeysInstalled,
          status: node.status,
          provider: node.provider,
        },
        gpuaasNodeStatus,
        regions: regions.map((r) => ({
          id: r.id,
          name: r.region_name,
          city: r.city,
          country: r.country,
          gpuaasEnabled: gpuaasAdmin.isGPUaaSEnabled(r),
        })),
        clusters: clusters.map((c) => ({
          id: c.id,
          regionId: c.region_id,
          status: c.status,
          statusLabel: gpuaasAdmin.getClusterStatusLabel(c.status),
        })),
        gpuaasError,
      },
    });
  } catch (error) {
    console.error("Get GPUaaS node status error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get GPUaaS status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/providers/nodes/[id]/gpuaas
 * Perform GPUaaS provisioning actions
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = registerNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, regionId, externalServiceIp, poolId, isController, isWorker, isGateway, isStorage, sshPassword } = parsed.data;

    // Get node from database
    const node = await prisma.providerNode.findUnique({
      where: { id },
      include: {
        provider: {
          select: {
            companyName: true,
          },
        },
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    let result: Record<string, unknown> = {};
    let updateData: Record<string, unknown> = {};

    switch (action) {
      case "validate": {
        // Validate server by SSHing in and detecting specs
        if (!sshPassword) {
          return NextResponse.json(
            { success: false, error: "SSH password is required for validation" },
            { status: 400 }
          );
        }

        const escapedPassword = sshPassword.replace(/'/g, "'\\''");
        const sshHost = `${node.sshUsername}@${node.ipAddress}`;
        const sshPort = node.sshPort || 22;

        // Detection script that runs on the server
        // Falls back to lspci if nvidia-smi is not available (drivers not installed yet)
        const detectScript = `
          echo "=== GPU_INFO ==="
          if command -v nvidia-smi &> /dev/null; then
            nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"
          else
            lspci 2>/dev/null | grep -i nvidia | sed 's/.*: //' || echo "NO_GPU"
          fi
          echo "=== CPU_INFO ==="
          cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | xargs
          echo "=== CPU_CORES ==="
          nproc
          echo "=== RAM_GB ==="
          free -g | awk '/^Mem:/{print $2}'
          echo "=== STORAGE_GB ==="
          df -BG / | tail -1 | awk '{print $2}' | sed 's/G//'
          echo "=== OS_VERSION ==="
          cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"'
          echo "=== HOSTNAME ==="
          hostname
        `;

        const sshCommand = `sshpass -p '${escapedPassword}' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=30 -p ${sshPort} ${sshHost} "${detectScript.replace(/\n/g, " ").replace(/"/g, '\\"')}"`;

        try {
          const { stdout, stderr } = await execAsync(sshCommand, { timeout: 60000 });

          // Parse the output
          const output = stdout || stderr;
          const lines = output.split("\n");

          let gpuModel: string | null = null;
          let gpuCount = 0;
          let cpuModel: string | null = null;
          let cpuCores: number | null = null;
          let ramGb: number | null = null;
          let storageGb: number | null = null;
          let osVersion: string | null = null;
          let hostname: string | null = null;

          let section = "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("=== ")) {
              section = trimmed.replace(/=== /g, "").replace(/ ===/g, "");
              continue;
            }
            if (!trimmed) continue;

            switch (section) {
              case "GPU_INFO":
                if (trimmed !== "NO_GPU") {
                  // Parse nvidia-smi output: "Tesla V100-SXM2-16GB, 16384"
                  // OR lspci output: "NVIDIA Corporation TU104GL [Tesla T4] (rev a1)"
                  if (trimmed.includes(",")) {
                    // nvidia-smi format
                    const parts = trimmed.split(",").map(p => p.trim());
                    if (parts.length >= 1 && parts[0]) {
                      gpuModel = parts[0];
                      gpuCount++;
                    }
                  } else if (trimmed.includes("NVIDIA") || trimmed.includes("Tesla") || trimmed.includes("GeForce")) {
                    // lspci format - extract the GPU name from brackets if present
                    const bracketMatch = trimmed.match(/\[([^\]]+)\]/);
                    if (bracketMatch) {
                      gpuModel = bracketMatch[1];
                    } else {
                      // Try to extract the model name after the corporation name
                      gpuModel = trimmed.replace(/NVIDIA Corporation\s*/i, "").replace(/\s*\(rev.*\)/, "").trim();
                    }
                    gpuCount++;
                  }
                }
                break;
              case "CPU_INFO":
                cpuModel = trimmed;
                break;
              case "CPU_CORES":
                cpuCores = parseInt(trimmed) || null;
                break;
              case "RAM_GB":
                ramGb = parseInt(trimmed) || null;
                break;
              case "STORAGE_GB":
                storageGb = parseInt(trimmed) || null;
                break;
              case "OS_VERSION":
                osVersion = trimmed;
                break;
              case "HOSTNAME":
                hostname = trimmed;
                break;
            }
          }

          // Determine validation status
          const hasGpu = gpuModel && gpuModel !== "NO_GPU" && gpuCount > 0;

          updateData = {
            gpuModel: hasGpu ? gpuModel : null,
            gpuCount: hasGpu ? gpuCount : null,
            cpuModel,
            cpuCores,
            ramGb,
            storageGb,
            osVersion,
            hostname: hostname || node.hostname,
            status: hasGpu ? "pending_approval" : "validation_failed",
            statusMessage: hasGpu
              ? `Validated: ${gpuCount}x ${gpuModel}`
              : "Validation failed: No GPU detected",
            validatedAt: new Date(),
          };

          result = {
            success: hasGpu,
            message: hasGpu
              ? `Server validated successfully. Detected ${gpuCount}x ${gpuModel}`
              : "No GPU detected on server",
            specs: {
              gpuModel,
              gpuCount,
              cpuModel,
              cpuCores,
              ramGb,
              storageGb,
              osVersion,
              hostname,
            },
            rawOutput: output,
          };
        } catch (execError) {
          const errorMessage = execError instanceof Error ? execError.message : "SSH connection failed";
          console.error("Server validation failed:", errorMessage);

          // Update node with validation error
          await prisma.providerNode.update({
            where: { id },
            data: {
              status: "validation_failed",
              statusMessage: `Validation failed: ${errorMessage.slice(0, 200)}`,
              validationError: errorMessage,
            },
          });

          return NextResponse.json(
            { success: false, error: `Failed to validate server: ${errorMessage}` },
            { status: 500 }
          );
        }
        break;
      }

      case "register": {
        // Register node with GPUaaS Admin API
        if (!regionId) {
          return NextResponse.json(
            { success: false, error: "Region ID is required" },
            { status: 400 }
          );
        }
        if (!externalServiceIp) {
          return NextResponse.json(
            { success: false, error: "External service IP is required" },
            { status: 400 }
          );
        }

        // Create name from provider company + hostname
        const nodeName = `${node.provider.companyName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${node.hostname || node.ipAddress}`.slice(0, 50);

        const gpuaasNode = await gpuaasAdmin.addNode({
          name: nodeName,
          region_id: regionId,
          node_ip: node.ipAddress,
          username: node.sshUsername,
          port: node.sshPort,
          external_service_ip: externalServiceIp,
          is_controller_node: isController ?? false,
          is_worker_node: isWorker ?? true,
          is_gateway_service: isGateway ?? false,
          is_storage_service: isStorage ?? false,
        });

        // Get the cluster for this region
        const cluster = await gpuaasAdmin.getClusterByRegion(regionId);

        updateData = {
          gpuaasNodeId: gpuaasNode.Id,
          gpuaasRegionId: regionId,
          gpuaasClusterId: cluster?.id || null,
          gpuaasInitStatus: "not_init",
          externalServiceIp,
          status: "provisioning",
          statusMessage: "Node registered with GPUaaS, waiting for SSH key installation",
        };

        result = {
          gpuaasNodeId: gpuaasNode.Id,
          message: "Node registered with GPUaaS Admin. Next: Get SSH keys and install them on the node.",
        };
        break;
      }

      case "get-ssh-keys": {
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }

        const sshKeys = await gpuaasAdmin.getNodeSSHKeys(node.gpuaasNodeId);
        result = {
          publicKeys: sshKeys.public_keys,
          instructions: "Add these public keys to the node's ~/.ssh/authorized_keys file for the SSH user.",
        };
        break;
      }

      case "install-ssh-key": {
        // Auto-install SSH key using password authentication
        if (!sshPassword) {
          return NextResponse.json(
            { success: false, error: "SSH password is required" },
            { status: 400 }
          );
        }

        // Escape special characters in password for shell
        const escapedPassword = sshPassword.replace(/'/g, "'\\''");

        // Build the SSH command to install the key
        // The command:
        // 1. Creates .ssh directory if it doesn't exist
        // 2. Creates authorized_keys if it doesn't exist
        // 3. Appends the public key if not already present
        const sshHost = `${node.sshUsername}@${node.ipAddress}`;
        const sshPort = node.sshPort || 22;

        // Command to install the SSH key idempotently
        const installKeyCommand = `
          mkdir -p ~/.ssh && chmod 700 ~/.ssh && \\
          touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \\
          grep -qF "${GPUAAS_PUBLIC_KEY}" ~/.ssh/authorized_keys || \\
          echo "${GPUAAS_PUBLIC_KEY}" >> ~/.ssh/authorized_keys && \\
          echo "SSH key installed successfully"
        `.replace(/\n/g, " ").trim();

        // Use sshpass to provide password (must be installed on the server)
        const fullCommand = `sshpass -p '${escapedPassword}' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${sshPort} ${sshHost} "${installKeyCommand}"`;

        try {
          const { stdout, stderr } = await execAsync(fullCommand, { timeout: 30000 });

          // Mark SSH keys as installed
          updateData = {
            gpuaasSshKeysInstalled: true,
            statusMessage: "SSH keys installed automatically",
          };

          result = {
            success: true,
            message: "SSH key installed successfully",
            output: stdout || stderr,
          };
        } catch (execError) {
          const errorMessage = execError instanceof Error ? execError.message : "SSH command failed";
          console.error("SSH key installation failed:", errorMessage);
          return NextResponse.json(
            { success: false, error: `Failed to install SSH key: ${errorMessage}` },
            { status: 500 }
          );
        }
        break;
      }

      case "mark-ssh-done": {
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }

        updateData = {
          gpuaasSshKeysInstalled: true,
          statusMessage: "SSH keys installed, ready for initialization",
        };
        result = {
          message: "SSH keys marked as installed. Next: Initialize the node.",
        };
        break;
      }

      case "initialize": {
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }
        if (!node.gpuaasSshKeysInstalled) {
          return NextResponse.json(
            { success: false, error: "SSH keys must be installed first" },
            { status: 400 }
          );
        }

        await gpuaasAdmin.initializeNode(node.gpuaasNodeId);

        updateData = {
          gpuaasInitStatus: "in_progress",
          statusMessage: "Node initialization in progress",
        };
        result = {
          message: "Node initialization started. Check status periodically until complete.",
        };
        break;
      }

      case "check-status": {
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }

        const gpuaasNode = await gpuaasAdmin.getNode(node.gpuaasNodeId);
        const initStatus = getInitStatus(gpuaasNode.initialize_state_status_code);

        updateData = {
          gpuaasInitStatus: initStatus,
        };

        if (initStatus === "completed") {
          updateData.statusMessage = "Node initialization complete";
        } else if (initStatus === "error") {
          updateData.statusMessage = "Node initialization failed";
        }

        result = {
          initStatusCode: gpuaasNode.initialize_state_status_code,
          initStatus,
          initStatusLabel: getInitStatusLabel(gpuaasNode.initialize_state_status_code),
          role: gpuaasNode.role,
        };
        break;
      }

      case "join-cluster": {
        if (!node.gpuaasNodeId || !node.gpuaasClusterId) {
          return NextResponse.json(
            { success: false, error: "Node must be registered and have a cluster assigned" },
            { status: 400 }
          );
        }
        if (node.gpuaasInitStatus !== "completed") {
          return NextResponse.json(
            { success: false, error: "Node must be initialized first" },
            { status: 400 }
          );
        }

        await gpuaasAdmin.joinNode({
          gpuaas_id: node.gpuaasClusterId,
          gpuaas_node_id: node.gpuaasNodeId,
        });

        updateData = {
          statusMessage: "Node joined to cluster",
        };
        result = {
          message: "Node joined to GPUaaS cluster successfully.",
        };
        break;
      }

      case "scan-gpus": {
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }

        const gpuScan = await gpuaasAdmin.scanGPUs(node.gpuaasNodeId);

        // Update node with detected GPU info
        if (gpuScan.gpus?.length > 0) {
          const firstGpu = gpuScan.gpus[0];
          updateData = {
            gpuModel: firstGpu.name,
            gpuCount: gpuScan.gpus.length,
          };
        }

        result = {
          gpus: gpuScan.gpus,
        };
        break;
      }

      case "scan-resources": {
        // Trigger a resource scan on the node and update local DB with results
        if (!node.gpuaasNodeId) {
          return NextResponse.json(
            { success: false, error: "Node not registered with GPUaaS" },
            { status: 400 }
          );
        }

        // First trigger the scan
        let scanTriggered = false;
        try {
          await gpuaasAdmin.scanNodeResources(node.gpuaasNodeId);
          scanTriggered = true;
        } catch (scanErr) {
          console.warn("Could not trigger resource scan:", scanErr);
        }

        // Wait a moment for the scan to complete
        if (scanTriggered) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Fetch the latest node details from GPUaaS
        const gpuaasNode = await gpuaasAdmin.getNode(node.gpuaasNodeId);

        const resourceUpdates: {
          ramGb?: number;
          storageGb?: number;
          cpuCores?: number;
          cpuModel?: string;
        } = {};

        if (gpuaasNode.total_memory_in_mb && gpuaasNode.total_memory_in_mb > 0) {
          resourceUpdates.ramGb = Math.round(gpuaasNode.total_memory_in_mb / 1024);
        }
        if (gpuaasNode.total_disk_in_mb && gpuaasNode.total_disk_in_mb > 0) {
          resourceUpdates.storageGb = Math.round(gpuaasNode.total_disk_in_mb / 1024);
        }
        if (gpuaasNode.cores && gpuaasNode.cores > 0) {
          resourceUpdates.cpuCores = gpuaasNode.cores;
        }
        if (gpuaasNode.cpu_model) {
          resourceUpdates.cpuModel = gpuaasNode.cpu_model;
        }

        if (Object.keys(resourceUpdates).length > 0) {
          updateData = resourceUpdates;
        }

        result = {
          scanTriggered,
          resources: {
            ramGb: resourceUpdates.ramGb || null,
            storageGb: resourceUpdates.storageGb || null,
            cpuCores: resourceUpdates.cpuCores || null,
            cpuModel: resourceUpdates.cpuModel || null,
          },
          raw: {
            total_memory_in_mb: gpuaasNode.total_memory_in_mb,
            total_disk_in_mb: gpuaasNode.total_disk_in_mb,
            cores: gpuaasNode.cores,
            cpu_model: gpuaasNode.cpu_model,
          },
          message: Object.keys(resourceUpdates).length > 0
            ? `Updated node resources: RAM ${resourceUpdates.ramGb}GB, Storage ${resourceUpdates.storageGb}GB, CPU ${resourceUpdates.cpuCores} cores`
            : "No resources detected from GPUaaS API (values are 0 or null)",
        };
        break;
      }

      case "assign-pool": {
        if (!poolId) {
          return NextResponse.json(
            { success: false, error: "Pool ID is required" },
            { status: 400 }
          );
        }

        // Verify pool exists
        const pool = await gpuaasAdmin.getPool(poolId);

        updateData = {
          gpuaasPoolId: poolId,
          status: "active",
          statusMessage: `Assigned to pool: ${pool.name}`,
        };

        result = {
          poolId,
          poolName: pool.name,
          message: "Node assigned to pool and is now active.",
        };
        break;
      }
    }

    // Update node in database if we have updates
    if (Object.keys(updateData).length > 0) {
      await prisma.providerNode.update({
        where: { id },
        data: updateData,
      });
    }

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: `gpuaas_${action}`,
        nodeId: id,
        details: JSON.stringify({ action, regionId, poolId }),
      },
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("GPUaaS action error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to perform GPUaaS action";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Convert GPUaaS init status code to string
 */
function getInitStatus(code: number): string {
  switch (code) {
    case 0:
      return "not_init";
    case 1:
      return "in_progress";
    case 2:
      return "completed";
    case -1:
      return "error";
    default:
      return "unknown";
  }
}

/**
 * Get human-readable init status label
 */
function getInitStatusLabel(code: number): string {
  switch (code) {
    case 0:
      return "Not Initialized";
    case 1:
      return "In Progress";
    case 2:
      return "Completed";
    case -1:
      return "Error";
    default:
      return "Unknown";
  }
}
