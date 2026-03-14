import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { apiRequest, type LaunchOptions } from "../api.js";
import { getApiKey } from "../config.js";

export const gpusCommand = new Command("gpus")
  .description("List available GPU types and pricing")
  .option("-a, --all", "Show all GPUs including unavailable")
  .action(async (options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'gpu-cloud login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Fetching available GPUs...").start();

    try {
      const data = await apiRequest<LaunchOptions>("/launch-options");
      spinner.stop();

      let products = data.products || [];
      if (!options.all) {
        products = products.filter((p) => p.totalAvailableGpus > 0);
      }

      if (products.length === 0) {
        console.log(chalk.yellow("\n  No GPUs available right now.\n"));
        console.log(chalk.gray("  Use --all to see all GPU types.\n"));
        return;
      }

      console.log(chalk.cyan("\n  Available GPUs\n"));

      const table = new Table({
        head: [
          chalk.white("Name"),
          chalk.white("GPU"),
          chalk.white("VRAM"),
          chalk.white("Available"),
          chalk.white("Price/hr"),
          chalk.white("Status"),
        ],
        style: {
          head: [],
          border: ["gray"],
        },
      });

      for (const product of products) {
        const slug = product.name.toLowerCase().replace(/\s+/g, "-");
        const available = product.totalAvailableGpus;
        const price = `$${(product.pricePerHourCents / 100).toFixed(2)}`;
        const vram = product.vramGb ? `${product.vramGb}GB` : "-";
        const status = available > 0
          ? chalk.green("available")
          : chalk.gray("unavailable");

        table.push([
          chalk.cyan(slug),
          chalk.white(product.name),
          chalk.gray(vram),
          chalk.gray(`${available} GPU${available !== 1 ? "s" : ""}`),
          chalk.yellow(price),
          status,
        ]);
      }

      console.log(table.toString());
      console.log(
        chalk.gray(`\n  Launch with: gpu-cloud launch --gpu <name>\n`)
      );
    } catch (error) {
      spinner.fail("Failed to fetch GPUs");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
