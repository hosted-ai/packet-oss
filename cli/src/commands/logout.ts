import { Command } from "commander";
import chalk from "chalk";
import { clearApiKey, getApiKey } from "../config.js";

export const logoutCommand = new Command("logout")
  .description("Log out and remove stored credentials")
  .action(() => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in.\n"));
      return;
    }

    clearApiKey();
    console.log(chalk.green("\n  Logged out successfully.\n"));
  });
