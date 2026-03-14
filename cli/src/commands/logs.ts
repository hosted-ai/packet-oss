import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest, type InstanceDetail } from "../api.js";
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
        const sub = data.subscription;

        // Clear screen if following
        if (options.follow) {
          process.stdout.write("\x1B[2J\x1B[0f");
        }

        const displayName = data.metadata?.displayName || `Instance ${id}`;
        console.log(chalk.cyan(`\n  ${displayName}\n`));

        // Basic info
        const podStatus = sub.pods?.[0]?.pod_status;
        console.log(chalk.white("  Status:     ") + formatStatus(sub.status, podStatus));
        console.log(chalk.white("  GPU:        ") + chalk.gray(sub.pool_name || "Unknown"));
        if (sub.created_at) {
          console.log(chalk.white("  Created:    ") + chalk.gray(new Date(sub.created_at).toLocaleString()));
        }

        // Pod info
        if (sub.pods && sub.pods.length > 0) {
          console.log(chalk.white("\n  Pods:"));
          for (const pod of sub.pods) {
            const status = pod.pod_status === "Running"
              ? chalk.green(pod.pod_status)
              : pod.pod_status === "Pending"
              ? chalk.yellow(pod.pod_status)
              : chalk.gray(pod.pod_status);
            console.log(chalk.gray(`    - ${pod.pod_name}: `) + status);
          }
        }

        console.log();

        // Return true if still running (for --follow)
        return !["terminated", "deleted", "cancelled", "un_subscribed"].includes(
          (sub.status || "").toLowerCase()
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

function formatStatus(status: string, podStatus?: string): string {
  const s = (status || "").toLowerCase();
  if (s === "running" || s === "active" || s === "subscribed") {
    if (podStatus === "Running") {
      return chalk.green("running");
    } else if (podStatus === "Pending") {
      return chalk.yellow("starting");
    }
    return chalk.yellow(status);
  } else if (s === "subscribing" || s === "pending") {
    return chalk.yellow("starting");
  } else if (s === "un_subscribing" || s === "terminating") {
    return chalk.yellow("terminating");
  } else if (s === "terminated" || s === "deleted" || s === "un_subscribed") {
    return chalk.gray("terminated");
  }
  return chalk.gray(status);
}
