import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawn } from "child_process";
import { apiRequest, type ConnectionInfo } from "../api.js";
import { getApiKey } from "../config.js";

export interface SetupPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  script: string;
  estimatedMinutes: number;
  defaultPort?: number;
  portsToExpose?: Array<{ port: number; name: string }>;
}

export const SETUP_PRESETS: SetupPreset[] = [
  {
    id: "vscode",
    name: "VS Code in Browser",
    description: "code-server for browser-based development",
    icon: "\u{1F4BB}",
    estimatedMinutes: 2,
    defaultPort: 8080,
    portsToExpose: [{ port: 8080, name: "vscode" }],
    script: `#!/bin/bash
set -e
echo "=== Installing VS Code (code-server) ==="
if ! command -v code-server &> /dev/null; then
    echo "Installing code-server..."
    curl -fsSL https://code-server.dev/install.sh | sh
fi
pkill -f code-server 2>/dev/null || true
sleep 1
mkdir -p ~/.packet-logs
echo "Starting code-server..."
export PASSWORD=packet
nohup code-server --bind-addr 0.0.0.0:8080 --auth password > ~/.packet-logs/code-server.log 2>&1 &
sleep 3
if pgrep -f "code-server" > /dev/null; then
    echo "=== VS Code Ready ==="
    echo "Access at: http://<your-pod-ip>:8080"
    echo "Password: packet"
else
    echo "ERROR: code-server failed to start"
    cat ~/.packet-logs/code-server.log
    exit 1
fi`,
  },
  {
    id: "jupyter",
    name: "Jupyter Lab",
    description: "Interactive notebooks with GPU support",
    icon: "\u{1F4D3}",
    estimatedMinutes: 3,
    defaultPort: 8888,
    portsToExpose: [{ port: 8888, name: "jupyter" }],
    script: `#!/bin/bash
set -e
echo "=== Installing Jupyter Lab ==="
export PATH="$HOME/.local/bin:$PATH"
pip install --quiet jupyterlab numpy pandas matplotlib seaborn scikit-learn
pkill -f jupyter 2>/dev/null || true
sleep 1
mkdir -p /workspace 2>/dev/null || mkdir -p ~/workspace
mkdir -p ~/.packet-logs
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"
echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &
sleep 5
if pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null; then
    echo "=== Jupyter Lab Ready ==="
    echo "Access at: http://<your-pod-ip>:8888"
    echo "Token: packet"
else
    echo "ERROR: Jupyter Lab failed to start"
    cat ~/.packet-logs/jupyter.log
    exit 1
fi`,
  },
  {
    id: "jupyter-torch",
    name: "Jupyter + PyTorch",
    description: "Jupyter Lab with PyTorch and CUDA",
    icon: "\u{1F525}",
    estimatedMinutes: 5,
    defaultPort: 8888,
    portsToExpose: [{ port: 8888, name: "jupyter" }],
    script: `#!/bin/bash
set -e
echo "=== Installing Jupyter Lab with PyTorch ==="
export PATH="$HOME/.local/bin:$PATH"
pip install --quiet torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install --quiet jupyterlab numpy pandas matplotlib seaborn scikit-learn transformers accelerate
pkill -f jupyter 2>/dev/null || true
sleep 1
mkdir -p /workspace 2>/dev/null || mkdir -p ~/workspace
mkdir -p ~/.packet-logs
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"
echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &
sleep 5
if pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null; then
    echo "=== Jupyter + PyTorch Ready ==="
    echo "Access at: http://<your-pod-ip>:8888"
    echo "Token: packet"
else
    echo "ERROR: Jupyter Lab failed to start"
    cat ~/.packet-logs/jupyter.log
    exit 1
fi`,
  },
  {
    id: "workspace",
    name: "Persistent Workspace",
    description: "Set up /workspace directory for development",
    icon: "\u{1F4BE}",
    estimatedMinutes: 1,
    script: `#!/bin/bash
set -e
echo "=== Setting up Persistent Workspace ==="
if [ ! -d "/workspace" ]; then
    echo "/workspace not found - creating directory..."
    sudo mkdir -p /workspace 2>/dev/null || mkdir -p /workspace 2>/dev/null || {
        echo "Cannot create /workspace, using ~/workspace instead"
        mkdir -p ~/workspace
    }
fi
WORKSPACE_DIR="/workspace"
[ -d "/workspace" ] || WORKSPACE_DIR="$HOME/workspace"
mkdir -p "$WORKSPACE_DIR/home" 2>/dev/null || true
if [ ! -f "$WORKSPACE_DIR/home/.packet-init" ]; then
    echo "First run - copying home directory to workspace..."
    cp -r $HOME/. "$WORKSPACE_DIR/home/" 2>/dev/null || true
    touch "$WORKSPACE_DIR/home/.packet-init"
fi
if ! grep -q "packet-persist" ~/.bashrc 2>/dev/null; then
    echo '# packet-persist marker' >> ~/.bashrc
    echo "export PATH=\\"$WORKSPACE_DIR/bin:\\$PATH\\"" >> ~/.bashrc
    mkdir -p "$WORKSPACE_DIR/bin"
fi
echo "=== Persistent Workspace Ready ==="
echo "Workspace: $WORKSPACE_DIR"
echo "Your files in /workspace persist across restarts"`,
  },
  {
    id: "full-dev",
    name: "Full Dev Environment",
    description: "VS Code + Jupyter + Persistent workspace",
    icon: "\u{1F680}",
    estimatedMinutes: 5,
    defaultPort: 8080,
    portsToExpose: [
      { port: 8080, name: "vscode" },
      { port: 8888, name: "jupyter" },
    ],
    script: `#!/bin/bash
set -e
echo "=== Setting up Full Development Environment ==="
export PATH="$HOME/.local/bin:$PATH"
mkdir -p ~/.packet-logs
mkdir -p /workspace 2>/dev/null || mkdir -p ~/workspace
echo "Step 1/3: Setting up persistent workspace..."
if [ -d "/workspace" ]; then
    mkdir -p /workspace/home
    if [ ! -f "/workspace/home/.packet-init" ]; then
        cp -r $HOME/. /workspace/home/ 2>/dev/null || true
        touch /workspace/home/.packet-init
    fi
fi
echo "Step 2/3: Installing VS Code..."
if ! command -v code-server &> /dev/null; then
    curl -fsSL https://code-server.dev/install.sh | sh
fi
echo "Step 3/3: Installing Jupyter Lab..."
pip install --quiet jupyterlab numpy pandas matplotlib
pkill -f code-server 2>/dev/null || true
pkill -f jupyter 2>/dev/null || true
sleep 1
echo "Starting code-server..."
export PASSWORD=packet
nohup code-server --bind-addr 0.0.0.0:8080 --auth password > ~/.packet-logs/code-server.log 2>&1 &
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"
echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &
sleep 5
echo ""
echo "=== Full Dev Environment Ready ==="
pgrep -f "code-server" > /dev/null && echo "VS Code:    http://<pod-ip>:8080  (password: packet)" || echo "VS Code:    FAILED"
(pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null) && echo "Jupyter:    http://<pod-ip>:8888  (token: packet)" || echo "Jupyter:    FAILED"`,
  },
];

