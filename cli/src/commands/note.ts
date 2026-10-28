import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest, type InstanceDetail, type UpdateInstanceRequest } from "../api.js";
import { getApiKey } from "../config.js";

const getCommand = new Command("get")
  .description("Show the note for an instance")
  .argument("<id>", "Instance ID")
  .action(async (id) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Fetching note...").start();

    try {
      const data = await apiRequest<InstanceDetail>(`/instances/${id}`);
      spinner.stop();

      if (data.metadata?.notes) {
        console.log(`\n  ${data.metadata.notes}\n`);
      } else {
        console.log(chalk.gray("\n  No note set.\n"));
      }
    } catch (error) {
      spinner.fail("Failed to fetch note");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });

const setCommand = new Command("set")
  .description("Set the note for an instance")
  .argument("<id>", "Instance ID")
  .requiredOption("-n, --note <value>", "Note text")
  .action(async (id, options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Updating note...").start();

    try {
      await apiRequest(`/instances/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: options.note } satisfies UpdateInstanceRequest),
      });

      spinner.succeed("Note updated");
      console.log();
    } catch (error) {
      spinner.fail("Failed to update note");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });

export const noteCommand = new Command("note")
  .description("Manage instance notes")
  .addCommand(getCommand)
  .addCommand(setCommand);
