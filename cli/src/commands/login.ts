import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import open from "open";
import { setApiKey, getApiUrl } from "../config.js";

export const loginCommand = new Command("login")
  .description("Authenticate with the GPU cloud platform")
  .option("-k, --key <apiKey>", "API key (or set GPU_CLOUD_API_KEY env var)")
  .option("-i, --interactive", "Open browser to get API key")
  .action(async (options) => {
    // Check for API key in options or environment
    let apiKey = options.key || process.env.GPU_CLOUD_API_KEY || process.env.PACKET_API_KEY;

    if (options.interactive || !apiKey) {
      console.log(chalk.cyan("\n  Opening dashboard to get your API key...\n"));
      console.log(chalk.gray("  1. Log in to your account"));
      console.log(chalk.gray("  2. Go to Settings → API Keys"));
      console.log(chalk.gray("  3. Create a new API key"));
      console.log(chalk.gray("  4. Copy the key and paste it below\n"));

      await open(`${getApiUrl()}/account?tab=api-keys`);

      // Prompt for API key
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      apiKey = await new Promise<string>((resolve) => {
        rl.question(chalk.white("  Enter your API key: "), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    if (!apiKey) {
      console.log(chalk.red("\n  Error: No API key provided.\n"));
      console.log(
        chalk.gray("  Use: gpu-cloud login --key <your-api-key>")
      );
      console.log(
        chalk.gray("  Or:  gpu-cloud login --interactive")
      );
      process.exit(1);
    }

    // Validate API key
    const spinner = ora("Validating API key...").start();

    try {
      const response = await fetch(`${getApiUrl()}/api/v1/account`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        spinner.fail("Invalid API key");
        process.exit(1);
      }

      const account = await response.json();
      setApiKey(apiKey);

      spinner.succeed("Logged in successfully");
      console.log(chalk.gray(`\n  Account: ${account.email}`));
      console.log(
        chalk.gray(
          `  Balance: $${(account.balanceCents / 100).toFixed(2)}\n`
        )
      );
    } catch (error) {
      spinner.fail("Failed to validate API key");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
