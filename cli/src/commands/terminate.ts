import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../api.js";
import { getApiKey } from "../config.js";

export const terminateCommand = new Command("terminate")
  .description("Terminate a GPU instance")
  .argument("<id>", "Instance ID")
  .option("-f, --force", "Skip confirmation")
  .action(async (id, options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    // Confirm unless --force
    if (!options.force) {
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question(
          chalk.yellow(`\n  Terminate instance ${id}? This cannot be undone. [y/N] `),
          (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
          }
        );
      });

      if (!confirmed) {
        console.log(chalk.gray("\n  Cancelled.\n"));
        return;
      }
    }

    const spinner = ora(`Terminating instance ${id}...`).start();

    try {
      await apiRequest(`/instances/${id}`, {
        method: "DELETE",
      });

      spinner.succeed(`Instance ${id} terminated`);
      console.log();
    } catch (error) {
      spinner.fail("Failed to terminate instance");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
