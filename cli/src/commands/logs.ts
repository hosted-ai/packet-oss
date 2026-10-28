import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest, type Instance, type InstanceDetail } from "../api.js";
import { getApiKey } from "../config.js";

export const logsCommand = new Command("logs")
  .description("View instance information and status")
  .argument("<id>", "Instance ID")
  .option("-f, --follow", "Follow status updates")
  .action(async (id, options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'gpu-cloud login' first.\n"));
      process.exit(1);
    }

    const fetchAndDisplay = async (): Promise<boolean> => {
      try {
        const data = await apiRequest<InstanceDetail>(`/instances/${id}`);
        const inst: Instance = data.instance ?? {};

        // Clear screen if following
        if (options.follow) {
          process.stdout.write("\x1B[2J\x1B[0f");
        }

        const displayName = data.metadata?.displayName || inst.name || `Instance ${id}`;
        console.log(chalk.cyan(`\n  ${displayName}\n`));

        // Basic info
        console.log(chalk.white("  Status:     ") + formatStatus(inst.status));
        console.log(chalk.white("  GPU:        ") + chalk.gray(inst.gpu?.model || "Unknown"));
        if (inst.created_at) {
          console.log(chalk.white("  Created:    ") + chalk.gray(new Date(inst.created_at).toLocaleString()));
        }
        if (inst.region) {
          console.log(chalk.white("  Region:     ") + chalk.gray(`${inst.region.city}, ${inst.region.country}`));
        }
        if (inst.ip && inst.ip.length > 0) {
          console.log(chalk.white("  IP:         ") + chalk.gray(inst.ip.join(", ")));
        }

        // Connection info
        if (data.connectionInfo?.ssh_command) {
          console.log(chalk.white("\n  SSH:        ") + chalk.gray(data.connectionInfo.ssh_command));
        }

        console.log();

        // Return true if still running (for --follow)
        return !["terminated", "deleted", "cancelled", "un_subscribed", "stopped"].includes(
          (inst.status || "").toLowerCase()
        );
      } catch (error) {
        console.log(chalk.red(`\n  Error: ${error instanceof Error ? error.message : "Unknown error"}\n`));
        return false;
      }
    };

    if (options.follow) {
      console.log(chalk.gray("  Following instance status (Ctrl+C to exit)...\n"));

      let running = true;
      while (running) {
        running = await fetchAndDisplay();
        if (running) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      console.log(chalk.gray("  Instance terminated.\n"));
    } else {
      const spinner = ora("Fetching instance info...").start();
      spinner.stop();
      await fetchAndDisplay();
    }
  });

function formatStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s === "running" || s === "active") {
    return chalk.green("running");
  } else if (s === "starting" || s === "subscribing" || s === "pending") {
    return chalk.yellow("starting");
  } else if (s === "stopping" || s === "un_subscribing" || s === "terminating") {
    return chalk.yellow("terminating");
  } else if (s === "terminated" || s === "deleted" || s === "un_subscribed" || s === "stopped") {
    return chalk.gray("terminated");
  } else if (s === "error") {
    return chalk.red("error");
  }
  return chalk.gray(status);
}
