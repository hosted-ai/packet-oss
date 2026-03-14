import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { apiRequest, type InstanceList } from "../api.js";
import { getApiKey } from "../config.js";

export const psCommand = new Command("ps")
  .description("List running GPU instances")
  .option("-a, --all", "Include terminated instances")
  .action(async (options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'gpu-cloud login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Fetching instances...").start();

    try {
      const data = await apiRequest<InstanceList>("/instances");
      spinner.stop();

      let subs = data.poolSubscriptions || [];

      // Filter out terminated unless --all
      if (!options.all) {
        subs = subs.filter(
          (s) => !["terminated", "deleted", "cancelled", "un_subscribed"].includes(
            (s.status || "").toLowerCase()
          )
        );
      }

      if (subs.length === 0) {
        console.log(chalk.gray("\n  No running instances.\n"));
        console.log(chalk.gray("  Launch one with: gpu-cloud launch --gpu <type>\n"));
        return;
      }

      console.log(chalk.cyan("\n  GPU Instances\n"));

      const table = new Table({
        head: [
          chalk.white("ID"),
          chalk.white("Name"),
          chalk.white("GPU"),
          chalk.white("Status"),
          chalk.white("Uptime"),
        ],
        style: {
          head: [],
          border: ["gray"],
        },
      });

      for (const sub of subs) {
        const gpuType = sub.pool_name || "Unknown";
        const meta = data.podMetadata?.[String(sub.id)];
        const displayName = meta?.displayName || "-";

        // Calculate uptime
        const created = sub.created_at ? new Date(sub.created_at) : null;
        let uptime = "-";
        if (created) {
          const diffMs = Date.now() - created.getTime();
          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          uptime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        }

        // Status with color
        const podStatus = sub.pods?.[0]?.pod_status;
        let statusDisplay: string;

        const status = (sub.status || "").toLowerCase();
        if (status === "running" || status === "active" || status === "subscribed") {
          if (podStatus === "Running") {
            statusDisplay = chalk.green("running");
          } else if (podStatus === "Pending") {
            statusDisplay = chalk.yellow("starting");
          } else {
            statusDisplay = chalk.yellow(sub.status);
          }
        } else if (status === "subscribing" || status === "pending") {
          statusDisplay = chalk.yellow("starting");
        } else if (status === "un_subscribing" || status === "terminating") {
          statusDisplay = chalk.yellow("terminating");
        } else if (status === "terminated" || status === "deleted" || status === "un_subscribed") {
          statusDisplay = chalk.gray("terminated");
        } else {
          statusDisplay = chalk.gray(sub.status);
        }

        table.push([
          chalk.white(String(sub.id)),
          chalk.white(displayName),
          chalk.white(gpuType),
          statusDisplay,
          chalk.gray(uptime),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray("\n  SSH: gpu-cloud ssh <id>  |  Terminate: gpu-cloud terminate <id>\n"));
    } catch (error) {
      spinner.fail("Failed to fetch instances");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
