import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest, type Account } from "../api.js";
import { getApiKey } from "../config.js";

export const whoamiCommand = new Command("whoami")
  .description("Show current logged-in account")
  .action(async () => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'gpu-cloud login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Fetching account info...").start();

    try {
      const account = await apiRequest<Account>("/account");
      spinner.stop();

      console.log(chalk.cyan("\n  Account\n"));
      console.log(chalk.white(`  Email:   ${account.email}`));
      if (account.name) {
        console.log(chalk.white(`  Name:    ${account.name}`));
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to fetch account info");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