export const setupCommand = new Command("setup")
  .description("Auto-setup apps on GPU instances")
  .argument("[preset]", "Setup preset to run (vscode, jupyter, jupyter-torch, workspace, full-dev)")
  .argument("[id]", "Instance ID to setup (required when running a preset)")
  .addCommand(
    new Command("list")
      .description("List available setup presets")
      .action(() => {
        console.log(chalk.cyan("\n  Available Setup Presets\n"));

        for (const preset of SETUP_PRESETS) {
          console.log(
            `  ${chalk.white(preset.id.padEnd(15))} ${preset.icon} ${chalk.bold(preset.name)}`
          );
          console.log(
            chalk.gray(`${"".padEnd(17)} ${preset.description}`)
          );
          const details = [];
          if (preset.estimatedMinutes) details.push(`~${preset.estimatedMinutes} min`);
          if (preset.defaultPort) details.push(`port ${preset.defaultPort}`);
          if (details.length > 0) {
            console.log(chalk.gray(`${"".padEnd(17)} ${details.join(" · ")}`));
          }
          console.log();
        }

        console.log(chalk.gray("  Usage:"));
        console.log(chalk.gray("    packet launch --gpu rtx-pro-6000 --setup vscode   Launch with auto-setup"));
        console.log(chalk.gray("    packet setup vscode <instance-id>                  Setup existing instance\n"));
      })
  )
  .action(async (preset, id) => {
    if (!preset) {
      // No preset specified, show list
      setupCommand.commands.find((c) => c.name() === "list")?.parse(["", "", "list"]);
      return;
    }

    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    if (!id) {
      console.log(chalk.yellow(`\n  Please specify an instance ID: packet setup ${preset} <id>\n`));
      console.log(chalk.gray("  Run 'packet ps' to see your instances.\n"));
      process.exit(1);
    }

    const setupPreset = SETUP_PRESETS.find((p) => p.id === preset);
    if (!setupPreset) {
      console.log(chalk.red(`\n  Unknown preset: '${preset}'\n`));
      console.log(chalk.gray("  Run 'packet setup list' to see available presets.\n"));
      process.exit(1);
    }

    const spinner = ora(`Setting up ${setupPreset.icon} ${setupPreset.name}...`).start();

    try {
      // Get connection info
      spinner.text = "Getting connection info...";
      const connInfo = await apiRequest<ConnectionInfo>(
        `/instances/${id}/connection`
      );

      const pod = connInfo.pods?.find((p) => p.pod_status === "Running" && p.ssh);
      if (!pod?.ssh) {
        spinner.fail("Instance not ready for SSH");
        console.log(chalk.gray("\n  The instance must be running. Check: packet ps\n"));
        process.exit(1);
      }

      // Parse SSH command string
      const sshMatch = pod.ssh.command.match(/ssh\s+(\S+)@(\S+)\s+-p\s+(\d+)/);
      if (!sshMatch) {
        spinner.fail("Could not parse SSH connection info");
        console.log(chalk.gray(`\n  SSH command: ${pod.ssh.command}\n`));
        process.exit(1);
      }
      const [, user, host, portStr] = sshMatch;
      const port = parseInt(portStr, 10);
      const password = pod.ssh.password;

      // Base64-encode script to avoid shell escaping issues
      const scriptB64 = Buffer.from(setupPreset.script).toString("base64");
      const remoteCmd = `echo '${scriptB64}' | base64 -d | bash`;

      spinner.text = `Running ${setupPreset.icon} ${setupPreset.name} setup (~${setupPreset.estimatedMinutes} min)...`;

      // Run via sshpass + ssh
      await new Promise<void>((resolve, reject) => {
        const args = [
          "-p", password,
          "ssh",
          "-o", "StrictHostKeyChecking=no",
          "-o", "UserKnownHostsFile=/dev/null",
          "-o", "LogLevel=ERROR",
          "-p", port.toString(),
          `${user}@${host}`,
          remoteCmd,
        ];

        const child = spawn("sshpass", args, { stdio: ["ignore", "pipe", "pipe"] });

        let output = "";

        child.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });
        child.stderr.on("data", (data: Buffer) => {
          output += data.toString();
        });

        child.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("sshpass is required. Install it with: brew install sshpass (macOS) or apt install sshpass (Linux)"));
          } else {
            reject(err);
          }
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Setup failed (exit code ${code}):\n${output.slice(-500)}`));
          }
        });
      });

      spinner.succeed(`${setupPreset.icon} ${setupPreset.name} is ready!`);

      if (setupPreset.portsToExpose && setupPreset.portsToExpose.length > 0) {
        console.log(chalk.cyan("\n  Services:"));
        for (const p of setupPreset.portsToExpose) {
          const cred = p.name === "vscode" ? "password: packet" : "token: packet";
          console.log(chalk.gray(`    ${p.name.padEnd(10)} port ${p.port}  (${cred})`));
        }
      }

      console.log(chalk.gray(`\n  SSH: ssh ${user}@${host} -p ${port}`));
      console.log();
    } catch (error) {
      spinner.fail("Setup failed");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
